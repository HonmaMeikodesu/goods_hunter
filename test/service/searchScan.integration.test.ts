import { createConnection, Connection, getMetadataArgsStorage } from "typeorm";
import { AliCloudApi } from "../../src/api/alicloud";
import { MandarakeApi } from "../../src/api/site/mandarake";
import { MercariApi } from "../../src/api/site/mercari";
import { SurugayaApi } from "../../src/api/site/surugaya";
import { XianyuApi } from "../../src/api/site/xianyu";
import { YahooAuctionApi } from "../../src/api/site/yahoo";
import { YahooFleamarketApi } from "../../src/api/site/yahooFleamarket";
import { MandarakeHunter } from "../../src/model/mandarakeHunter";
import { MandarakeGoodsRecord } from "../../src/model/mandarakeGoodsRecord";
import { MercariHunter } from "../../src/model/mercariHunter";
import { MercariGoodsRecord } from "../../src/model/mercariGoodsRecord";
import { SearchScanRecord } from "../../src/model/searchScanRecord";
import { SurugayaHunter } from "../../src/model/surugaya";
import { SurugayaGoodsRecord } from "../../src/model/surugayaGoodsRecord";
import { GoodsHunterModelBase } from "../../src/model/types";
import { User } from "../../src/model/user";
import { XianyuHunter } from "../../src/model/xianyuHunter";
import { XianyuGoodsRecord } from "../../src/model/xianyuGoodsRecord";
import { YahooHunter } from "../../src/model/yahooHunter";
import { YahooAuctionRecord } from "../../src/model/yahooAuctionRecord";
import { YahooFleamarketHunter } from "../../src/model/yahooFleamarketHunter";
import { YahooFleamarketGoodsRecord } from "../../src/model/yahooFleamarketGoodsRecord";
import HunterBase from "../../src/service/hunterArsenal/base";
import { MandarakeHunterService } from "../../src/service/hunterArsenal/mandarake";
import { MercariHunterService } from "../../src/service/hunterArsenal/mercari";
import { SurugayaHunterService } from "../../src/service/hunterArsenal/surugaya";
import { XianyuHunterService } from "../../src/service/hunterArsenal/xianyu";
import { YahooHunterService } from "../../src/service/hunterArsenal/yahoo";
import { YahooFleamarketHunterService } from "../../src/service/hunterArsenal/yahooFleamarket";
import { SearchScanMonitor } from "../../src/service/searchScanMonitor";

const fixtureDescribe = process.env.SEARCH_SCAN_TEST_MYSQL_PORT ? describe : describe.skip;

