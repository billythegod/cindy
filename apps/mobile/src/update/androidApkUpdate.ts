/** One in-memory download shared by the startup, settings and forced-update entries. */
export interface ApkUpdateState {
  phase: 'idle' | 'downloading' | 'ready' | 'permission' | 'installing' | 'error';
  visible: boolean;
  received: number;
  total: number;
  error?: 'download' | 'install' | 'unavailable';
}

export interface ApkUpdateDependencies {
  available(): boolean;
  download(
    url: string,
    progress: (received: number, total: number) => void,
  ): {
    result: Promise<string>;
    cancel(): Promise<void>;
  };
  remove(uri: string): Promise<void>;
  install(uri: string): Promise<'opened' | 'permission-required'>;
  openPermissionSettings(): Promise<void>;
}

const initialState: ApkUpdateState = {
  phase: 'idle',
  visible: false,
  received: 0,
  total: 0,
};

export function createApkUpdater(deps: ApkUpdateDependencies) {
  let state = initialState;
  let targetUrl = '';
  let apk: string | null = null;
  let busy = false;
  let cancelled = false;
  let cancelDownload: (() => Promise<void>) | undefined;
  let awaitingPermission = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<ApkUpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };

  async function install() {
    if (!apk || busy) return;
    busy = true;
    publish({ phase: 'installing', error: undefined });
    try {
      const outcome = await deps.install(apk);
      // Opening an installer is not proof that the user installed the update.
      publish({ phase: outcome === 'opened' ? 'ready' : 'permission' });
    } catch {
      // A missing or invalid cached APK must be downloadable again on retry.
      if (apk) await deps.remove(apk).catch(() => {});
      apk = null;
      publish({ phase: 'error', error: 'install' });
    } finally {
      busy = false;
    }
  }

  async function start(url: string) {
    publish({ visible: true });
    if (busy) return;
    if (!deps.available()) {
      publish({ phase: 'error', error: 'unavailable' });
      return;
    }
    if (url === targetUrl && apk) return install();
    busy = true;
    cancelled = false;
    awaitingPermission = false;
    targetUrl = url;
    apk = null;
    publish({ phase: 'downloading', received: 0, total: 0, error: undefined });
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('Invalid APK URL');
      }
      const download = deps.download(url, (received, total) => {
        if (!cancelled) publish({ received, total });
      });
      cancelDownload = download.cancel;
      const uri = await download.result;
      if (cancelled) await deps.remove(uri);
      else apk = uri;
    } catch {
      if (!cancelled) publish({ phase: 'error', error: 'download' });
    } finally {
      cancelDownload = undefined;
      busy = false;
      if (cancelled) publish(initialState);
    }
    if (apk && !cancelled) await install();
  }

  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    retry: () => start(targetUrl),
    install,
    dismiss() {
      if (busy) return;
      awaitingPermission = false;
      publish({ visible: false });
    },
    async cancel() {
      if (state.phase !== 'downloading' || cancelled) return;
      cancelled = true;
      try {
        await cancelDownload?.();
      } catch {
        /* The result still owns cleanup. */
      }
    },
    async openPermissionSettings() {
      if (busy || state.phase !== 'permission') return;
      busy = true;
      awaitingPermission = true;
      try {
        await deps.openPermissionSettings();
      } catch {
        awaitingPermission = false;
        publish({ phase: 'error', error: 'install' });
      } finally {
        busy = false;
      }
    },
    async resume() {
      if (!awaitingPermission || busy) return;
      awaitingPermission = false;
      await install();
    },
  };
}
