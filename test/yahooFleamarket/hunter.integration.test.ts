import { createConnection, Connection, getMetadataArgsStorage, Repository } from "typeorm";
import { v4 as uuid } from "uuid";
import { User } from "../../src/model/user";
import { YahooFleamarketHunter } from "../../src/model/yahooFleamarketHunter";
import { YahooFleamarketGoodsRecord } from "../../src/model/yahooFleamarketGoodsRecord";
import { YahooFleamarketHunterService } from "../../src/service/hunterArsenal/yahooFleamarket";
import { normalizeYahooFleamarketCondition } from "../../src/api/site/yahooFleamarket/conditions";
import { GoodsService } from "../../src/service/goods";
import { HunterRouteService } from "../../src/service/hunterRouteService";

const dbDescribe = process.env.YAHOO_TEST_MYSQL_PORT ? describe : describe.skip;
const good = (id: string) => ({ id, name: `<谷子> ${id}`, price: 1000, status: "OPEN", thumbnailImageUrl: "", itemUrl: `https://paypayfleamarket.yahoo.co.jp/item/${id}` });

dbDescribe("Yahoo!フリマ hunter with MySQL", () => {
  let connection: Connection;
  let hunters: Repository<YahooFleamarketHunter>;
  let records: Repository<YahooFleamarketGoodsRecord>;
  let user: User;
  let service: YahooFleamarketHunterService;
  let fetch: jest.Mock;
  let send: jest.Mock;
  let id: string;
  const database = `yahoo_fleamarket_test_${process.pid}`;
  const options = {
    type: "mysql" as const, host: "127.0.0.1", port: Number(process.env.YAHOO_TEST_MYSQL_PORT),
    username: "root", password: "yahoo-local-test-only", charset: "utf8mb4",
  };
  beforeAll(async () => {
    const admin = await createConnection({ ...options, name: "yahoo-test-admin" });
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
    await admin.close();
    connection = await createConnection({ ...options, name: "yahoo-test", database,
      entities: getMetadataArgsStorage().tables.map(table => table.target as Function), synchronize: true,
    });
    hunters = connection.getRepository(YahooFleamarketHunter);
    records = connection.getRepository(YahooFleamarketGoodsRecord);
    user = await connection.getRepository(User).save({ email: "yahoo-test@example.invalid", password: "test-only" });
  });
  afterAll(async () => {
    if (connection?.isConnected) { await connection.query(`DROP DATABASE \`${database}\``); await connection.close(); }
  });
  beforeEach(async () => {
    await hunters.createQueryBuilder().delete().execute();
    id = uuid();
    await hunters.save({ hunterInstanceId: id, user, schedule: "*/10 * * * *", searchConditionSchema: JSON.stringify(normalizeYahooFleamarketCondition({ keyword: "谷子" })) });
    service = new YahooFleamarketHunterService();
    service.hunterModel = hunters;
    service.goodsRecordModel = records;
    fetch = jest.fn().mockResolvedValue([good("h1")]);
    send = jest.fn().mockResolvedValue(undefined);
    service.yahooFleamarketApi = { fetchGoodsList: fetch } as any;
    service.emailService = { sendEmail: send } as any;
    service.logger = { info: jest.fn(), error: jest.fn() } as any;
    (service as any).cronList[id] = { id, schedule: "*/10 * * * *", jobInstance: { stop: jest.fn(), setTime: jest.fn(), start: jest.fn() } };
  });

  it("seeds a baseline, sends only unseen IDs, and persists deduplication across service restarts", async () => {
    await service.goHunt(id);
    expect(send).not.toHaveBeenCalled();
    expect((await hunters.findOne(id)).initialized).toBe(true);
    expect(await records.count()).toBe(1);
    fetch.mockResolvedValue([good("h1"), good("o2")]);
    await service.goHunt(id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].html).toContain("/item/o2");
    expect(send.mock.calls[0][0].html).not.toContain("/item/h1");
    expect(send.mock.calls[0][0].html).toContain("&lt;谷子&gt;");
    // A fresh service instance must reuse persisted IDs, not process memory.
    const restarted = Object.assign(new YahooFleamarketHunterService(), {
      hunterModel: hunters, goodsRecordModel: records, yahooFleamarketApi: service.yahooFleamarketApi,
      emailService: service.emailService, logger: service.logger,
    });
    await restarted.goHunt(id);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("can notify existing results and retries a failed email from pending records", async () => {
    await hunters.update(id, { searchConditionSchema: JSON.stringify(normalizeYahooFleamarketCondition({ keyword: "谷子", notifyExisting: true })) });
    send.mockRejectedValueOnce(new Error("SMTP unavailable"));
    await service.goHunt(id);
    expect(await records.count({ notificationPending: true })).toBe(1);
    await service.goHunt(id);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await records.count({ notificationPending: true })).toBe(0);
    expect((await records.findOne({ id: "h1" })).notifiedAt).toBeInstanceOf(Date);
  });

  it("keeps failed FC scans out of the baseline", async () => {
    fetch.mockRejectedValueOnce(new Error("FC timeout"));
    await service.goHunt(id);
    expect((await hunters.findOne(id)).initialized).toBe(false);
    expect(await records.count()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("serializes overlapping cron invocations", async () => {
    let finish: (value: any) => void;
    fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = service.goHunt(id);
    while (!finish) await new Promise(resolve => setImmediate(resolve));
    await service.goHunt(id);
    expect(fetch).toHaveBeenCalledTimes(1);
    finish([good("h1")]);
    await first;
  });

  it("resets the baseline for a changed filter, but preserves it for a schedule change", async () => {
    await service.goHunt(id);
    await service.transfer(id, { schedule: "*/20 * * * *", searchCondition: { keyword: "谷子" } });
    expect((await hunters.findOne(id)).initialized).toBe(true);
    expect(await records.count()).toBe(1);
    await service.transfer(id, { schedule: "*/20 * * * *", searchCondition: { keyword: "谷子", maxPrice: 2000 } });
    expect((await hunters.findOne(id)).initialized).toBe(false);
    expect(await records.count()).toBe(0);
  });

  it("discards fetched results if the task changes during the request", async () => {
    fetch.mockImplementationOnce(async () => {
      await hunters.update(id, { searchConditionSchema: JSON.stringify({ keyword: "別の商品" }) });
      return [good("h1")];
    });
    await service.goHunt(id);
    expect(await records.count()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the dedicated task model for ownership checks and cascades deletion", async () => {
    await service.goHunt(id);
    const goods = new GoodsService();
    goods.yahooFleamarketHunterModel = hunters;
    goods.ctx = { user: { email: "other@example.invalid" } } as any;
    goods.hunterRouteService = { dismissHunter: jest.fn(), transferHunter: jest.fn() } as any;
    await expect(goods.deleteTask(id, "YahooFleamarket")).rejects.toThrow();
    await expect(goods.updateTask(id, { type: "YahooFleamarket", schedule: "*/10 * * * *", searchCondition: { keyword: "谷子" } })).rejects.toThrow();
    expect(goods.hunterRouteService.dismissHunter).not.toHaveBeenCalled();
    goods.ctx = { user: { email: user.email } } as any;
    await goods.deleteTask(id, "YahooFleamarket");
    expect(goods.hunterRouteService.dismissHunter).toHaveBeenCalledWith(id, "YahooFleamarket");
    await service.dismiss(id);
    expect(await records.count()).toBe(0);
  });

  it("creates, lists, updates, and deletes a task through the integrated services", async () => {
    service.databaseTransactionWrapper = async funcs => {
      const runner = connection.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await funcs.pending(runner);
        await runner.commitTransaction();
        if (funcs.resolved) await funcs.resolved(runner);
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally { await runner.release(); }
    };
    jest.spyOn(service, "spawnCronJob").mockImplementation(async (taskId, schedule) => {
      (service as any).cronList[taskId] = { id: taskId, schedule, jobInstance: { stop: jest.fn(), setTime: jest.fn(), start: jest.fn() } };
    });
    const route = new HunterRouteService();
    route.yahooFleamarketHunter = service;
    const ctx = { user: { email: user.email } } as any;
    const taskId = await service.hire(ctx, { type: "YahooFleamarket", user: { email: user.email }, schedule: "*/10 * * * *", searchCondition: { keyword: "新しい谷子" } });
    expect((await hunters.findOne(taskId as string, { relations: ["user"] })).user.email).toBe(user.email);
    expect((await service.getCronList(user.email)).find(task => task.hunterInstanceId === taskId).type).toBe("YahooFleamarket");
    const goods = new GoodsService();
    goods.yahooFleamarketHunterModel = hunters;
    goods.ctx = ctx;
    goods.hunterRouteService = route;
    await goods.updateTask(taskId as string, { type: "YahooFleamarket", schedule: "*/20 * * * *", searchCondition: { keyword: "更新した谷子" } });
    expect(JSON.parse((await hunters.findOne(taskId as string)).searchConditionSchema).keyword).toBe("更新した谷子");
    await goods.deleteTask(taskId as string, "YahooFleamarket");
    expect(await hunters.findOne(taskId as string)).toBeUndefined();
  });
});