fixtureDescribe("search scan report from the local FC HTTP handlers", () => {
  let connection: Connection;
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any;
  const sendEmail = jest.fn().mockResolvedValue(undefined);
  const contacts = { operator: "ops@example.invalid", watcher: "watcher@example.invalid" };
  const emailService = { sendEmail } as any;

  beforeAll(async () => {
    connection = await createConnection({
      name: "search-scan-fixture", type: "mysql", host: "127.0.0.1",
      port: Number(process.env.SEARCH_SCAN_TEST_MYSQL_PORT),
      username: "root", password: "search-scan-local-test-only", database: "search_scan_fixture",
      timezone: "+08:00", charset: "utf8mb4", synchronize: true,
      entities: getMetadataArgsStorage().tables.map(table => table.target as Function),
    });
  });

  afterAll(async () => {
    if (connection?.isConnected) await connection.close();
  });

  it("reports results for six sites and recognizes a repeat scan with no new items", async () => {
    const alicloudApi = Object.assign(new AliCloudApi(), {
      alicloudConfig: {
        accessKeyId: "fixture-key", accessKeySecret: "fixture-only",
        url: process.env.SEARCH_SCAN_TEST_HTML_FC_URL,
        yahooFleamarketUrl: process.env.SEARCH_SCAN_TEST_YAHOO_FC_URL,
        xianyuUrl: process.env.SEARCH_SCAN_TEST_XIANYU_FC_URL,
      },
      logger,
    });
    const monitor = Object.assign(new SearchScanMonitor(), {
      records: connection.getRepository(SearchScanRecord),
      mailInfo: { contactSystemOwner: contacts.operator },
      redisClient: { set: jest.fn().mockResolvedValueOnce("OK").mockResolvedValue(null) },
      emailService, logger,
    });
    const user = await connection.getRepository(User).save({ email: contacts.watcher, password: "fixture-only" });
    function connect<H extends HunterBase>(service: H, model: new () => GoodsHunterModelBase, deps: Partial<H>) {
      return Object.assign(service, {
        hunterModel: connection.getRepository(model), searchScanMonitor: monitor, emailService, logger,
        serverInfo: { serverHost: "http://fixture.invalid" },
      }, deps);
    }
    function withFc<T>(api: T): T {
      return Object.assign(api, { alicloudApi, logger });
    }
    async function scan(service: HunterBase, keyword: string, options = {}, repetitions = 1) {
      const id = "fixture-" + service.hunterType + "-" + keyword;
      await service.hunterModel.save({
        user, hunterInstanceId: id, schedule: "0 12 * * *",
        searchConditionSchema: JSON.stringify({ keyword, ...options }),
      });
      for (let attempt = 0; attempt < repetitions; attempt++) await service.goHunt(id);
    }

    const mercari = connect(new MercariHunterService(), MercariHunter, {
      mercariApi: withFc(new MercariApi()), mercariGoodsRecordModel: connection.getRepository(MercariGoodsRecord),
    });
    const surugaya = connect(new SurugayaHunterService(), SurugayaHunter, {
      suruguyaApi: withFc(new SurugayaApi()), surugayaGoodsRecordModel: connection.getRepository(SurugayaGoodsRecord),
    });
    const mandarake = connect(new MandarakeHunterService(), MandarakeHunter, {
      mandarakeApi: withFc(new MandarakeApi()), mandarakeGoodsRecordModel: connection.getRepository(MandarakeGoodsRecord),
    });
    const yahoo = connect(new YahooHunterService(), YahooHunter, {
      yahooApi: withFc(new YahooAuctionApi()), yahooAuctionRecordModel: connection.getRepository(YahooAuctionRecord),
    });
    const fleaMarket = connect(new YahooFleamarketHunterService(), YahooFleamarketHunter, {
      yahooFleamarketApi: withFc(new YahooFleamarketApi()),
      goodsRecordModel: connection.getRepository(YahooFleamarketGoodsRecord),
    });
    const xianyu = connect(new XianyuHunterService(), XianyuHunter, {
      xianyuApi: withFc(new XianyuApi()), goodsRecordModel: connection.getRepository(XianyuGoodsRecord),
    });

    jest.useFakeTimers({
      now: new Date("2035-07-22T12:00:00+08:00"),
      doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate",
        "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    try {
      await scan(mercari, "mock-items", {}, 2);
      await scan(mercari, "mock-empty");
      await scan(mercari, "mock-parse-error");
      await scan(surugaya, "mock-items");
      await scan(surugaya, "mock-empty");
      await scan(surugaya, "mock-shell", {}, 2);
      await scan(surugaya, "mock-challenge");
      await scan(surugaya, "mock-disconnect");
      await scan(mandarake, "mock-sold");
      await scan(mandarake, "mock-shell");
      await scan(yahoo, "mock-items");
      await scan(yahoo, "mock-empty");
      await scan(yahoo, "mock-stale", { epoch: 2 });
      await scan(fleaMarket, "mock-items");
      await scan(fleaMarket, "mock-empty");
      await scan(fleaMarket, "mock-stale", { epoch: 2 });
      await scan(xianyu, "mock-items");
      await scan(xianyu, "mock-empty");
      await scan(xianyu, "mock-challenge");
      await scan(xianyu, "mock-empty-with-more");
    } finally {
      jest.useRealTimers();
    }

    const runAt = new Date("2035-07-22T22:00:00+08:00");
    await Promise.all([monitor.reportToday(runAt), monitor.reportToday(runAt)]);
    const reports = sendEmail.mock.calls.map(([message]) => message).filter(message => message.to === contacts.operator);
    expect(reports).toHaveLength(1);
    const report = reports[0].text;
    console.info("Synthetic search scan report\n" + report);
    expect(report).toBe([
      "2035-07-22 00:00–22:00（北京时间）",
      "",
      "Mercari｜共 4 次 · 有效 3 次 (75.0%) · 异常 1 次 (25.0%)",
      "  商品列表无法解析 1 次 (100.0%)",
      "Yahoo!オークション｜共 3 次 · 有效 2 次 (66.7%) · 异常 1 次 (33.3%)",
      "  返回页与目标搜索不符 1 次 (100.0%)",
      "骏河屋｜共 6 次 · 有效 2 次 (33.3%) · 异常 4 次 (66.7%)",
      "  页面无法证实有结果或明确为空 2 次 (50.0%)",
      "  Cloudflare 验证 1 次 (25.0%)",
      "  上游连接关闭 1 次 (25.0%)",
      "Mandarake｜共 2 次 · 有效 1 次 (50.0%) · 异常 1 次 (50.0%)",
      "  页面无法证实有结果或明确为空 1 次 (100.0%)",
      "Yahoo!フリマ｜共 3 次 · 有效 2 次 (66.7%) · 异常 1 次 (33.3%)",
      "  搜索页结构异常 1 次 (100.0%)",
      "闲鱼｜共 4 次 · 有效 2 次 (50.0%) · 异常 2 次 (50.0%)",
      "  站点要求安全验证 1 次 (50.0%)",
      "  搜索响应结构异常 1 次 (50.0%)",
    ].join("\n"));

    const mercariMail = sendEmail.mock.calls.map(([message]) => message)
      .filter(message => message.to === contacts.watcher && /mercari goods/.test(message.subject));
    expect(mercariMail).toHaveLength(1);
    expect(mercariMail[0].html).toContain("价格暂缺");
  }, 180_000);
});
