import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'android' },
  addMenuItem: vi.fn(),
  openBundleInstall: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: mocks.platform,
  DevSettings: { addMenuItem: mocks.addMenuItem },
}));
vi.mock('@/update/useBundleUpdatePrompt', () => ({
  openBundleInstall: mocks.openBundleInstall,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('__DEV__', true);
  vi.stubEnv('EXPO_PUBLIC_ANDROID_APK_UPDATE_TEST_URL', 'https://localhost/update.apk');
  mocks.platform.OS = 'android';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('registers one opt-in action that uses the real bundle-install entry point', async () => {
  const { registerDevApkUpdateMenu } = await import('./devApkUpdateMenu');
  registerDevApkUpdateMenu();
  registerDevApkUpdateMenu();
  expect(mocks.addMenuItem).toHaveBeenCalledTimes(1);
  expect(mocks.openBundleInstall).not.toHaveBeenCalled();
  mocks.addMenuItem.mock.calls[0][1]();
  expect(mocks.openBundleInstall).toHaveBeenCalledWith({ installUrl: 'https://localhost/update.apk' });
});

it.each(['production', 'ios', 'no-url'])('does not add a test action for %s', async (scenario) => {
  if (scenario === 'production') vi.stubGlobal('__DEV__', false);
  if (scenario === 'ios') mocks.platform.OS = 'ios';
  if (scenario === 'no-url') vi.stubEnv('EXPO_PUBLIC_ANDROID_APK_UPDATE_TEST_URL', '');
  const { registerDevApkUpdateMenu } = await import('./devApkUpdateMenu');
  registerDevApkUpdateMenu();
  expect(mocks.addMenuItem).not.toHaveBeenCalled();
});
