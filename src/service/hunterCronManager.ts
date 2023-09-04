import {
  Provide,
  Inject,
  Scope,
  ScopeEnum,
  TaskLocal,
  Logger,
  Init,
} from "@midwayjs/decorator";
import { toNumber } from "lodash";
import { ILogger } from "@midwayjs/logger";
import { RedisService } from "@midwayjs/redis";
import { v4 as uuid } from "uuid";
import { CronJob, CronTime } from "cron";
import {
  first,
  isEmpty,
  noop,
  values,
} from "lodash";
import isValidUrl from "../utils/isValidUrl";
import {
  GoodsHunter,
  MercariHunter as MercariHunterType,
  CronDeail,
  UserInfo,
} from "../types";
import { MercariApi } from "../api/site/mercari";
import { render } from "ejs";
import moment from "moment";
import { mercariGoodsList } from "../template";
import { EmailService } from "./email";
import Mail from "nodemailer/lib/mailer";
import CONST from "../const";
import isBetweenDayTime from "../utils/isBetweenDayTime";
import { DatabaseTransactionWrapper } from "../utils/databaseTransactionWrapper";
import { User } from "../model/user";
import { MercariHunter } from "../model/mercariHunter";
import serverInfo from "../private/server";
import { InjectEntityModel } from "@midwayjs/orm";
import { In, Repository } from "typeorm";
import { Context } from "egg";
import errorCode from "../errorCode";
import { GoodsSearchCondition } from "../api/site/types";
import { MercariGoodsSearchCondition } from "../api/site/mercari/types";

function hunterCognition<T extends GoodsHunter>(
  hunterInfo: GoodsHunter,
  cognitionFunc: (info: typeof hunterInfo) => boolean
): hunterInfo is T {
  return cognitionFunc(hunterInfo);
}

interface CronList {
  [uuid: string]: CronDeail;
}

@Provide()
@Scope(ScopeEnum["Singleton"])
export class HunterCronManager {
  private cronList: CronList;

  @Init()
  async init() {
    this.cronList = {};
    const mercariHunterList = await this.mercariHunter.find({ relations: ["user"] });

    const promiseList: Promise<any>[] = [];
    mercariHunterList.forEach(mercariHunter => {
      const { hunterInstanceId } = mercariHunter;
      promiseList.push(this.respawnHunterById(hunterInstanceId, "Mercari"));
    });
    Promise.all(promiseList).then(() => {
      this.logger.info("all hunters at your service again at " + moment().format("YYYY-MM-DD HH:mm:ss") + ", welcome back!");
    }).catch(reason => {
      this.logger.error("Oops....Something went wrong:" + reason);
      process.exit(-1);
    })
  }

  async respawnHunterById(id: string, type: GoodsHunter["type"]) {
    if (type === "Mercari") {
      const asleepHunter = await this.mercariHunter.findOne({
        where: {
          hunterInstanceId: id
        }
      })
      const hunter = this.cronList[id];
      if (hunter?.jobInstance?.running) {
        // cronjob还跑着，直接返回
        this.logger.warn(`task ${id} is alreay running`);
        return;
      }
      if (!isEmpty(asleepHunter)) {
        const { schedule } = asleepHunter;
        const newCronJob = new CronJob(
          schedule,
          this.hunterFactory("Mercari", id),
          null,
          false
        );
        this.logger.info(`task ${id} respawned and get set to go`);
        const cronDetail: CronDeail = {
          id,
          type: "Mercari",
          jobInstance: newCronJob,
        };
        this.cronList[id] = cronDetail;
        newCronJob.start();
      }
    }
  }

  @Logger()
  logger: ILogger;

  @Inject()
  mercariApi: MercariApi;

  @Inject("redis:redisService")
  redisClient: RedisService;

  @Inject()
  emailService: EmailService;

  @InjectEntityModel(User)
  user: Repository<User>;

  @InjectEntityModel(MercariHunter)
  mercariHunter: Repository<MercariHunter>;

  @Inject()
  databaseTransactionWrapper: DatabaseTransactionWrapper;

  @TaskLocal("0 */1 * * * *")
  private async selfPingPong() {
    Object.keys(this.cronList).map(async key => {
      const { jobInstance, id, type } = this.cronList[key];
      if (!jobInstance.running) {
        this.logger.error(
          `task ${id} terminated unexpectedly, try respawning...`
        );
        await this.respawnHunterById(id, type);
      }
    });
    this.logger.info(
      `ping pong check ends, current cronList: ${Object.keys(
        this.cronList
      ).join(",")}`
    );
  }

