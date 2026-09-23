/** Router-only classification. Credentials and state are still consumed by OpenSDK. */
export function isWechatSdkCallback(
  path: string,
  config: { appId: string; universalLink: string },
): boolean {
  const isCallbackPath = (value: string) =>
    /^(?:oauth|refreshToken)\/?$/.test(value);
  try {
    // Expo Router may already have replaced the incoming wx<AppID> scheme with
    // Cindy's scheme, or reduced the URL to a path. Neither is a navigable page.
    const customPath = path.replace(/^[a-zA-Z][\w+.-]*:\/\//, '/');
    if (!/^https?:\/\//i.test(path)) {
      return isCallbackPath(customPath.split(/[?#]/)[0].replace(/^\/+/, ''));
    }
    if (!config.appId || !config.universalLink) return false;
    const actual = new URL(path);
    const base = new URL(config.universalLink);
    if (actual.origin !== base.origin || actual.username || actual.password) return false;
    const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
    if (!actual.pathname.startsWith(prefix)) return false;
    const suffix = actual.pathname.slice(prefix.length);
    return isCallbackPath(suffix) || (
      suffix.startsWith(`${config.appId}/`) &&
      isCallbackPath(suffix.slice(config.appId.length + 1))
    );
  } catch {
    return false;
  }
}
