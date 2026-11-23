package com.honmameiko.goodshunter

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.ViewManager
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONObject
import org.json.JSONTokener

private const val REQUEST_PHONE_SEARCH = 7416
private const val MAX_RESULT_CHARS = 150_000
private const val SEARCH_URL = "searchUrl"
private const val PAGE_URL = "pageUrl"
private const val ITEMS = "items"
private const val MODULE_NAME = "GoodsHunterPhoneSearch"

private fun allowedPage(url: Uri) = url.scheme == "https" && url.host == "www.suruga-ya.jp" &&
  url.userInfo == null && (url.port == -1 || url.port == 443)

private fun searchPage(url: Uri) = allowedPage(url) && url.path?.trimEnd('/') == "/search"

@ReactModule(name = MODULE_NAME)
class PhoneSearchModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  private val pending = AtomicReference<Promise?>(null)
  private val listener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_PHONE_SEARCH) return
      val promise = pending.getAndSet(null) ?: return
      if (resultCode != Activity.RESULT_OK || data == null) {
        promise.resolve(null)
        return
      }
      promise.resolve(Arguments.createMap().apply {
        putString(PAGE_URL, data.getStringExtra(PAGE_URL))
        putString(ITEMS, data.getStringExtra(ITEMS))
      })
    }
  }

  init { context.addActivityEventListener(listener) }

  override fun getName() = MODULE_NAME

  @ReactMethod
  fun search(url: String, promise: Promise) {
    if (url.length > 4096 || !searchPage(Uri.parse(url))) {
      promise.reject("phone_search_url", "骏河屋搜索链接无效。")
      return
    }
    UiThreadUtil.runOnUiThread {
      val activity = context.currentActivity
      if (activity == null || !pending.compareAndSet(null, promise)) {
        promise.reject("phone_search_unavailable", "暂时无法打开手机搜索。")
        return@runOnUiThread
      }
      try {
        val intent = Intent(activity, PhoneSearchActivity::class.java).putExtra(SEARCH_URL, url)
        @Suppress("DEPRECATION")
        activity.startActivityForResult(intent, REQUEST_PHONE_SEARCH)
      } catch (error: RuntimeException) {
        pending.compareAndSet(promise, null)
        promise.reject("phone_search_start", "无法打开骏河屋搜索页。", error)
      }
    }
  }

  override fun invalidate() {
    context.removeActivityEventListener(listener)
    pending.set(null)
    super.invalidate()
  }
}

class PhoneSearchPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(PhoneSearchModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class PhoneSearchActivity : Activity() {
  private lateinit var browser: WebView
  private lateinit var message: TextView
  private lateinit var extract: Button
  private lateinit var startURL: String
  private lateinit var script: String
  private var navigation = 0
  private var loadFailed = false
  private var autoExtract = true

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    startURL = intent.getStringExtra(SEARCH_URL).orEmpty()
    if (startURL.length > 4096 || !searchPage(Uri.parse(startURL))) {
      finish()
      return
    }
    script = assets.open("surugaya-results.js").bufferedReader().use { it.readText() }
    browser = WebView(this)
    val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
      val area = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
      view.setPadding(area.left, area.top, area.right, area.bottom)
      insets
    }
    val actions = LinearLayout(this)
    actions.addView(Button(this).apply { text = "关闭"; setOnClickListener { finish() } })
    actions.addView(Button(this).apply {
      text = "回到搜索"
      setOnClickListener { browser.loadUrl(startURL) }
    })
    extract = Button(this).apply {
      text = "提取本页"
      isEnabled = false
      setOnClickListener { capture() }
    }
    actions.addView(extract)
    root.addView(actions)
    message = TextView(this).apply { text = "正在打开骏河屋搜索页…" }
    root.addView(message)
    root.addView(browser, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
    setContentView(root)
    configureBrowser()
    browser.loadUrl(startURL)
  }

  @Suppress("SetJavaScriptEnabled")
  private fun configureBrowser() {
    browser.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      allowFileAccess = false
      allowContentAccess = false
      mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
    }
    browser.webViewClient = object : WebViewClient() {
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame || allowedPage(request.url)) return false
        message.text = "该链接会离开骏河屋，可返回任务使用「去原站搜索」。"
        return true
      }

      override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
        navigation++
        loadFailed = false
        message.text = "正在加载页面…"
        extract.isEnabled = false
      }

      override fun onPageFinished(view: WebView, url: String) {
        if (isFinishing || loadFailed || url != view.url) return
        if (!matchesSavedSearch(url)) {
          message.text = "请完成原站操作，再点「回到搜索」。"
          return
        }
        message.text = "可提取已加载的商品。"
        extract.isEnabled = true
        if (autoExtract) {
          val generation = navigation
          browser.postDelayed({
            if (generation == navigation && extract.isEnabled && autoExtract && !isFinishing && !isDestroyed) capture()
          }, 350L)
        }
      }

      override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (request.isForMainFrame) failLoading()
      }

      override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
        if (request.isForMainFrame) failLoading()
      }
    }
  }

  private fun failLoading() {
    loadFailed = true
    extract.isEnabled = false
    message.text = "骏河屋页面加载失败，可点「回到搜索」重试。"
  }

  private fun matchesSavedSearch(url: String): Boolean {
    if (url.length > 4096) return false
    val current = Uri.parse(url)
    if (!searchPage(current)) return false
    val expected = Uri.parse(startURL)
    val defaults = mapOf("search_word" to "", "category" to "", "page" to "1", "adult_s" to "2", "is_marketplace" to "", "rankBy" to "")
    return defaults.all { (key, fallback) ->
      val actual = current.getQueryParameters(key)
      actual.size <= 1 && (actual.firstOrNull() ?: fallback) == (expected.getQueryParameter(key) ?: fallback)
    }
  }

  private fun capture() {
    val url = browser.url ?: return
    if (loadFailed || !matchesSavedSearch(url)) return
    autoExtract = false
    extract.isEnabled = false
    message.text = "正在读取商品…"
    val generation = navigation
    browser.evaluateJavascript(script) { raw ->
      if (isFinishing || isDestroyed || navigation != generation || browser.url != url || loadFailed) return@evaluateJavascript
      val items = runCatching {
        val result = JSONTokener(raw).nextValue() as? String
        result?.takeIf { it.length <= MAX_RESULT_CHARS }?.let { JSONObject(it).getJSONArray(ITEMS).toString() }
      }.getOrNull()
      if (items == null) {
        message.text = "尚未识别到商品或空结果。请确认页面已加载，再点「提取本页」。"
        extract.isEnabled = true
        return@evaluateJavascript
      }
      setResult(RESULT_OK, Intent().putExtra(PAGE_URL, startURL).putExtra(ITEMS, items))
      finish()
    }
  }

  override fun onDestroy() {
    navigation++
    if (::browser.isInitialized) {
      (browser.parent as? ViewGroup)?.removeView(browser)
      browser.stopLoading()
      browser.destroy()
    }
    super.onDestroy()
  }
}
