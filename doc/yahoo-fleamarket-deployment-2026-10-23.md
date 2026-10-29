# Yahoo!フリマ 上线记录

部署日期：2026-10-23（Asia/Shanghai）。状态：已部署并接入线上 goods hunter。

## 阿里云 FC

| 配置 | 部署值 |
| --- | --- |
| 地域 | `cn-hangzhou` |
| 函数名 | `fetch-yahoo-fleamarket` |
| HTTP 入口 | `https://fetch-yeamarket-cuqfwgngdv.cn-hangzhou.fcapp.run/search` |
| 认证 | FC 签名认证，允许 POST |
| 内存／CPU | 2048 MB／1 vCPU |
| 超时／实例并发 | 120 秒／1 |
| 镜像标签 | `honmameiko/fetch-surugaya:yahoo-fleamarket-20261023-db40678834d7` |
| 镜像摘要 | `sha256:55fb8f297d9f3334ced0c38da924c593a95ab7feaa84e9b515bd2a18fdb85fa8` |

新函数沿用现有抓取函数的代理配置与日志配置。镜像使用独立版本标签，函数配置已解析到上述摘要。

## goods hunter

- 线上代码目录：`/home/wangming/project/goods_hunter`。
- 以上线基线 `4446157` 合入新功能，保留煤炉、日拍解析与通知修复；本地工作区也已同步到该基线。
- 已设置线上 `src/private/alicloud.json` 与 `dist/private/alicloud.json` 的 `yahooFleamarketUrl`，本地工作区配置也已更新。
- 服务沿用原有用户和 `bun run dev` 启动方式，HTTP 监听端口为 7001。
- 新增 `yahoo_fleamarket_hunter`、`yahoo_fleamarket_goods_record` 两张表及关联外键。部署前确认全部 4 条 schema 变更均属于这两张表，部署后剩余 schema 变更为 0。
- 启动日志已确认 `all YahooFleamarket hunters standing by!`，运行时平台注册列表包含 `YahooFleamarket`。

## 验证

- Yahoo!フリマ 监控、MySQL 持久化及任务接口测试通过。
- 线上原有煤炉／日拍的 12 项页面兼容回归测试通过。
- 构建、TypeScript 检查和相关源文件 lint 检查通过。
- 未签名请求被 FC 网关拒绝。
- 本地及线上机器均使用签名客户端请求新函数，关键词 `ちいかわ 缶バッジ`，返回 100 件 `OPEN` 商品。
- 上线后从实际应用目录使用已配置的 FC 地址再次冒烟测试通过；应用 HTTP 健康检查返回 200。

FC 客户端显式直连阿里云端点，避免继承本地进程代理导致调用返回 503。该行为有针对全局代理环境的回归测试。

本次部署提供监控能力，没有创建具体关键词订阅，也没有发送测试邮件。创建任务时使用 `type: "YahooFleamarket"`，参数示例见 [接入说明](yahoo-fleamarket-setup.md)。

## 回滚资料

服务器上保留了仅管理员可读的部署目录：

```text
/home/wangming/project/.goods_hunter-deployments/yahoo-fleamarket-20261023-db40678834d7/
```

其中 `before.tar.gz` 保存被覆盖文件及原 FC 配置，`added-files.json` 记录新增文件，`runtime.json` 保存原启动方式，`rollout-result.json` 记录成功结果。该目录含敏感配置备份，不应上传到仓库或公开分享。

第一次切换因服务器 Python 版本不支持重启脚本的参数而失败，原代码和配置已恢复；修正兼容方式后再次切换成功。最终应用、FC 和数据库核验均通过。
