package app.cindy.apkinstaller

import androidx.core.content.FileProvider

/** Exposes only the private update cache, via temporary read grants to the installer. */
class ApkFileProvider : FileProvider()
