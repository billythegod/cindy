import { DevSettings, Platform } from 'react-native';
import { openBundleInstall } from '@/update/useBundleUpdatePrompt';

let registered = false;

/** Opt-in local APK testing without changing production release pointers or update gates. */
export function registerDevApkUpdateMenu(): void {
  if (!__DEV__ || Platform.OS !== 'android' || registered) return;
  const installUrl = process.env.EXPO_PUBLIC_ANDROID_APK_UPDATE_TEST_URL?.trim();
  if (!installUrl) return;
  registered = true;
  DevSettings.addMenuItem('Test Android APK update', () => {
    openBundleInstall({ installUrl });
  });
}
