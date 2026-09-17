import { describe, expect, it, vi } from 'vitest';
import { createApkUpdater, type ApkUpdateDependencies } from './androidApkUpdate';

const URL = 'https://updates.example.invalid/cindy.apk';
const URI = 'file:///cache/cindy-apk-updates/test.apk';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const transfer = deferred<string>();
  const cancel = vi.fn(async () => {});
  let progress!: (received: number, total: number) => void;
  const deps = {
    available: vi.fn(() => true),
    download: vi.fn((_url: string, report: typeof progress) => {
      progress = report;
      return { result: transfer.promise, cancel };
    }),
    remove: vi.fn(async () => {}),
    install: vi.fn<ApkUpdateDependencies['install']>(async () => 'opened'),
    openPermissionSettings: vi.fn(async () => {}),
  };
  return {
    deps,
    transfer,
    cancel,
    progress: (n: number, total: number) => progress(n, total),
    updater: createApkUpdater(deps),
  };
}

describe('Android APK update lifecycle', () => {
  it('reports bytes and opens the installer only after the download completes', async () => {
    const { updater, deps, transfer, progress } = setup();
    const done = updater.start(URL);
    progress(50, 100);
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'downloading',
      received: 50,
      total: 100,
    });
    expect(deps.install).not.toHaveBeenCalled();
    transfer.resolve(URI);
    await done;
    expect(deps.install).toHaveBeenCalledWith(URI);
    expect(updater.getSnapshot().phase).toBe('ready');
    // An open installer can still be cancelled. Retain its APK for another attempt.
    updater.dismiss();
    await updater.start(URL);
    expect(deps.download).toHaveBeenCalledTimes(1);
    expect(deps.install).toHaveBeenCalledTimes(2);
    expect(deps.remove).not.toHaveBeenCalled();
  });

  it('coalesces repeated entry clicks while a download is in flight', async () => {
    const { updater, deps, transfer } = setup();
    const done = updater.start(URL);
    await updater.start(URL);
    await updater.start('https://updates.example.invalid/other.apk');
    expect(deps.download).toHaveBeenCalledTimes(1);
    transfer.resolve(URI);
    await done;
    expect(deps.install).toHaveBeenCalledTimes(1);
  });

  it('cancellation beats a late successful completion and removes its file', async () => {
    const { updater, deps, transfer, cancel, progress } = setup();
    const done = updater.start(URL);
    await updater.cancel();
    progress(100, 100);
    transfer.resolve(URI);
    await done;
    expect(cancel).toHaveBeenCalledOnce();
    expect(deps.install).not.toHaveBeenCalled();
    expect(deps.remove).toHaveBeenCalledWith(URI);
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'idle',
      visible: false,
      received: 0,
    });
  });

  it('a cancellation rejection is not shown as a download error', async () => {
    const { updater, transfer } = setup();
    const done = updater.start(URL);
    await updater.cancel();
    transfer.reject(new Error('Cancelled'));
    await done;
    expect(updater.getSnapshot().phase).toBe('idle');
  });

  it('a failed download never reaches the installer and can be retried', async () => {
    const { updater, deps, transfer } = setup();
    const done = updater.start(URL);
    transfer.reject(new Error('Network failed'));
    await done;
    expect(deps.install).not.toHaveBeenCalled();
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'download',
    });
    deps.download.mockImplementationOnce(() => ({
      result: Promise.resolve(URI),
      cancel: vi.fn(),
    }));
    await updater.retry();
    expect(deps.install).toHaveBeenCalledWith(URI);
  });

  it('requests permission only on explicit action and resumes once on return', async () => {
    const { updater, deps, transfer } = setup();
    deps.install.mockResolvedValueOnce('permission-required');
    const done = updater.start(URL);
    transfer.resolve(URI);
    await done;
    expect(updater.getSnapshot().phase).toBe('permission');
    expect(deps.openPermissionSettings).not.toHaveBeenCalled();
    await updater.resume();
    expect(deps.install).toHaveBeenCalledTimes(1);
    await updater.openPermissionSettings();
    await updater.resume();
    await updater.resume();
    expect(deps.install).toHaveBeenCalledTimes(2);
    expect(deps.download).toHaveBeenCalledTimes(1);
  });

  it('permission denial keeps a retryable permission screen without looping settings', async () => {
    const { updater, deps, transfer } = setup();
    deps.install.mockResolvedValue('permission-required');
    const done = updater.start(URL);
    transfer.resolve(URI);
    await done;
    await updater.openPermissionSettings();
    await updater.resume();
    await updater.resume();
    expect(updater.getSnapshot().phase).toBe('permission');
    expect(deps.openPermissionSettings).toHaveBeenCalledTimes(1);
    expect(deps.install).toHaveBeenCalledTimes(2);
  });

  it('invalid/missing APKs are discarded so retry fetches a fresh file', async () => {
    const { updater, deps, transfer } = setup();
    deps.install.mockRejectedValueOnce(new Error('Invalid APK'));
    const done = updater.start(URL);
    transfer.resolve(URI);
    await done;
    expect(updater.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'install',
    });
    expect(deps.remove).toHaveBeenCalledWith(URI);
    await updater.retry();
    expect(deps.download).toHaveBeenCalledTimes(2);
    expect(updater.getSnapshot().phase).toBe('ready');
  });

  it('coalesces installer invocations too', async () => {
    const { updater, deps, transfer } = setup();
    const opening = deferred<'opened'>();
    deps.install.mockReturnValueOnce(opening.promise);
    transfer.resolve(URI);
    const done = updater.start(URL);
    await vi.waitFor(() => expect(deps.install).toHaveBeenCalledTimes(1));
    await updater.install();
    await updater.start(URL);
    opening.resolve('opened');
    await done;
    expect(deps.install).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://updates.example.invalid/a.apk',
    'file:///tmp/a.apk',
    'https://user:password@updates.example.invalid/a.apk',
    'bad-url',
  ])('does not download unsupported URL %s', async (url) => {
    const { updater, deps } = setup();
    await updater.start(url);
    expect(deps.download).not.toHaveBeenCalled();
    expect(updater.getSnapshot().error).toBe('download');
  });

  it('reports absent native support without downloading a file it cannot install', async () => {
    const { updater, deps } = setup();
    deps.available.mockReturnValue(false);
    await updater.start(URL);
    expect(deps.download).not.toHaveBeenCalled();
    expect(updater.getSnapshot().error).toBe('unavailable');
  });
});
