import * as FileSystem from 'expo-file-system/legacy';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { createApkUpdater } from './androidApkUpdate';

interface ApkInstaller {
  prepareDownload(): Promise<string>;
  install(uri: string): Promise<'opened' | 'permission-required'>;
  openPermissionSettings(): Promise<void>;
}

// Optional to keep older binaries and non-Android platforms import-safe.
const installer = requireOptionalNativeModule<ApkInstaller>('CindyApkInstaller');

export const androidApkUpdater = createApkUpdater({
  available: () => installer !== null,
  download(url, progress) {
    let task: ReturnType<typeof FileSystem.createDownloadResumable> | undefined;
    let cancelled = false;
    const result = (async () => {
      const uri = await installer!.prepareDownload();
      try {
        if (cancelled) throw new Error('Cancelled');
        task = FileSystem.createDownloadResumable(url, uri, {}, (event) => {
          progress(event.totalBytesWritten, event.totalBytesExpectedToWrite);
        });
        const response = await task.downloadAsync();
        if (cancelled || !response || response.status !== 200) throw new Error('Download failed');
        const info = await FileSystem.getInfoAsync(uri);
        if (!info.exists || info.isDirectory || info.size <= 0) throw new Error('Empty APK');
        return uri;
      } catch (error) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        throw error;
      } finally {
        // Legacy FileSystem keeps its progress subscription after settlement.
        // Cancelling a settled task releases that listener without deleting the APK.
        if (!cancelled) await task?.cancelAsync().catch(() => {});
      }
    })();
    return {
      result,
      async cancel() {
        cancelled = true;
        await task?.cancelAsync();
      },
    };
  },
  remove: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  install: (uri) => installer!.install(uri),
  openPermissionSettings: () => installer!.openPermissionSettings(),
});