  private hunterFactory(type: GoodsHunter["type"], cronId: string) {
    let func = noop;
    switch (type) {
      case "Mercari":
        func = async () => {
          const currentHunterInfo = await this.mercariHunter.findOne({
            where: {
              hunterInstanceId: cronId
            },
            relations: ["user"],
          });
          if (!isEmpty(currentHunterInfo)) {
            const { searchConditionSchema, freezingStart, freezingEnd, user } = currentHunterInfo;
            if (freezingStart && freezingEnd) {
              if (isBetweenDayTime(freezingStart, freezingEnd)) {
                this.logger.info(`task ${cronId} sleeping, exiting...`)
                return;
              }
            }
            let searchCondition: GoodsSearchCondition;
            try {
              searchCondition = JSON.parse(searchConditionSchema);
              if (!searchCondition.keyword) {
                throw new Error("no keyword found!");
              }
            } catch(e) {
              this.logger.error(`Invalid Mercari Hunter search condition When Executiong CronJob{${cronId}}, ${e.message}`);
              return;
            }
            const resp = await this.mercariApi.fetchGoodsList(searchCondition);
            const goodsList = resp.items;
            if(isEmpty(goodsList)) {
              this.logger.info(`task ${cronId} gets an empty goodsList, exiting...`)
              return;
            }
            let filteredGoods: typeof goodsList = [];
            const nextLatestTime = goodsList.reduce(
              (max, current) => (toNumber(current.updated) > max ? toNumber(current.updated) : max),
              toNumber(goodsList[0].updated)
            );
            const lastShotAtDateTime = toNumber((await this.mercariHunter.findOne({
              where: {
                hunterInstanceId: cronId,
              }
            }))?.lastShotAt);
            if (isNaN(lastShotAtDateTime)) {
              // first time for this cron shot record
              filteredGoods = goodsList;
            } else {
              const lastShotAt = moment(lastShotAtDateTime).unix();
              filteredGoods = goodsList.filter(
                good => toNumber(good.updated) > lastShotAt
              );
            }
            const ignoreGoods = await this.redisClient.smembers(
              `${CONST.USERIGNORE}_${user.email}`
            );
            filteredGoods = filteredGoods.filter(
              good => !ignoreGoods.includes(good.id)
            );
            Promise.all(
              filteredGoods.map(good => {
                return this.mercariApi
                  .fetchThumbNailsAndConvertToBase64(first(good.thumbnails))
                  .then(imgBase64Url => {
                    good.thumbnails = [imgBase64Url];
                    return;
                  });
              })
            ).then(async () => {
              if (!isEmpty(filteredGoods)) {
                const html = render(mercariGoodsList, {
                  data: filteredGoods,
                  serverHost: serverInfo.serverHost,
                });

                const emailMessage: Mail.Options = {
                  to: user.email,
                  subject: `New update on mercari goods of your interest, keyword:${searchCondition.keyword}`,
                  html,
                };
                await this.emailService.sendEmail(emailMessage);
                const lastestTime = moment.unix(nextLatestTime).format("YYYY-MM-DD HH:mm:ss");
                await this.mercariHunter.update({
                  hunterInstanceId: cronId
                }, {
                  lastShotAt: lastestTime,
                })
                this.logger.info(
                  `email sent to ${user.email}, goodsNameRecord:\n${JSON.stringify(
                    filteredGoods.map(good => good.name)
                  )}\n`
                );
              }
              this.logger.info(
                `task ${cronId} executed steady and sound at ${moment().format(
                  "YYYY:MM:DD hh:mm:ss"
                )}`
              );
            }).catch((e) => {
              this.logger.error(`task ${cronId} execution failed at ${moment().format(
                "YYYY:MM:DD hh:mm:ss"
              )}, here is the error message:\n${e.message || e}`);
            });
          }
        };
    }
    return func;
  }

  async getCronList() {
    const cronIdList = values(this.cronList).map((cron) => cron.id);
    const hunterList = await this.mercariHunter.find({
      hunterInstanceId: In(cronIdList)
    });
    return hunterList;
  }

  async addUserIgnoreGoods(user: string, goodIds: string[]) {
    await this.redisClient.sadd(`${CONST.USERIGNORE}_${user}`, goodIds);
  }

  async cancelUserIgnoreGoods(user: string, goodIds: string[]) {
    await this.redisClient.srem(`${CONST.USERIGNORE}_${user}`, goodIds);
  }

