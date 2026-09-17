import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  download: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  info: vi.fn(),
  install: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => ({
    prepareDownload: mocks.prepare,
    install: mocks.install,
    openPermissionSettings: mocks.settings,
  }),
}));
vi.mock('expo-file-system/legacy', () => ({
  createDownloadResumable: () => ({
    downloadAsync: mocks.download,
    cancelAsync: mocks.cancel,
  }),
  deleteAsync: mocks.remove,
  getInfoAsync: mocks.info,
}));

const url = 'https://updates.example.invalid/cindy.apk';
const uri = 'file:///cache/cindy-apk-updates/one.apk';
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.prepare.mockResolvedValue(uri);
  mocks.download.mockResolvedValue({ status: 200, uri });
  mocks.info.mockResolvedValue({ exists: true, isDirectory: false, size: 500 });
  mocks.install.mockResolvedValue('opened');
  mocks.remove.mockResolvedValue(undefined);
  mocks.cancel.mockResolvedValue(undefined);
});

describe('APK download adapter', () => {
  it('hands a downloaded, non-empty file to the native installer', async () => {
    const { androidApkUpdater } = await import('./androidApkUpdateService');
    await androidApkUpdater.start(url);
    expect(mocks.install).toHaveBeenCalledWith(uri);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each([404, 500, 206])(
    'removes the response body and does not install HTTP %s',
    async (status) => {
      mocks.download.mockResolvedValue({ status, uri });
      const { androidApkUpdater } = await import('./androidApkUpdateService');
      await androidApkUpdater.start(url);
      expect(mocks.remove).toHaveBeenCalledWith(uri, { idempotent: true });
      expect(mocks.install).not.toHaveBeenCalled();
      expect(androidApkUpdater.getSnapshot().error).toBe('download');
    },
  );

  it.each([
    { exists: false },
    { exists: true, isDirectory: true },
    { exists: true, isDirectory: false, size: 0 },
  ])('rejects missing/empty/non-file results %j', async (info) => {
    mocks.info.mockResolvedValue(info);
    const { androidApkUpdater } = await import('./androidApkUpdateService');
    await androidApkUpdater.start(url);
    expect(mocks.remove).toHaveBeenCalledWith(uri, { idempotent: true });
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('cleans up partial files after an interrupted connection', async () => {
    mocks.download.mockRejectedValue(new Error('Disconnected'));
    const { androidApkUpdater } = await import('./androidApkUpdateService');
    await androidApkUpdater.start(url);
    expect(mocks.remove).toHaveBeenCalledWith(uri, { idempotent: true });
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('cancels while native storage is being prepared without starting a transfer', async () => {
    let finish!: (uri: string) => void;
    mocks.prepare.mockReturnValue(
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    );
    const { androidApkUpdater } = await import('./androidApkUpdateService');
    const done = androidApkUpdater.start(url);
    await androidApkUpdater.cancel();
    finish(uri);
    await done;
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.install).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledWith(uri, { idempotent: true });
    expect(androidApkUpdater.getSnapshot().phase).toBe('idle');
  });
});
