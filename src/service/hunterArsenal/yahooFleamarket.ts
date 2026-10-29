import { Init, Inject, Provide, Scope, ScopeEnum, TaskLocal } from "@midwayjs/decorator";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { In, Repository } from "typeorm";
import { CronTime } from "cron";
import { render } from "ejs";
import HunterBase from "./base";
import { YahooFleamarketApi } from "../../api/site/yahooFleamarket";
import { normalizeYahooFleamarketCondition } from "../../api/site/yahooFleamarket/conditions";
import { YahooFleamarketHunter as YahooFleamarketHunterModel } from "../../model/yahooFleamarketHunter";
import { YahooFleamarketGoodsRecord } from "../../model/yahooFleamarketGoodsRecord";
import { YahooFleamarketHunter as YahooFleamarketHunterInfo } from "../../types";
import { yahooFleamarketGoodsList } from "../../template";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import errorCode from "../../errorCode";

@Provide()
@Scope(ScopeEnum.Singleton)
export class YahooFleamarketHunterService extends HunterBase {
  hunterType = "YahooFleamarket" as const;
  private running = new Set<string>();

  @Inject()
  yahooFleamarketApi: YahooFleamarketApi;

  @InjectEntityModel(YahooFleamarketHunterModel)
  hunterModel: Repository<YahooFleamarketHunterModel>;

  @InjectEntityModel(YahooFleamarketGoodsRecord)
  goodsRecordModel: Repository<YahooFleamarketGoodsRecord>;

  @Init()
  async init() {
    await super.init();
  }

  @TaskLocal("*/2 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  async hire(ctx: Context, info: YahooFleamarketHunterInfo) {
    const searchCondition = normalizeYahooFleamarketCondition(info.searchCondition);
    return super.hire(ctx, { ...info, searchCondition }, YahooFleamarketHunterModel, "yahooFleamarketHunters");
  }

  async getCronList(email: string) {
    return (await super.getCronList(email)).map(hunter => ({ ...hunter, type: this.hunterType }));
  }

  async goHunt(cronId: string) {
    if (this.running.has(cronId)) return;
    this.running.add(cronId);
    try {
      const hunter = await this.hunterModel.findOne({ where: { hunterInstanceId: cronId }, relations: ["user"] });
      if (!hunter) return;
      if (hunter.freezingStart && hunter.freezingEnd && isBetweenDayTime(hunter.freezingStart, hunter.freezingEnd)) return;
      const condition = normalizeYahooFleamarketCondition(JSON.parse(hunter.searchConditionSchema));
      const goods = await this.yahooFleamarketApi.fetchGoodsList(condition);
      // Persist a whole successful scan atomically. A concurrent condition
      // update or task deletion must not seed the baseline with stale results.
      const accepted = await this.hunterModel.manager.transaction(async manager => {
        const current = await manager.findOne(YahooFleamarketHunterModel, {
          where: { hunterInstanceId: cronId }, lock: { mode: "pessimistic_write" },
        });
        if (!current || current.searchConditionSchema !== hunter.searchConditionSchema) return false;
        const records = manager.getRepository(YahooFleamarketGoodsRecord);
        const previous = goods.length ? await records.find({
          where: { hunter: { hunterInstanceId: cronId }, id: In(goods.map(good => good.id)) }, select: ["id"],
        }) : [];
        const seen = new Set(previous.map(record => record.id));
        const unseen = goods.filter(good => !seen.has(good.id));
        if (unseen.length) {
          await records.createQueryBuilder().insert().values(unseen.map(good => ({
            ...good,
            openTime: good.openTime || null,
            hunter: { hunterInstanceId: cronId },
            notificationPending: current.initialized || condition.notifyExisting,
          }))).orIgnore().execute();
        }
        await manager.update(YahooFleamarketHunterModel, { hunterInstanceId: cronId }, { initialized: true });
        return true;
      });
      if (!accepted) return;
      const pending = await this.goodsRecordModel.find({
        where: { hunter: { hunterInstanceId: cronId }, notificationPending: true }, order: { createdAt: "ASC" },
      });
      if (!pending.length) return;
      await this.emailService.sendEmail({
        to: hunter.user.email,
        subject: `Yahoo!フリマ 新发现商品：${condition.keyword}`,
        html: render(yahooFleamarketGoodsList, { data: pending }),
      });
      await this.goodsRecordModel.update({ hunter: { hunterInstanceId: cronId }, id: In(pending.map(good => good.id)) }, {
        notificationPending: false, notifiedAt: new Date(),
      });
      this.logger.info(`Yahoo!フリマ task ${cronId}: notified ${pending.length} items`);
    } catch (error) {
      // Do not mark failed scans as empty or consume pending notifications.
      this.logger.error(`Yahoo!フリマ task ${cronId} failed: ${error.message}`);
    } finally {
      this.running.delete(cronId);
    }
  }

  async transfer(id: string, info: Pick<YahooFleamarketHunterInfo, "freezingRange" | "schedule" | "searchCondition">) {
    const condition = normalizeYahooFleamarketCondition(info.searchCondition);
    const job = this.cronList[id];
    if (!job?.jobInstance) throw new Error(errorCode.commonHunterService.cronJobNotFound);
    const nextTime = new CronTime(info.schedule);
    await this.hunterModel.manager.transaction(async manager => {
      const current = await manager.findOne(YahooFleamarketHunterModel, {
        where: { hunterInstanceId: id }, lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error(errorCode.commonHunterService.cronJobNotFound);
      const changed = JSON.stringify(normalizeYahooFleamarketCondition(JSON.parse(current.searchConditionSchema))) !== JSON.stringify(condition);
      if (changed) await manager.delete(YahooFleamarketGoodsRecord, { hunter: { hunterInstanceId: id } });
      await manager.update(YahooFleamarketHunterModel, { hunterInstanceId: id }, {
        searchConditionSchema: JSON.stringify(condition),
        schedule: info.schedule,
        freezingStart: info.freezingRange?.start || null,
        freezingEnd: info.freezingRange?.end || null,
        initialized: changed ? false : current.initialized,
      });
    });
    job.jobInstance.stop();
    job.jobInstance.setTime(nextTime);
    job.jobInstance.start();
    job.schedule = info.schedule;
  }
}