  async transferHunter(id: string, newHunterInfo: Pick<GoodsHunter, "freezingRange" | "user" | "schedule" | "type" | "searchCondition">) {
    if (hunterCognition<MercariHunterType>(newHunterInfo as GoodsHunter, info => info.type === "Mercari")) {
      const hunter = await this.mercariHunter.findOne({
        where: {
          hunterInstanceId: id
        }
      });
      if (!isEmpty(hunter)) {
        const { schedule: prevSchedule, searchConditionSchema: prevSearchConditionSchema, lastShotAt: prevLastShotAt } = hunter;
        let prevSearchCondition: MercariGoodsSearchCondition;
        try {
          prevSearchCondition = JSON.parse(prevSearchConditionSchema);
        } catch(e) {
          // pass
        }
        const jobRecord = this.cronList[id];
        if (!jobRecord?.jobInstance) {
          throw new Error(errorCode.hunterCronManager.cronJobNotFound);
        }
        const instance = jobRecord.jobInstance;
        this.databaseTransactionWrapper({
          pending: async (queryRunner) => {
            await queryRunner.manager.update(MercariHunter, { hunterInstanceId: id }, {
              schedule: newHunterInfo.schedule,
              searchConditionSchema: JSON.stringify(newHunterInfo.searchCondition),
              freezingStart: newHunterInfo?.freezingRange?.start,
              freezingEnd: newHunterInfo?.freezingRange?.end,
              lastShotAt: prevSearchCondition?.keyword === newHunterInfo.searchCondition.keyword ? null : prevLastShotAt, // 关键词发生改变时，清空lastShotAt
            });
            if (prevSchedule !== newHunterInfo.schedule) {
              // 需要重置crobJobInstance
              instance.stop();
              instance.setTime(new CronTime(newHunterInfo.schedule));
              instance.start();
            }
          },
          rejected: async () => {
            // 更新失败，尝试重启原先的cronjob
            await this.respawnHunterById(id, "Mercari");
          }
        })
      } else {
        throw new Error(errorCode.hunterCronManager.cronJobNotFound);
      }
    }
  }

  async dismissHunter(id: string, type: typeof CONST.HUNTERTYPE[number]) {
    const cronJob = this.cronList[id];
    if (!cronJob) return;
    if (type === "Mercari") {
      await this.mercariHunter.delete({
        hunterInstanceId: id,
      });
      cronJob.jobInstance?.stop();
      delete this.cronList[id];
    }
    this.logger.info(`task ${id} removed`);
  }

  async hireNewHunterForUser(ctx: Context, hunterInfo: GoodsHunter) {
    if (hunterCognition<MercariHunterType>(hunterInfo, info => info.type === "Mercari")) {
      const user = ctx.user as UserInfo;
      const { email } = user;
      const cronId = uuid();
      await this.databaseTransactionWrapper({
        pending: async queryRunner => {
          // 先将新的hunterInfo绑定请求用户持久化到DB
          const user = await queryRunner.manager.findOne(
            User,
            { email },
            { relations: ["mercariHunters"] }
          );
          if (hunterInfo.type === "Mercari") {
            const newMercariHunter = new MercariHunter();
            newMercariHunter.hunterInstanceId = cronId;
            newMercariHunter.freezingStart = hunterInfo?.freezingRange?.start;
            newMercariHunter.freezingEnd = hunterInfo?.freezingRange?.end;
            newMercariHunter.lastShotAt = hunterInfo?.lastShotAt;
            newMercariHunter.schedule = hunterInfo?.schedule;
            newMercariHunter.searchConditionSchema = JSON.stringify(hunterInfo?.searchCondition);
            newMercariHunter.createdAt = hunterInfo.bornAt;
            user.mercariHunters.push(newMercariHunter);
          }
          await queryRunner.manager.save(user);
        },
        resolved: async () => {
          // 创建定时任务，定时任务实时从DB取数据进行定时任务的执行（schedule修改无法实时获取，需要重启cronJob）
          const newCronJob = new CronJob(
            hunterInfo.schedule,
            this.hunterFactory("Mercari", cronId),
            null,
            false
          );
          this.logger.info(`task ${cronId} established and get set to go`);
          const cronDetail: CronDeail = {
            id: cronId,
            type: "Mercari",
            jobInstance: newCronJob,
          };

          this.cronList[cronId] = cronDetail;
          newCronJob.start();
        },
        rejected: async () => {
          throw new Error("Error when executing add mercariHunter cronJob");
        },
      });
    }
  }
}
