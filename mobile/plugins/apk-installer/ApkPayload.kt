package com.honmameiko.goodshunter

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.CancellationException

data class ApkPayload(val version: String, val versionCode: Long, val downloadUrl: String, val sha256: String, val bytes: Long) {
  init {
    require(version.matches(Regex("\\d+\\.\\d+\\.\\d+")))
    require(versionCode in 1..Int.MAX_VALUE.toLong())
    require(sha256.matches(Regex("[a-f0-9]{64}")))
    require(bytes in 1..200L * 1024 * 1024)
    require(downloadUrl.length <= 4096 && secureUrl(downloadUrl))
  }
  val filename get() = "$versionCode-$sha256.apk"

  fun verify(file: File): Boolean {
    if (!file.isFile || file.length() != bytes) return false
    return file.inputStream().use { hash(it) } == sha256
  }

  fun copy(input: InputStream, output: OutputStream, cancelled: () -> Boolean, progress: (Long) -> Unit) {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(64 * 1024)
    var received = 0L
    while (true) {
      if (cancelled()) throw CancellationException()
      val count = input.read(buffer)
      if (count < 0) break
      received += count
      require(received <= bytes) { "APK exceeds declared length" }
      output.write(buffer, 0, count); digest.update(buffer, 0, count); progress(received)
    }
    if (cancelled()) throw CancellationException()
    require(received == bytes && hex(digest.digest()) == sha256) { "APK integrity mismatch" }
  }

  fun requireUpgrade(packageName: String, installedPackage: String, actualVersion: String?, actualCode: Long,
    installedCode: Long, actualSigners: Set<String>, installedSigners: Set<String>) {
    require(packageName == installedPackage && actualVersion == version && actualCode == versionCode && actualCode > installedCode)
    require(actualSigners.isNotEmpty() && actualSigners == installedSigners)
  }

  companion object {
    fun secureUrl(value: String): Boolean = try {
      val uri = URI(value)
      uri.scheme.equals("https", ignoreCase = true) && !uri.host.isNullOrBlank() &&
        uri.rawUserInfo == null && uri.rawFragment == null && uri.rawPath.startsWith("/api/mobile/updates/")
    } catch (_: Exception) { false }
    fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    fun hash(input: InputStream): String {
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(64 * 1024)
      while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
      return hex(digest.digest())
    }
  }
}
