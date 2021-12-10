import { Provide, Inject, Scope, ScopeEnum, TaskLocal, Logger, Init } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { RedisService } from "@midwayjs/redis";
import { v4 as uuid } from "uuid";
import { CronJob } from "cron";
import { isValidCron } from "cron-validator";
import { cloneDeep } from "lodash";
import isValidUrl from "../utils/isValidUrl";
import { GoodsHunter, MercariHunter, CronDeail, CronDetailInDb } from "../types";

const HUNTERINFO = "hunterInfo";

function hunterCognition<T extends GoodsHunter>(hunterInfo: GoodsHunter, cognitionFunc: (info: typeof hunterInfo) => boolean): hunterInfo is T {
  return cognitionFunc(hunterInfo);
}

interface CronList<T extends GoodsHunter = any> {
  [uuid: string]: CronDeail<T>;
}

@Provide()
@Scope(ScopeEnum["Singleton"])
export class HunterCronManager {
  private cronList: CronList;

  @Init()
  async init() {
    this.cronList = {};
    const values = await this.redisClient.hvals(HUNTERINFO);
    values.map(async (value) => {
      const cronDetail: CronDetailInDb = JSON.parse(value);
      await this.addCronTask(cronDetail.hunterInfo, cronDetail.id);
    });
  }

  @Logger()
  logger: ILogger;

  @Inject("redis:redisService")
  redisClient: RedisService;

  @TaskLocal('*/10 * * * * *')
  private async selfPingPong() {
    Object.keys(this.cronList).map(async (key) => {
      const jobInstance = this.cronList[key].jobInstance;
      const hunterInfo = cloneDeep(this.cronList[key].hunterInfo);
      if (!jobInstance.running) {
        await this.removeCronTask(key, jobInstance);
        await this.addCronTask(hunterInfo);
      }
    })
  }

  getCronList() {
    return this.cronList;
  }

  async removeCronTask(id: string, jobInstance: CronJob) {
    jobInstance.stop();
    await this.redisClient.hdel(HUNTERINFO, id);
    delete this.cronList[id];
  }
  async addCronTask(hunterInfo: GoodsHunter, existedId?: string) {
    if(hunterCognition<MercariHunter>(hunterInfo, (info) => !!info.url)) {
      const { url, schedule } = hunterInfo;
      if (!isValidCron(schedule) || !isValidUrl(url)) throw new Error("Invalid cron format!");
      const cronId = existedId || uuid();
      const newCronJob = new CronJob("*/3 * * * * *", (() => {
        this.logger.info("hahahahaha!!");
      }), null, true);
      const cronDetail: CronDeail<typeof hunterInfo> = {
        id: cronId,
        jobInstance: newCronJob,
        hunterInfo,
      }
      const CronDeailInDB: CronDetailInDb<typeof hunterInfo> = {
        id: cronId,
        hunterInfo,
      }
      if (!existedId)
        await this.redisClient.hset(HUNTERINFO, cronId, JSON.stringify(CronDeailInDB));
      this.cronList[cronId] = cronDetail;
    }
  }
}