# goods_hunter

本仓库负责商品监控的任务调度、筛选、去重和通知。[bypass-cloudflare](https://github.com/HonmaMeikodesu/bypass-cloudflare) 是配套采集工程，提供浏览器采集与阿里云函数计算（FC）服务，包括骏河屋等站点使用的通用 HTML 抓取入口，以及 Yahoo!フリマ 专用采集入口。

涉及采集接口或 FC 部署变更时，同时检查配套仓库与本仓库调用方。Yahoo!フリマ 的联动详见 [接入与部署说明](doc/yahoo-fleamarket-setup.md)。
