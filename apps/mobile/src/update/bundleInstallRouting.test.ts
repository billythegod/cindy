import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundleUpdateEvaluation } from './bundleUpdate';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' },
  openURL: vi.fn(),
  start: vi.fn(),
  alert: vi.fn(),
  forced: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: mocks.platform,
  Linking: { openURL: mocks.openURL },
  Alert: { alert: mocks.alert },
}));
vi.mock('expo-updates', () => ({ runtimeVersion: 'old' }));
vi.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('@/config/env', () => ({
  APP_BINARY_VERSION: '1.0.0',
  IS_OTA_SELFHOST: true,
  IS_TESTFLIGHT_BUILD: false,
  REVIEW_MODE: false,
}));
vi.mock('./fetchLatestRelease', () => ({ fetchLatestRelease: vi.fn() }));
vi.mock('./forcedUpdateStore', () => ({ enterForcedUpdate: mocks.forced }));
vi.mock('./canaryChannelStore', () => ({ resolveUpdateChannelForDevice: () => 'release' }));
vi.mock('./androidApkUpdateService', () => ({ androidApkUpdater: { start: mocks.start } }));

import { openBundleInstall, promptBundleUpdate } from './useBundleUpdatePrompt';

const target = {
  version: '2.0.0',
  runtimeVersion: 'new',
  installUrl: 'https://updates.example.invalid/new.apk',
  itmsUrl: 'itms-services://test',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.platform.OS = 'android';
  mocks.start.mockResolvedValue(undefined);
  mocks.openURL.mockResolvedValue(undefined);
});

describe('bundle installation platform routing', () => {
  it.each([
    'https://updates.example.invalid/install',
    'https://updates.example.invalid/install?file=app.apk',
    'market://details?id=com.xd.cindy',
    'http://updates.example.invalid/new.apk',
  ])('preserves the external install route for %s, including forced updates', (installUrl) => {
    const externalTarget = { ...target, installUrl };
    promptBundleUpdate({ needsUpdate: true, forced: true, target: externalTarget });
    expect(mocks.forced).toHaveBeenCalledWith(externalTarget);
    openBundleInstall(externalTarget);
    expect(mocks.openURL).toHaveBeenCalledWith(installUrl);
    expect(mocks.start).not.toHaveBeenCalled();
    mocks.openURL.mockClear();
    promptBundleUpdate({ needsUpdate: true, forced: false, target: externalTarget });
    mocks.alert.mock.calls[0][2][1].onPress();
    expect(mocks.openURL).toHaveBeenCalledWith(installUrl);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('downloads an HTTPS APK with query parameters and a fragment', () => {
    const installUrl = 'https://updates.example.invalid/new.APK?token=test#download';
    openBundleInstall({ ...target, installUrl });
    expect(mocks.start).toHaveBeenCalledWith(installUrl);
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it('reports external installation launch failures', async () => {
    mocks.openURL.mockRejectedValue(new Error('No handler'));
    openBundleInstall({ ...target, installUrl: 'market://details?id=com.xd.cindy' });
    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledWith(
      'update.openInstallFailedTitle', 'update.openInstallFailedBody',
    ));
  });

  it('Android uses the APK URL and never opens a browser, even when itmsUrl is present', () => {
    openBundleInstall(target);
    expect(mocks.start).toHaveBeenCalledWith(target.installUrl);
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it('the optional-update action uses the same in-app downloader', () => {
    promptBundleUpdate({ needsUpdate: true, forced: false, target });
    expect(mocks.start).not.toHaveBeenCalled();
    const actions = mocks.alert.mock.calls[0][2];
    actions[1].onPress();
    expect(mocks.start).toHaveBeenCalledWith(target.installUrl);
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it('forced updates still enter the gate before any user-initiated download', () => {
    promptBundleUpdate({ needsUpdate: true, forced: true, target });
    expect(mocks.forced).toHaveBeenCalledWith(target);
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('Android does not enter a forced gate whose only exit is an iOS URL', () => {
    const evaluation: BundleUpdateEvaluation = {
      needsUpdate: true,
      forced: true,
      target: { ...target, installUrl: '' },
    };
    promptBundleUpdate(evaluation);
    openBundleInstall(evaluation.target!);
    expect(mocks.forced).not.toHaveBeenCalled();
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.openURL).not.toHaveBeenCalled();
  });

  it('iOS keeps its existing system installation link and hint', async () => {
    mocks.platform.OS = 'ios';
    openBundleInstall(target);
    await vi.waitFor(() =>
      expect(mocks.alert).toHaveBeenCalledWith('update.installHintTitle', 'update.installHintBody'),
    );
    expect(mocks.openURL).toHaveBeenCalledWith(target.itmsUrl);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
