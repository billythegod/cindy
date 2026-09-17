package app.cindy.apkinstaller

import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Downloads stay in Expo FileSystem; this bridge only owns APK storage and system installation. */
class CindyApkInstallerModule : Module() {
  private fun context() = requireNotNull(appContext.reactContext) { "Application unavailable" }
  private fun directory() = File(context().cacheDir, "cindy-apk-updates")

  override fun definition() = ModuleDefinition {
    Name("CindyApkInstaller")

    AsyncFunction("prepareDownload") {
      val root = directory()
      check(root.isDirectory || root.mkdirs()) { "Update cache unavailable" }
      // Do not remove a file immediately after opening the installer: it may still be reading.
      // Interrupted downloads/previous packages are disposable and expire on the next download.
      val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
      root.listFiles()?.filter { it.isFile && it.lastModified() < cutoff }?.forEach { it.delete() }
      Uri.fromFile(File(root, "${UUID.randomUUID()}.apk")).toString()
    }

    AsyncFunction("install") Coroutine { uri: String ->
      val file = withContext(Dispatchers.IO) { validatedApk(uri) }
      withContext(Dispatchers.Main) {
        val context = context()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
          "permission-required"
        } else {
          val activity = requireNotNull(appContext.currentActivity) { "Activity unavailable" }
          val content = FileProvider.getUriForFile(context, "${context.packageName}.apk-updates", file)
          val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(content, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          activity.startActivity(intent)
          "opened"
        }
      }
    }

    AsyncFunction("openPermissionSettings") Coroutine { ->
      withContext(Dispatchers.Main) {
        val activity = requireNotNull(appContext.currentActivity) { "Activity unavailable" }
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${context().packageName}")))
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun validatedApk(value: String): File {
    val uri = Uri.parse(value)
    require(uri.scheme == "file") { "Invalid update file" }
    val file = File(requireNotNull(uri.path)).canonicalFile
    require(file.parentFile == directory().canonicalFile && file.extension == "apk" && file.isFile && file.length() > 0) {
      "Invalid update file"
    }
    val context = context()
    val manager = context.packageManager
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val archive = requireNotNull(manager.getPackageArchiveInfo(file.path, flags)) { "Invalid APK" }
    val installed = manager.getPackageInfo(context.packageName, flags)
    require(archive.packageName == context.packageName) { "Wrong application" }
    require(versionCode(archive) > versionCode(installed)) { "Update must be newer" }
    // Accept an authenticated signing-key rotation as well as identical signing keys.
    // Android's installer performs the final signature/lineage verification before replacement.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val current = requireNotNull(installed.signingInfo).apkContentsSigners.toSet()
      val incoming = requireNotNull(archive.signingInfo)
      val compatible = if (incoming.hasMultipleSigners() || current.size > 1) {
        incoming.apkContentsSigners.toSet() == current
      } else {
        incoming.signingCertificateHistory.toSet().containsAll(current)
      }
      require(current.isNotEmpty() && compatible) { "Signing identity mismatch" }
    } else {
      val current = installed.signatures?.toSet().orEmpty()
      require(current.isNotEmpty() && archive.signatures?.toSet() == current) { "Signing identity mismatch" }
    }
    return file
  }

  @Suppress("DEPRECATION")
  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()
}
