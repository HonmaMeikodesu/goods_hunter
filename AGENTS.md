# goods_hunter

本仓库负责商品监控的任务调度、筛选、去重和通知。[bypass-cloudflare](https://github.com/HonmaMeikodesu/bypass-cloudflare) 是配套采集工程，提供浏览器采集与阿里云函数计算（FC）服务，包括骏河屋等站点使用的通用 HTML 抓取入口，以及 Yahoo!フリマ 专用采集入口。

涉及采集接口或 FC 部署变更时，同时检查配套仓库与本仓库调用方。Yahoo!フリマ 的联动详见 [接入与部署说明](doc/yahoo-fleamarket-setup.md)。

提交前检查源码、文档、脚本和构建配置。真实部署域名、IP、回源地址、私有下载链接及凭据只放在环境变量或 Git 忽略的私有配置中。公开示例使用保留域名或示例 IP，App 的服务地址由用户填写。
