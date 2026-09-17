package app.cindy.apkinstaller

import java.io.File

/** PackageManager supplies verified signing metadata; Android still verifies the APK on install. */
internal data class ApkIdentity(
  val packageName: String,
  val versionCode: Long,
  val signers: Set<String>,
  val signingHistory: Set<String> = emptySet(),
  val hasMultipleSigners: Boolean = false,
)

internal fun validateApkFile(file: File, directory: File): File {
  val canonical = file.canonicalFile
  require(canonical.parentFile == directory.canonicalFile && canonical.extension == "apk" &&
    canonical.isFile && canonical.length() > 0) { "Invalid update file" }
  return canonical
}

internal fun validateApkIdentity(installed: ApkIdentity, incoming: ApkIdentity, supportsSigningHistory: Boolean) {
  require(incoming.packageName == installed.packageName) { "Wrong application" }
  require(incoming.versionCode > installed.versionCode) { "Update must be newer" }
  val compatible = if (!supportsSigningHistory || incoming.hasMultipleSigners || installed.signers.size > 1) {
    incoming.signers == installed.signers
  } else {
    incoming.signingHistory.containsAll(installed.signers)
  }
  require(installed.signers.isNotEmpty() && compatible) { "Signing identity mismatch" }
}
