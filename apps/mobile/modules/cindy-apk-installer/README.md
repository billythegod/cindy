# Android in-app updates

This Android-only local Expo module is autolinked from `apps/mobile/modules`.
The app downloads with its existing Expo FileSystem dependency; this module
allocates a private cache file and opens Android's package installer.

- `prepareDownload()` returns a unique APK path under `cache/cindy-apk-updates`.
  Files older than 24 hours are removed when another download is started.
- `install(uri)` accepts only files in that directory, checks the APK package
  name, newer version code and signing identity (including signing-key rotation),
  then returns `permission-required` or launches the installer and returns `opened`.
  Android still verifies the package and asks the user to confirm installation.
- `openPermissionSettings()` opens this app's “Install unknown apps” settings.
  The app retries installation once on return; denying permission does not loop.
- A non-exported FileProvider exposes only the update directory, with a temporary
  read grant. No shared-storage permission is required.

The root-owned update overlay is shared by optional and forced updates. Closing
or cancelling it does not clear the forced-update gate. Progress and the current
download are in memory; restarting the process requires downloading again.
Failed/cancelled transfers are removed. Completed files remain available for
installation retry and are not deleted while the system installer may read them.

## Native release boundary

The permission, provider and Kotlin module require a new Android binary. An OTA
alone cannot add them to an existing installation. Distribute this first binary
through the existing installation route; subsequent APK updates can use the new
in-app flow. The module has no Apple platform and does not change iOS behavior.
Do not publish these JavaScript changes as an update for an older native runtime.
The repository's explicit cold-update approval is required before merging.

## Device verification

For local Debug builds, set `EXPO_PUBLIC_ANDROID_APK_UPDATE_TEST_URL` to an HTTPS
APK endpoint when starting Metro with the repository's `mobile:sim:start`
wrapper. Android's developer menu then includes **Test Android APK update**;
this invokes the same download/install entry point without changing production
release records or requiring sign-in. The menu is absent in release builds and
when the environment variable is unset. Never disable production TLS validation
to accommodate a local endpoint. A local CA, if needed, belongs only in ignored
generated Android Debug resources, not the shared app configuration.

Use a self-hosted build and a higher-version APK signed with the same key:

1. Check for an update, download inside the app, and confirm the system installer
   opens. Finish installation and verify the installed version.
2. Revoke the install permission, download again, allow it in settings, and return
   to the app. Repeat while denying permission; the permission action stays usable.
3. Cancel download; disconnect the network; serve a 404 or invalid/wrong-package/
   wrong-signature APK. No failed transfer or invalid package should be installed.
4. Cancel the system installer and retry installation without downloading again.
5. Repeat from the forced-update screen. Cancelling must leave the gate in place.
6. Inspect progress, error and permission states in Light and Dark modes.
