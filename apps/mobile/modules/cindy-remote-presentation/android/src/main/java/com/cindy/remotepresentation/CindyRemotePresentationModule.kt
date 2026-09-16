package com.cindy.remotepresentation

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.functions.Coroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.atomic.AtomicLong
import android.text.Html
import androidx.core.content.FileProvider
import java.io.File
import java.util.UUID
import org.json.JSONObject
import java.io.ByteArrayOutputStream

// Bound encoded buffers before Bitmap/JSON/Base64 can multiply their footprint.
private const val IMAGE_BYTES = 8 * 1024 * 1024
private const val IMAGE_PIXELS = 4_000_000L
private class ClipboardImageOutput : ByteArrayOutputStream(8192) {
  override fun write(value: Int) {
    if (count >= IMAGE_BYTES) throw Exception("CLIPBOARD_TOO_LONG")
    super.write(value)
  }
  override fun write(bytes: ByteArray, offset: Int, length: Int) {
    if (length > IMAGE_BYTES - count) throw Exception("CLIPBOARD_TOO_LONG")
    super.write(bytes, offset, length)
  }
  fun base64(): String = Base64.encodeToString(buf, 0, count, Base64.NO_WRAP)
}

class CindyRemotePresentationModule : Module() {
  private val clipboard: ClipboardManager
    get() = appContext.reactContext!!.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

  // No payload is retained: notifications and foreground transitions only
  // invalidate the version. Atomic because Expo lifecycle callbacks may run
  // outside the MAIN queue used by clipboard operations.
  private val clipboardGeneration = AtomicLong(0)
  private val clipboardEpoch = UUID.randomUUID().toString()
  private var observedClipboard: ClipboardManager? = null
  private val clipboardListener = ClipboardManager.OnPrimaryClipChangedListener {
    clipboardGeneration.incrementAndGet()
  }

  override fun definition() = ModuleDefinition {
    Name("CindyRemotePresentation")
    OnActivityEntersForeground { clipboardGeneration.incrementAndGet() }
    OnDestroy {
      Handler(Looper.getMainLooper()).post {
        observedClipboard?.removePrimaryClipChangedListener(clipboardListener)
        observedClipboard = null
      }
    }
    // Android WebView owns playback; only iOS needs an AVAudioSession override.
    AsyncFunction("playback") { _: Boolean -> Unit }
    AsyncFunction("clipboardVersion") { foreground(); clipboardVersion() }.runOnQueue(Queues.MAIN)
    AsyncFunction("readClipboard") Coroutine { ->
      val clip = withContext(Dispatchers.Main.immediate) {
        foreground()
        clipboard.primaryClip ?: throw Exception("CLIPBOARD_EMPTY")
      }
      val result = withContext(Dispatchers.IO) { readClipboard(clip) }
      withContext(Dispatchers.Main.immediate) { foreground() }
      result
    }
    AsyncFunction("syncClipboard") Coroutine { json: String, version: String -> writeClipboard(json, version) }
    AsyncFunction("writeClipboard") Coroutine { json: String -> writeClipboard(json, null); Unit }
  }

  private fun foreground() {
    if (appContext.currentActivity?.hasWindowFocus() != true) throw Exception("CLIPBOARD_NOT_ALLOWED")
  }

  // Poll only a change token, never primaryClip or item text/HTML/URI. The
  // description timestamp also detects a change whose listener callback is
  // still queued; API 24/25 use the listener and foreground invalidation.
  private fun clipboardVersion(): String {
    val manager = clipboard
    if (observedClipboard == null) {
      manager.addPrimaryClipChangedListener(clipboardListener)
      observedClipboard = manager
    }
    val stamp = if (Build.VERSION.SDK_INT >= 26) manager.primaryClipDescription?.timestamp else null
    return "$clipboardEpoch:${clipboardGeneration.get()}:$stamp"
  }

