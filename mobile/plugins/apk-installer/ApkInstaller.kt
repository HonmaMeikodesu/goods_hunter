package com.honmameiko.goodshunter

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class ApkFileProvider : FileProvider()

@ReactModule(name = "GoodsHunterApkInstaller")
class ApkInstallerModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val worker = Executors.newSingleThreadExecutor()
  private val downloading = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  @Volatile private var connection: HttpURLConnection? = null
  @Volatile private var received = 0L
  @Volatile private var total = 0L
  private val directory get() = File(context.cacheDir, "apk-updates").apply { check(mkdirs() || isDirectory) }
  override fun getName() = "GoodsHunterApkInstaller"
  private fun payload(value: ReadableMap): ApkPayload {
    val code = value.getDouble("versionCode"); val bytes = value.getDouble("bytes")
    require(code.isFinite() && code == code.toLong().toDouble() && bytes.isFinite() && bytes == bytes.toLong().toDouble())
    return ApkPayload(value.getString("version")!!, code.toLong(), value.getString("downloadUrl")!!,
      value.getString("sha256")!!, bytes.toLong())
  }
  @Suppress("DEPRECATION")
  private fun signers(info: PackageInfo): Set<String> {
    val signatures = if (Build.VERSION.SDK_INT >= 28) info.signingInfo?.apkContentsSigners else info.signatures
    return signatures?.map { ApkPayload.hex(MessageDigest.getInstance("SHA-256").digest(it.toByteArray())) }?.toSet() ?: emptySet()
  }
  @Suppress("DEPRECATION")
  private fun verify(release: ApkPayload, file: File) {
    check(release.verify(file))
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val pm = context.packageManager
    val archive = checkNotNull(pm.getPackageArchiveInfo(file.path, flags))
    val installed = pm.getPackageInfo(context.packageName, flags)
    fun code(info: PackageInfo): Long = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
    release.requireUpgrade(archive.packageName, context.packageName, archive.versionName, code(archive), code(installed), signers(archive), signers(installed))
  }
  @ReactMethod
  fun cached(value: ReadableMap, promise: Promise) {
    val release = try { payload(value) } catch (_: Exception) { promise.resolve(false); return }
    worker.execute {
      val valid = try { verify(release, File(directory, release.filename)); true } catch (_: Exception) { false }
      promise.resolve(valid)
    }
  }
  @ReactMethod
  fun progress(promise: Promise) { promise.resolve(Arguments.createMap().apply { putDouble("received", received.toDouble()); putDouble("total", total.toDouble()) }) }
  @ReactMethod
  fun cancel(promise: Promise) { cancelled.set(true); connection?.disconnect(); promise.resolve(null) }

  @ReactMethod
  fun download(value: ReadableMap, promise: Promise) {
    val release = try { payload(value) } catch (_: Exception) { promise.reject("apk_invalid", "安装包信息无效，请重新检查更新"); return }
    if (!downloading.compareAndSet(false, true)) { promise.reject("apk_busy", "安装包正在下载"); return }
    cancelled.set(false); received = 0L; total = release.bytes
    worker.execute {
      var part: File? = null
      try {
        require(release.versionCode > BuildConfig.VERSION_CODE)
        val file = File(directory, release.filename)
        if (file.exists()) {
          try { verify(release, file); promise.resolve(null); return@execute }
          catch (_: Exception) { check(file.delete()) }
        }
        directory.listFiles()?.forEach { if (it.isFile) it.delete() }
        check(directory.usableSpace > release.bytes + 16 * 1024 * 1024)
        val partial = File(directory, "pending-${release.filename}"); part = partial
        var url = URL(release.downloadUrl)
        val started = System.nanoTime()
        for (redirect in 0..5) {
          if (cancelled.get()) throw CancellationException()
          require(ApkPayload.secureUrl(url.toString()))
          val request = url.openConnection() as HttpURLConnection
          connection = request
          request.instanceFollowRedirects = false; request.connectTimeout = 15000; request.readTimeout = 20000
          request.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream")
          request.setRequestProperty("Accept-Encoding", "identity")
          request.setRequestProperty("User-Agent", "GoodsHunterAndroid/" + BuildConfig.VERSION_NAME)
          try {
            val status = request.responseCode
            if (status in listOf(301, 302, 303, 307, 308)) {
              check(redirect < 5)
              url = URL(url, checkNotNull(request.getHeaderField("Location")))
              continue
            }
            check(status == 200)
            val length = request.getHeaderFieldLong("Content-Length", -1)
            check(length == -1L || length == release.bytes)
            request.inputStream.use { input -> partial.outputStream().use { output ->
              release.copy(input, output, { cancelled.get() }, { count ->
                check(System.nanoTime() - started < 10L * 60 * 1_000_000_000)
                received = count
              })
              output.fd.sync()
            } }
            verify(release, partial)
            if (cancelled.get()) throw CancellationException()
            check(partial.renameTo(file))
            promise.resolve(null)
            return@execute
          } finally { request.disconnect(); connection = null }
        }
        error("Redirect limit exceeded")
      } catch (_: Exception) {
        promise.reject(if (cancelled.get()) "apk_cancelled" else "apk_download_failed", if (cancelled.get()) "已取消下载" else "安装包下载或校验失败，请重试")
      } finally { part?.delete(); downloading.set(false) }
    }
  }

  @ReactMethod
  fun install(value: ReadableMap, promise: Promise) {
    val release = try { payload(value) } catch (_: Exception) { promise.reject("apk_invalid", "安装包信息无效"); return }
    if (downloading.get()) { promise.reject("apk_busy", "请等待下载完成"); return }
    worker.execute {
      try {
        val file = File(directory, release.filename)
        verify(release, file)
        context.runOnUiQueueThread {
          try {
            val activity = checkNotNull(context.currentActivity)
            check(context.lifecycleState == LifecycleState.RESUMED && !activity.isFinishing)
            if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
              activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
              promise.resolve("permission")
            } else {
              val uri = FileProvider.getUriForFile(context, "${context.packageName}.apk-updates", file)
              activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData = ClipData.newRawUri("安装包", uri)
              })
              promise.resolve("installer")
            }
          } catch (_: Exception) { promise.reject("apk_install_failed", "无法打开系统安装界面，请重试") }
        }
      } catch (_: Exception) { promise.reject("apk_invalid", "安装包已失效，请重新下载") }
    }
  }
  override fun invalidate() {
    cancelled.set(true); connection?.disconnect(); worker.shutdownNow(); super.invalidate()
  }
}

class ApkInstallerPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ApkInstallerModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
