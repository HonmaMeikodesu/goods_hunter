# 谷子猎手 Android App

首次登录填写自己的 HTTPS 服务地址、现有邮箱、密码和连接码。会话和服务地址存入 Android SecureStore。

打开「主动模式」，在 App 里查看从开启后积累的未读新品。点「搜索最新商品」立即执行该账号的搜索订阅。每个失败的站点都有自己的「重试」按钮，仅重跑该站点失败的订阅。商品卡片可打开原商品页。

点站点名称可展开该站的定时任务。骏河屋标出开启成人模式的任务。Yahoo! オークション的「その他」标为「含成人分类」，已核实的成人分类标为「仅成人」。每个任务的「去原站搜索」会用该任务的关键词和站点分类打开搜索页。

账号默认使用被动模式，继续接收定时搜索邮件。模式开关控制搜索新品的通知方式，单品状态及价格变化仍会发邮件。

## 开发

客户端采用 Expo、React Native 和 TypeScript。使用 `-init-db` 准备 Go 服务所需的表结构，并设置 `GOODS_HUNTER_MOBILE_CODE` 后启动开发服务。连接 USB 调试设备时可用 `adb reverse tcp:7001 tcp:7001`，在开发版 App 中填入 `http://127.0.0.1:7001`。Android 模拟器可用 `http://10.0.2.2:7001`。

```bash
npm ci
npm run typecheck
npm run android
```

## 更新与发布

在首页打开「应用更新」，点「检查更新」。发现新 APK 后点「在 App 内下载」，下载完成点「安装新版本」，由安卓确认覆盖安装。App 使用当前登录会话自动取得限时下载授权，并校验包名、版本、长度、SHA-256 和现有安装签名。覆盖安装保留本机数据。首次安装的网页入口为自建服务的 `/api/mobile/updates/download`。

App 登录后每小时至多自动检查一次。发布者可在私有构建环境设置 `GOODS_HUNTER_UPDATES_ORIGIN` 启用签名热更新。登录地址与该 HTTPS 来源一致时，App 检查该来源的热更新。涉及原生依赖、权限或桌面图标的改动要发布新版 APK。

复用已有的 JDK、Android SDK 和 Gradle 缓存，在临时构建目录安装依赖。使用 `node node_modules/expo-updates/bin/cli.js runtimeversion:resolve --platform android --workflow managed` 取得指纹。设置 `GOODS_HUNTER_RUNTIME_VERSION` 为该指纹后执行 `npx expo prebuild --platform android --no-install`，将同一份 `mobile/.local/internal.keystore` 复制为 `android/app/debug.keystore`，然后在生成的 `android/` 中执行 `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`。

用 `node scripts/prepare-release.mjs apk <发布目录> <APK> <原生指纹> <说明>` 准备原生版本。自建签名热更新时，在构建副本中放入对应的公开证书 `updates-certificate.pem`。热更新沿用 APK 的原生指纹和 `GOODS_HUNTER_UPDATES_ORIGIN`，执行 `npx expo export --platform android`，再运行 `node scripts/prepare-release.mjs hot <发布目录> <导出目录> <原生指纹> <说明>`，以 `GOODS_HUNTER_UPDATES_KEY` 指定本地签名私钥。发布更新时先传内容哈希命名的文件，再原子替换对应清单或 `latest.json`。

更新私钥、APK 签名和连接码保存在 `mobile/.local/`。Go 服务读取 `GOODS_HUNTER_MOBILE_ORIGIN`、`GOODS_HUNTER_MOBILE_CODE` 与 `GOODS_HUNTER_UPDATES_DIR`。更换连接码会使原有 App 会话和下载链接失效，网页会话可以继续使用。

面码小头像与桌面图标沿用 `I-Need-To-Be-A-Hongkonger` 的素材，放大镜用于首页和登录，齿轮用于应用更新，沙漏用于空列表。