  private fun readClipboard(clip: ClipData): String {
    if (clip.itemCount != 1) throw Exception("CLIPBOARD_UNSUPPORTED")
    val item = clip.getItemAt(0)
    val result = JSONObject()
    item.text?.toString()?.takeIf { it.isNotEmpty() }?.let { result.put("text", it) }
    item.htmlText?.takeIf { it.isNotEmpty() }?.let { result.put("html", it) }
    item.uri?.let { uri -> if (uri.scheme == "http" || uri.scheme == "https") result.put("url", uri.toString()) }
    item.uri?.takeIf { it.scheme == "content" }?.let { uri ->
      val resolver = appContext.reactContext!!.contentResolver
      if (resolver.getType(uri)?.startsWith("image/") == true) {
        val bytes = resolver.openInputStream(uri)?.use { input ->
          val output = ClipboardImageOutput()
          val buffer = ByteArray(8192)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            output.write(buffer, 0, count)
          }
          output.toByteArray()
        } ?: throw Exception("CLIPBOARD_UNSUPPORTED")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || bounds.outWidth.toLong() * bounds.outHeight > IMAGE_PIXELS)
          throw Exception("CLIPBOARD_TOO_LONG")
        val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: throw Exception("CLIPBOARD_UNSUPPORTED")
        try {
          val output = ClipboardImageOutput()
          if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) throw Exception("CLIPBOARD_TOO_LONG")
          bitmap.recycle()
          result.put("png", output.base64())
        } finally { bitmap.recycle() }
      }
    }
    if (result.length() == 0) throw Exception("CLIPBOARD_UNSUPPORTED")
    return result.toString().also { if (it.length > 32 * 1024 * 1024) throw Exception("CLIPBOARD_TOO_LONG") }
  }

  private suspend fun writeClipboard(json: String, expectedVersion: String?): String = withContext(Dispatchers.IO) {
    withContext(Dispatchers.Main.immediate) {
      foreground()
      if (expectedVersion != null && clipboardVersion() != expectedVersion) throw Exception("CLIPBOARD_CHANGED")
    }
    if (json.length > 32 * 1024 * 1024) throw Exception("CLIPBOARD_TOO_LONG")
    val content = JSONObject(json)
    val html = content.optString("html", null)
    val text = content.optString("text", null) ?: html?.let { Html.fromHtml(it, Html.FROM_HTML_MODE_LEGACY).toString() }
    val uri = content.optString("url", null)?.let { Uri.parse(it) }
    val png = content.optString("png", null)
    var imageFile: File? = null
    var committed = false
    try {
      val clip = when {
        png != null -> {
          val bytes = Base64.decode(png, Base64.DEFAULT)
          if (bytes.size < 8 || !bytes.copyOfRange(0, 8).contentEquals(byteArrayOf(-119,80,78,71,13,10,26,10)))
            throw Exception("CLIPBOARD_UNSUPPORTED")
          val context = appContext.reactContext!!
          val directory = File(context.cacheDir, "remote-clipboard").apply { mkdirs() }
          // Temporary, grant-scoped clipboard images. Keep recent URIs readable;
          // sweep older images on the next write, outside all media libraries.
          directory.listFiles()?.filter { System.currentTimeMillis() - it.lastModified() > 3_600_000 }?.forEach { it.delete() }
          imageFile = File(directory, "${UUID.randomUUID()}.png")
          imageFile!!.writeBytes(bytes)
          val imageUri = FileProvider.getUriForFile(context, "${context.packageName}.remoteclipboard", imageFile!!)
          ClipData("Cindy", arrayOf("image/png"), ClipData.Item(text, html, null, imageUri))
        }
        text != null && html != null -> ClipData.newHtmlText("Cindy", text, html)
        text != null -> ClipData.newPlainText("Cindy", text)
        uri != null -> ClipData.newRawUri("Cindy", uri)
        else -> throw Exception("CLIPBOARD_UNSUPPORTED")
      }
      withContext(Dispatchers.Main.immediate) {
        foreground()
        if (expectedVersion != null && clipboardVersion() != expectedVersion) throw Exception("CLIPBOARD_CHANGED")
        clipboard.setPrimaryClip(clip)
        committed = true
        // Change the token before returning even if the notification is delayed.
        clipboardGeneration.incrementAndGet()
        clipboardVersion()
      }
    } finally {
      // Cancellation after publishing must not delete the image Android now owns.
      if (!committed) imageFile?.delete()
    }
  }
}
