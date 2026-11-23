# 谷子猎手 Android App

使用现有账号登录，服务地址默认填入 `https://hunter.example.invalid`。打开「主动模式」，在 App 里查看从开启后积累的未读新品。点「搜索最新商品」会立即执行该账号的搜索订阅。每个失败的站点都有自己的「重试」按钮，仅重跑该站点失败的订阅。商品卡片可打开原商品页。

账号默认使用被动模式，继续接收定时搜索邮件。模式开关控制搜索新品的通知方式，单品状态及价格变化仍会发邮件。

## 开发

客户端采用 Expo、React Native 和 TypeScript。使用 `-init-db` 准备 Go 服务所需的表结构，再启动服务。App 的公网服务地址需要 HTTPS。连接 USB 调试设备时可用 `adb reverse tcp:7001 tcp:7001`，在 App 中填入 `http://127.0.0.1:7001`。Android 模拟器可用 `http://10.0.2.2:7001`。

```bash
npm ci
npm run typecheck
npm run android
```

复用已有的 JDK、Android SDK 和 Gradle 缓存。在临时构建目录执行 `npx expo prebuild --platform android --no-install`，之后在生成的 `android/` 中运行 `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`。内部安装包应使用同一份本地签名密钥，便于覆盖升级。
