import {
  Provide,
  Inject,
  Scope,
  ScopeEnum,
  TaskLocal,
  Logger,
  Init,
  Config,
} from "@midwayjs/decorator";
import { toNumber } from "lodash";
import { ILogger } from "@midwayjs/logger";
import { RedisService } from "@midwayjs/redis";
import { v4 as uuid } from "uuid";
import { CronJob, CronTime } from "cron";
import { first, isEmpty, noop, values } from "lodash";
import {
  GoodsHunter,
  MercariHunter as MercariHunterType,
  YahooHunter as YahooHunterType,
  CronDeail,
  UserInfo,
  CipherPayload,
} from "../types";
import { MercariApi } from "../api/site/mercari";
import { render } from "ejs";
import moment from "moment";
import { mercariGoodsList, yahooGoodsList } from "../template";
import { EmailService } from "./email";
import Mail from "nodemailer/lib/mailer";
import CONST from "../const";
import isBetweenDayTime from "../utils/isBetweenDayTime";
import { DatabaseTransactionWrapper } from "../utils/databaseTransactionWrapper";
import { User } from "../model/user";
import { MercariHunter } from "../model/mercariHunter";
import { InjectEntityModel } from "@midwayjs/orm";
import { In, Repository } from "typeorm";
import { Context } from "egg";
import errorCode from "../errorCode";
import { GoodsSearchConditionBase } from "../api/site/types";
import {
  GoodsListResponse as MercariGoodsListResponse,
  MercariGoodsSearchCondition,
} from "../api/site/mercari/types";
import { YahooAuctionApi } from "../api/site/yahoo";
import { CustomConfig } from "../config/config.default";
import CipherServive from "./cipher";
import { GoodsHunterModelBase } from "../model/types";
import { YahooHunter } from "../model/yahooHunter";
import { YahooAuctionGoodsSearchCondition, GoodsListResponse as YahooGoodsListResponse } from "../api/site/yahoo/types";

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

  @Config("serverInfo")
  serverInfo: CustomConfig["serverInfo"];

  @Init()
  async init() {
    this.cronList = {};
    const modelList: { model: Repository<GoodsHunterModelBase>, type: GoodsHunter["type"]}[] = [ { model: this.mercariHunterModel, type: "Mercari" }, { model: this.yahooHunterModel, type: "Yahoo" } ];

    const promiseList: Promise<void>[] = [];

    modelList.map(async (item) => {

      const { model, type } = item;

      const hunterList = await model.find({
        relations: ["user"],
      });

      hunterList.forEach(hunter => {
        const { hunterInstanceId } = hunter;
        promiseList.push(this.respawnHunterById(hunterInstanceId, type));
      });
    })

    Promise.all(promiseList)
      .then(() => {
        this.logger.info(
          "all hunters at your service again at " +
            moment().format("YYYY-MM-DD HH:mm:ss") +
            ", welcome back!"
        );
      })
      .catch(reason => {
        this.logger.error("Oops....Something went wrong:" + reason);
        process.exit(-1);
      });
  }

  async respawnHunterById(id: string, type: GoodsHunter["type"]) {
    const model: Repository<GoodsHunterModelBase> = type === "Mercari" ? this.mercariHunterModel : this.yahooHunterModel;
    const asleepHunter = await model.findOne({
      where: {
        hunterInstanceId: id,
      },
    });
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
        this.hunterFactory(type, id),
        null,
        false
      );
      this.logger.info(`task ${id} respawned and get set to go`);
      const cronDetail: CronDeail = {
        id,
        type,
        jobInstance: newCronJob,
      };
      this.cronList[id] = cronDetail;
      newCronJob.start();
    }
  }

  @Logger()
  logger: ILogger;

  @Inject()
  mercariApi: MercariApi;

  @Inject()
  yahooApi: YahooAuctionApi;

  @Inject("redis:redisService")
  redisClient: RedisService;

  @Config("emailConfig")
  mailInfo: CustomConfig["emailConfig"];

  @Inject()
  emailService: EmailService;

  @InjectEntityModel(User)
  user: Repository<User>;

  @InjectEntityModel(MercariHunter)
  mercariHunterModel: Repository<MercariHunter>;

  @InjectEntityModel(YahooHunter)
  yahooHunterModel: Repository<YahooHunter>;

  @Inject()
  databaseTransactionWrapper: DatabaseTransactionWrapper;

  @Inject()
  cipher: CipherServive;

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

  @TaskLocal("0 */50 * * *")
  private async cookieHeartBeatCheck() {
    const yahooCookieValid = await this.yahooApi.checkCookieHeartBeat();
    if (!yahooCookieValid?.result) {
      this.emailService.sendEmail({
        to: this.mailInfo.contactSystemOwner,
        subject: "Your yahoo cookie seems to expire or invalid",
        text: `Consider a refresh won't we? current provided yahoo cookie:\n${yahooCookieValid.cookie}`
      });
    }
    this.logger.info("cookie heart beat check finished")
  }

  private hunterFactory(type: GoodsHunter["type"], cronId: string) {
    let func = noop;
    switch (type) {
      case "Mercari":
        func = async () => {
          const currentHunterInfo = await this.mercariHunterModel.findOne({
            where: {
              hunterInstanceId: cronId,
            },
            relations: ["user"],
          });
          if (isEmpty(currentHunterInfo)) return;
          const { searchConditionSchema, freezingStart, freezingEnd, user } =
            currentHunterInfo;
          if (
            freezingStart &&
            freezingEnd &&
            isBetweenDayTime(freezingStart, freezingEnd)
          ) {
            this.logger.info(`task ${cronId} sleeping, exiting...`);
            return;
          }
          let searchCondition: MercariGoodsSearchCondition;
          try {
            searchCondition = JSON.parse(searchConditionSchema);
            if (!searchCondition.keyword) {
              throw new Error("no keyword found!");
            }
          } catch (e) {
            this.logger.error(
              `Invalid Mercari Hunter search condition when executiong cronjob{${cronId}}, ${e}`
            );
            return;
          }
          let resp: MercariGoodsListResponse = null;
          try {
            resp = await this.mercariApi.fetchGoodsList(searchCondition);
          } catch (e) {
            this.logger.error(
              `Fail to fetch good list when executing cronjob{${cronId}}, ${e}`
            );
            return;
          }
          const goodsList = resp.items;
          if (isEmpty(goodsList)) {
            this.logger.info(
              `task ${cronId} gets an empty goodsList, exiting...`
            );
            return;
          }
          let filteredGoods: typeof goodsList = [];
          const nextLatestTime = goodsList.reduce(
            (max, current) =>
              toNumber(current.updated) > max ? toNumber(current.updated) : max,
            toNumber(goodsList[0].updated)
          );
          const lastShotAtDateTime = toNumber(
            (
              await this.mercariHunterModel.findOne({
                where: {
                  hunterInstanceId: cronId,
                },
              })
            )?.lastShotAt
          );
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
            filteredGoods.map(async good => {
              good.thumbnailData = await this.cipher.encode(
                first(good.thumbnails)
              );
              good.ignoreInstruction = await this.cipher.encode(
                `${user.email} ${good.id}`
              );
              return good;
            })
          )
            .then(async () => {
              if (!isEmpty(filteredGoods)) {
                const html = render(mercariGoodsList, {
                  data: filteredGoods,
                  serverHost: this.serverInfo.serverHost,
                });

                const emailMessage: Mail.Options = {
                  to: user.email,
                  subject: `New update on mercari goods of your interest, keyword:${searchCondition.keyword}`,
                  html,
                };
                await this.emailService.sendEmail(emailMessage);
                const lastestTime = moment
                  .unix(nextLatestTime)
                  .format("YYYY-MM-DD HH:mm:ss");
                await this.mercariHunterModel.update(
                  {
                    hunterInstanceId: cronId,
                  },
                  {
                    lastShotAt: lastestTime,
                  }
                );
                this.logger.info(
                  `email sent to ${
                    user.email
                  }, goodsNameRecord:\n${JSON.stringify(
                    filteredGoods.map(good => good.name)
                  )}\n`
                );
              }
              this.logger.info(
                `task ${cronId} executed steady and sound at ${moment().format(
                  "YYYY:MM:DD hh:mm:ss"
                )}`
              );
            })
            .catch(e => {
              this.logger.error(
                `task ${cronId} execution failed at ${moment().format(
                  "YYYY:MM:DD hh:mm:ss"
                )}, here is the error message:\n${e}`
              );
            });
        };
        break;
      case "Yahoo":
        func = async () => {
          const currentHunterInfo = await this.yahooHunterModel.findOne({
            where: {
              hunterInstanceId: cronId,
            },
            relations: ["user"],
          });
          if (isEmpty(currentHunterInfo)) return;
          const { searchConditionSchema, freezingStart, freezingEnd, user } =
            currentHunterInfo;
          if (
            freezingStart &&
            freezingEnd &&
            isBetweenDayTime(freezingStart, freezingEnd)
          ) {
            this.logger.info(`task ${cronId} sleeping, exiting...`);
            return;
          }
          let searchCondition: YahooAuctionGoodsSearchCondition;
          try {
            searchCondition = JSON.parse(searchConditionSchema);
            if (!searchCondition.keyword) {
              throw new Error("no keyword found!");
            }
          } catch (e) {
            this.logger.error(
              `Invalid Yahoo Hunter search condition when executiong cronjob{${cronId}}, ${e}`
            );
            return;
          }
          let goodsList: YahooGoodsListResponse = [];
          try {
            goodsList = await this.yahooApi.fetchGoodsList(searchCondition);
          } catch (e) {
            this.logger.error(
              `Fail to fetch good list when executing cronjob{${cronId}}, ${e}`
            );
            return;
          }
          if (isEmpty(goodsList)) {
            this.logger.info(
              `task ${cronId} gets an empty goodsList, exiting...`
            );
            return;
          }
          let filteredGoods = goodsList;
          const nextLastSeenAuctionId = goodsList[0].id;

          const lastSeenAuctionId =
            (
              await this.yahooHunterModel.findOne({
                where: {
                  hunterInstanceId: cronId,
                },
              })
            )?.lastSeenAuctionId;
          const cursor = goodsList.findIndex(good => good.id === lastSeenAuctionId);
          if (lastSeenAuctionId && cursor !== -1) {
            filteredGoods.splice(cursor)
          }
          // FIXME collision between different hunters when getting ignoring goods
          const ignoreGoods = await this.redisClient.smembers(
            `${CONST.USERIGNORE}_${user.email}`
          );
          filteredGoods = filteredGoods.filter(
            good => !ignoreGoods.includes(good.id)
          );
          Promise.all(
            filteredGoods.map(async good => {
              good.thumbnailData = await this.cipher.encode(
                good.thumbImgUrl
              );
              good.ignoreInstruction = await this.cipher.encode(
                `${user.email} ${good.id}`
              );
              return good;
            })
          )
            .then(async () => {
              if (!isEmpty(filteredGoods)) {
                const html = render(yahooGoodsList, {
                  data: filteredGoods,
                  serverHost: this.serverInfo.serverHost,
                });

                const emailMessage: Mail.Options = {
                  to: user.email,
                  subject: `New update on yahoo auctions of your interest, keyword:${searchCondition.keyword}`,
                  html,
                };
                await this.emailService.sendEmail(emailMessage);
                await this.yahooHunterModel.update(
                  {
                    hunterInstanceId: cronId,
                  },
                  {
                    lastSeenAuctionId: nextLastSeenAuctionId,
                  }
                );
                this.logger.info(
                  `email sent to ${user.email
                  }, goodsNameRecord:\n${JSON.stringify(
                    filteredGoods.map(good => good.name)
                  )}\n`
                );
              }
              this.logger.info(
                `task ${cronId} executed steady and sound at ${moment().format(
                  "YYYY:MM:DD hh:mm:ss"
                )}`
              );
            })
            .catch(e => {
              this.logger.error(
                `task ${cronId} execution failed at ${moment().format(
                  "YYYY:MM:DD hh:mm:ss"
                )}, here is the error message:\n${e}`
              );
            });
        }
    }
    return func;
  }

  async getCronList(email: string) {
    const cronIdList = values(this.cronList).map(cron => cron.id);
    const mercariHunterList = await this.mercariHunterModel.find({
      hunterInstanceId: In(cronIdList),
      user: { email }
    });
    const yahooHunterList = await this.yahooHunterModel.find({
      hunterInstanceId: In(cronIdList),
      user: { email }
    });
    return [...mercariHunterList, ...yahooHunterList];
  }

  async addUserIgnoreGoods(payload: CipherPayload) {
    await this.cipher.checkIfMessageConsumed(payload.data.message);
    const decodedMessage = await this.cipher.decode(payload);
    const [user, goodId] = decodedMessage.split(" ");

    await this.redisClient.sadd(`${CONST.USERIGNORE}_${user}`, goodId);
    await this.cipher.addMessageToConsume(payload.data.message);
  }

  async cancelUserIgnoreGoods(payload: CipherPayload) {
    await this.cipher.checkIfMessageConsumed(payload.data.message);
    const decodedMessage = await this.cipher.decode(payload);

    const [user, goodId] = decodedMessage.split(" ");

    await this.redisClient.srem(`${CONST.USERIGNORE}_${user}`, goodId);
    await this.cipher.addMessageToConsume(payload.data.message);
  }

  async transferHunter(
    id: string,
    newHunterInfo: Pick<
      GoodsHunter,
      "freezingRange" | "user" | "schedule" | "type" | "searchCondition"
    >
  ) {

    let targetModel: Repository<GoodsHunterModelBase> = null;
    let modelCls: any = null;

    switch (newHunterInfo.type) {
      case "Mercari":
        targetModel = this.mercariHunterModel;
        modelCls = MercariHunter;
        break;
      default:
        targetModel = this.yahooHunterModel;
        modelCls = YahooHunter;
    }

    const hunter = await targetModel.findOne({
      where: {
        hunterInstanceId: id,
      },
    });

    if (!isEmpty(hunter)) {
      const {
        schedule: prevSchedule,
        searchConditionSchema: prevSearchConditionSchema,
        lastShotAt: prevLastShotAt,
      } = hunter;
      let prevSearchCondition: GoodsSearchConditionBase;
      try {
        prevSearchCondition = JSON.parse(prevSearchConditionSchema);
      } catch (e) {
        // pass
      }
      const jobRecord = this.cronList[id];
      if (!jobRecord?.jobInstance) {
        throw new Error(errorCode.hunterCronManager.cronJobNotFound);
      }
      const instance = jobRecord.jobInstance;
      this.databaseTransactionWrapper({
        pending: async queryRunner => {
          await queryRunner.manager.update(
            modelCls,
            { hunterInstanceId: id },
            {
              schedule: newHunterInfo.schedule,
              searchConditionSchema: JSON.stringify(
                newHunterInfo.searchCondition
              ),
              freezingStart: newHunterInfo?.freezingRange?.start,
              freezingEnd: newHunterInfo?.freezingRange?.end,
              lastShotAt:
                prevSearchCondition?.keyword ===
                  newHunterInfo.searchCondition.keyword
                  ? null
                  : prevLastShotAt, // 关键词发生改变时，清空lastShotAt
            }
          );
          if (prevSchedule !== newHunterInfo.schedule) {
            // 需要重置crobJobInstance
            instance.stop();
            instance.setTime(new CronTime(newHunterInfo.schedule));
            instance.start();
          }
        },
        rejected: async () => {
          // 更新失败，尝试重启原先的cronjob
          await this.respawnHunterById(id, newHunterInfo.type);
        },
      });
    } else {
      throw new Error(errorCode.hunterCronManager.cronJobNotFound);
    }
  }

  async dismissHunter(id: string, type: (typeof CONST.HUNTERTYPE)[number]) {
    const cronJob = this.cronList[id];
    if (!cronJob) return;
    const targetModel = type === "Mercari" ? this.mercariHunterModel : this.yahooHunterModel;
    await targetModel.delete({
      hunterInstanceId: id,
    });
    cronJob.jobInstance?.stop();
    delete this.cronList[id];
    this.logger.info(`task ${id} removed`);
  }

  async hireNewHunterForUser(ctx: Context, hunterInfo: GoodsHunter) {
    if (
      hunterCognition<MercariHunterType>(
        hunterInfo,
        info => info.type === "Mercari"
      )
    ) {
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
          const newMercariHunter = new MercariHunter();
          newMercariHunter.hunterInstanceId = cronId;
          newMercariHunter.freezingStart = hunterInfo?.freezingRange?.start;
          newMercariHunter.freezingEnd = hunterInfo?.freezingRange?.end;
          newMercariHunter.lastShotAt = hunterInfo?.lastShotAt;
          newMercariHunter.schedule = hunterInfo?.schedule;
          newMercariHunter.searchConditionSchema = JSON.stringify(
            hunterInfo?.searchCondition
          );
          newMercariHunter.createdAt = hunterInfo.bornAt;
          user.mercariHunters.push(newMercariHunter);

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

    if (
      hunterCognition<YahooHunterType>(
        hunterInfo,
        info => info.type === "Yahoo"
      )
    ) {
      const user = ctx.user as UserInfo;
      const { email } = user;
      const cronId = uuid();
      await this.databaseTransactionWrapper({
        pending: async queryRunner => {
          // 先将新的hunterInfo绑定请求用户持久化到DB
          const user = await queryRunner.manager.findOne(
            User,
            { email },
            { relations: ["yahooHunters"] }
          );
          const newYahooHunter = new YahooHunter();
          newYahooHunter.hunterInstanceId = cronId;
          newYahooHunter.freezingStart = hunterInfo?.freezingRange?.start;
          newYahooHunter.freezingEnd = hunterInfo?.freezingRange?.end;
          newYahooHunter.lastSeenAuctionId = hunterInfo?.lastSeenAuctionId;
          newYahooHunter.schedule = hunterInfo?.schedule;
          newYahooHunter.searchConditionSchema = JSON.stringify(
            hunterInfo?.searchCondition
          );
          newYahooHunter.createdAt = hunterInfo.bornAt;
          user.yahooHunters.push(newYahooHunter);

          await queryRunner.manager.save(user);
        },
        resolved: async () => {
          // 创建定时任务，定时任务实时从DB取数据进行定时任务的执行（schedule修改无法实时获取，需要重启cronJob）
          const newCronJob = new CronJob(
            hunterInfo.schedule,
            this.hunterFactory("Yahoo", cronId),
            null,
            false
          );
          this.logger.info(`task ${cronId} established and get set to go`);
          const cronDetail: CronDeail = {
            id: cronId,
            type: "Yahoo",
            jobInstance: newCronJob,
          };

          this.cronList[cronId] = cronDetail;
          newCronJob.start();
        },
        rejected: async () => {
          throw new Error("Error when executing add yahooHunter cronJob");
        },
      });
    }
  }
}

