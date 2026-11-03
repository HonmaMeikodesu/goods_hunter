import { Init, Inject, Provide, Scope, ScopeEnum, TaskLocal } from "@midwayjs/decorator";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { In, Repository } from "typeorm";
import { CronTime } from "cron";
import { render } from "ejs";
import HunterBase from "./base";
import { XianyuApi } from "../../api/site/xianyu";
import { normalizeXianyuCondition } from "../../api/site/xianyu/conditions";
import { XianyuHunter as XianyuHunterModel } from "../../model/xianyuHunter";
import { XianyuGoodsRecord } from "../../model/xianyuGoodsRecord";
import { XianyuHunter as XianyuHunterInfo } from "../../types";
import { xianyuGoodsList } from "../../template";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import errorCode from "../../errorCode";

@Provide()
@Scope(ScopeEnum.Singleton)
export class XianyuHunterService extends HunterBase {
  hunterType = "Xianyu" as const;
  private running = new Set<string>();
  private queue: Promise<void> = Promise.resolve();

  @Inject()
  xianyuApi: XianyuApi;

  @InjectEntityModel(XianyuHunterModel)
  hunterModel: Repository<XianyuHunterModel>;

  @InjectEntityModel(XianyuGoodsRecord)
  goodsRecordModel: Repository<XianyuGoodsRecord>;

  @Init()
  async init() {
    await super.init();
  }

  @TaskLocal("*/2 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  async hire(ctx: Context, info: XianyuHunterInfo) {
    const searchCondition = normalizeXianyuCondition(info.searchCondition);
    return super.hire(ctx, { ...info, searchCondition }, XianyuHunterModel, "xianyuHunters");
  }

  async getCronList(email: string) {
    return (await super.getCronList(email)).map(hunter => ({ ...hunter, type: this.hunterType }));
  }

  async goHunt(cronId: string) {
    if (this.running.has(cronId)) return;
    this.running.add(cronId);
    const scan = this.queue.then(() => this.hunt(cronId));
    this.queue = scan.catch(() => undefined);
    try { await scan; } finally { this.running.delete(cronId); }
  }

  private async hunt(cronId: string) {
    try {
      const hunter = await this.hunterModel.findOne({ where: { hunterInstanceId: cronId }, relations: ["user"] });
      if (!hunter) return;
      if (hunter.freezingStart && hunter.freezingEnd && isBetweenDayTime(hunter.freezingStart, hunter.freezingEnd)) return;
      const condition = normalizeXianyuCondition(JSON.parse(hunter.searchConditionSchema));
      const goods = await this.xianyuApi.fetchGoodsList(condition);
      // Persist a whole successful scan atomically. A concurrent condition
      // update or task deletion must not seed the baseline with stale results.
      const accepted = await this.hunterModel.manager.transaction(async manager => {
        const current = await manager.findOne(XianyuHunterModel, {
          where: { hunterInstanceId: cronId }, lock: { mode: "pessimistic_write" },
        });
        if (!current || current.searchConditionSchema !== hunter.searchConditionSchema) return false;
        const records = manager.getRepository(XianyuGoodsRecord);
        const previous = goods.length ? await records.find({
          where: { hunter: { hunterInstanceId: cronId }, id: In(goods.map(good => good.id)) }, select: ["id", "thumbnailImageUrl"],
        }) : [];
        const missingImages = new Set(previous.filter(record => !record.thumbnailImageUrl).map(record => record.id));
        for (const good of goods) {
          if (good.thumbnailImageUrl && missingImages.has(good.id)) {
            // Repair old image-less records without resetting deduplication or notifications.
            await records.update({ hunter: { hunterInstanceId: cronId }, id: good.id }, {
              thumbnailImageUrl: good.thumbnailImageUrl,
            });
          }
        }
        const seen = new Set(previous.map(record => record.id));
        const unseen = goods.filter(good => !seen.has(good.id));
        if (unseen.length) {
          await records.createQueryBuilder().insert().values(unseen.map(good => ({
            ...good,
            publishedAt: good.publishedAt || null,
            hunter: { hunterInstanceId: cronId },
            notificationPending: current.initialized || condition.notifyExisting,
          }))).orIgnore().execute();
        }
        await manager.update(XianyuHunterModel, { hunterInstanceId: cronId }, { initialized: true });
        return true;
      });
      if (!accepted) return;
      this.logger.info(`闲鱼 task ${cronId}: scan accepted ${goods.length} items`);
      const pending = await this.goodsRecordModel.find({
        where: { hunter: { hunterInstanceId: cronId }, notificationPending: true }, order: { createdAt: "ASC" },
      });
      if (!pending.length) return;
      await this.emailService.sendEmail({
        to: hunter.user.email,
        subject: `闲鱼 新发现商品：${condition.keyword}`,
        html: render(xianyuGoodsList, { data: pending }),
      });
      await this.goodsRecordModel.update({ hunter: { hunterInstanceId: cronId }, id: In(pending.map(good => good.id)) }, {
        notificationPending: false, notifiedAt: new Date(),
      });
      this.logger.info(`闲鱼 task ${cronId}: notified ${pending.length} items`);
    } catch (error) {
      // Do not mark failed scans as empty or consume pending notifications.
      this.logger.error(`闲鱼 task ${cronId} failed: ${error.message}`);
    }
  }

  async transfer(id: string, info: Pick<XianyuHunterInfo, "freezingRange" | "schedule" | "searchCondition">) {
    const condition = normalizeXianyuCondition(info.searchCondition);
    const job = this.cronList[id];
    if (!job?.jobInstance) throw new Error(errorCode.commonHunterService.cronJobNotFound);
    const nextTime = new CronTime(info.schedule);
    await this.hunterModel.manager.transaction(async manager => {
      const current = await manager.findOne(XianyuHunterModel, {
        where: { hunterInstanceId: id }, lock: { mode: "pessimistic_write" },
      });
      if (!current) throw new Error(errorCode.commonHunterService.cronJobNotFound);
      const changed = JSON.stringify(normalizeXianyuCondition(JSON.parse(current.searchConditionSchema))) !== JSON.stringify(condition);
      if (changed) await manager.delete(XianyuGoodsRecord, { hunter: { hunterInstanceId: id } });
      await manager.update(XianyuHunterModel, { hunterInstanceId: id }, {
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
