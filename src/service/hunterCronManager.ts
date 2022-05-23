import {
  Provide,
  Inject,
  Scope,
  ScopeEnum,
  TaskLocal,
  Logger,
  Init,
} from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { RedisService } from "@midwayjs/redis";
import { v4 as uuid } from "uuid";
import { CronJob } from "cron";
import { isValidCron } from "cron-validator";
import {
  cloneDeep,
  toNumber,
  toString,
  first,
  isEmpty,
  get,
  set,
} from "lodash";
import isValidUrl from "../utils/isValidUrl";
import {
  GoodsHunter,
  MercariHunter as MercariHunterType,
  CronDeail,
  CronDetailInDb,
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
import { Repository } from "typeorm";

function hunterCognition<T extends GoodsHunter>(
  hunterInfo: GoodsHunter,
  cognitionFunc: (info: typeof hunterInfo) => boolean
): hunterInfo is T {
  return cognitionFunc(hunterInfo);
}

interface CronList<T extends GoodsHunter = any> {
  [uuid: string]: CronDeail<T>;
}

@Provide()
@Scope(ScopeEnum["Singleton"])
export class HunterCronManager {
  private cronList: CronList<GoodsHunter>;

  @Init()
  async init() {
    this.cronList = {};
    const mercariHunterList = await this.mercariHunter.find({ relations: ["user"] });

    mercariHunterList.map(async mercariHunter => {
      const { hunterInstanceId, freezingEnd, freezingStart, user, url, lastShotAt, createdAt, schedule } = mercariHunter;
      const hunter: CronDetailInDb<MercariHunterType> = {
        id: hunterInstanceId,
        hunterInfo: {
          user: {
            email: user.email,
          },
          type: "Mercari",
          url,
          schedule,
          freezingRange: {
            start: freezingStart,
            end: freezingEnd
          },
          lastShotAt,
          createdAt
        }
      }
      await this.addCronTask(hunter.hunterInfo, hunter.id);
    });
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
      const jobInstance = this.cronList[key].jobInstance;
      const hunterInfo = cloneDeep(this.cronList[key].hunterInfo);
      if (!jobInstance.running) {
        await this.removeCronTask(key, hunterInfo.type);
        this.logger.error(
          `task ${key} terminated unexpectedly, try restarting...`
        );
        await this.addCronTask(hunterInfo);
      }
    });
    this.logger.info(
      `ping pong check ends, current cronList: ${Object.keys(
        this.cronList
      ).join(",")}`
    );
  }

  getCronList() {
    return this.cronList;
  }

  async addUserIgnoreGoods(user: string, goodIds: string[]) {
    await this.redisClient.sadd(`${CONST.USERIGNORE}_${user}`, goodIds);
  }

  async cancelUserIgnoreGoods(user: string, goodIds: string[]) {
    await this.redisClient.srem(`${CONST.USERIGNORE}_${user}`, goodIds);
  }

  async removeCronTask(id: string, type: typeof CONST.HUNTERTYPE[number]) {
    const cronJob = this.cronList[id];
    if (!cronJob) return;
    await this.mercariHunter.delete({
      hunterInstanceId: id,
    });
    this.logger.info(`task ${id} removed`);
  }
  async addCronTask(hunterInfo: GoodsHunter, existedId?: string) {
    if (hunterCognition<MercariHunterType>(hunterInfo, info => !!info.url)) {
      const { url, schedule, user, freezingRange, type } = hunterInfo;
      const { email } = user;
      const decodedUrl = decodeURIComponent(url);
      if (!isValidCron(schedule) || !isValidUrl(decodedUrl))
        throw new Error("Invalid cron format!");
      const cronId = existedId || uuid();
      const newCronJob = new CronJob(
        schedule,
        async () => {
          if (freezingRange) {
            const { start, end } = freezingRange;
            if (isBetweenDayTime(start, end)) {
              return;
            }
          }
          const resp = await this.mercariApi.fetchGoodsList(decodedUrl);
          const goodsList = resp.data;
          let filteredGoods: typeof goodsList = [];
          const nextLatestTime = resp.data.reduce(
            (max, current) => (current.updated > max ? current.updated : max),
            goodsList[0].updated
          );
          const lastShotAt = (await this.mercariHunter.findOne({
            where: {
              hunterInstanceId: cronId,
            }
          }))?.lastShotAt;
          const prevLatestTime = lastShotAt ? moment(lastShotAt).unix() : NaN;
          if (isNaN(prevLatestTime)) {
            // first time for this cron shot record
            filteredGoods = goodsList;
          } else {
            filteredGoods = goodsList.filter(
              good => good.updated > prevLatestTime
            );
          }
          const ignoreGoods = await this.redisClient.smembers(
            `${CONST.USERIGNORE}_${email}`
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
              const keyword = new URL(
                decodeURIComponent(hunterInfo.url)
              ).searchParams.get("keyword");

              const emailMessage: Mail.Options = {
                to: email,
                subject: `New update on mercari goods of your interest, keyword:${keyword}`,
                html,
              };
              await this.emailService.sendEmail(emailMessage);
              const lastestTime = toString(nextLatestTime);
              await this.mercariHunter.update({
                hunterInstanceId: cronId
              }, {
                lastShotAt: lastestTime,
              })
              const cronDetail = get(this.cronList, cronId);
              set(cronDetail, "hunterInfo.lastShotAt", lastestTime);
              this.logger.info(
                `email sent to ${email}, goodsNameRecord:\n${JSON.stringify(
                  filteredGoods.map(good => good.name)
                )}\n`
              );
            }
            this.logger.info(
              `task ${cronId} executed steady and sound at ${moment().format(
                "YYYY:MM:DD hh:mm:ss"
              )}`
            );
          });
        },
        null,
        true
      );
      this.logger.info(`task ${cronId} established and get set to go`);
      const cronDetail: CronDeail<typeof hunterInfo> = {
        id: cronId,
        jobInstance: newCronJob,
        hunterInfo,
      };
      const CronDeailInDB: CronDetailInDb<typeof hunterInfo> = {
        id: cronId,
        hunterInfo,
      };
      if (!existedId) {
        // not reload for the previous jobInstance, but a brand new one instead
        await this.databaseTransactionWrapper({
          pending: async queryRunner => {
            const user = await queryRunner.manager.findOne(
              User,
              { email },
              { relations: ["mercariHunters"] }
            );
            if (type === "Mercari") {
              const newMercariHunter = new MercariHunter();
              newMercariHunter.hunterInstanceId = cronId;
              newMercariHunter.freezingStart = hunterInfo?.freezingRange?.start;
              newMercariHunter.freezingEnd = hunterInfo?.freezingRange?.end;
              newMercariHunter.lastShotAt = hunterInfo?.lastShotAt;
              newMercariHunter.schedule = hunterInfo?.schedule;
              newMercariHunter.url = hunterInfo?.url;
              newMercariHunter.createdAt = hunterInfo.bornAt;
              user.mercariHunters.push(newMercariHunter);
            }
            await queryRunner.manager.save(user);
          },
          rejected: async () => {
            newCronJob.stop();
          },
        });
      }
      this.cronList[cronId] = cronDetail;
    }
  }
}
