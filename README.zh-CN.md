# my-midway-project

Yahoo!フリマ 的 FC 开发、部署配置与任务接口见 [接入说明](doc/yahoo-fleamarket-setup.md)。

Yahoo 拍卖的远程登录、headless Cookie 自动刷新与应用接入见 [会话维护说明](doc/yahoo-session-setup.md)。

Yahoo 拍卖需要重新登录时，在本地图形终端运行 `./tools/yahoo-session/login-x11.sh`，即可弹出云服务器上的登录浏览器；登录成功后自动保存会话并关闭。

## 快速入门

<!-- 在此次添加使用文档 -->

如需进一步了解，参见 [midway 文档][midway]。

### 本地开发

```bash
$ npm i
$ npm run dev
$ open http://localhost:7001/
```

### 部署

```bash
$ npm start
$ npm stop
```

### 内置指令

- 使用 `npm run lint` 来做代码风格检查。
- 使用 `npm test` 来执行单元测试。


[midway]: https://midwayjs.org
