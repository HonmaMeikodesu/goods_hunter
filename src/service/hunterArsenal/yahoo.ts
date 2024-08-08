import { Provide, Inject, Scope, ScopeEnum, Logger, Config, TaskLocal, Init } from "@midwayjs/decorator";
import { YahooAuctionApi } from "../../api/site/yahoo";
import { In, Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { CronDeail, UserInfo } from "../../types";
import { CronJob, CronTime } from "cron";
import { v4 as uuid } from "uuid";
import { User } from "../../model/user";
import { YahooHunter as YahooHunterModel } from "../../model/yahooHunter";
import { YahooHunter as YahooHunterType } from "../../types";
import { differenceBy, isEmpty, values } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import { YahooAuctionGoodsSearchCondition, GoodsListResponse as YahooGoodsListResponse } from "../../api/site/yahoo/types";
import CONST from "../../const";
import HunterBase from "./base";
import { yahooGoodsList } from "../../template";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import errorCode from "../../errorCode";
import { CustomConfig } from "../../config/config.default";
import { YahooAuctionRecord } from "../../model/yahooAuctionRecord";

@Provide()
@Scope(ScopeEnum.Singleton)
export class YahooHunterService extends HunterBase {

  hunterType: typeof CONST.HUNTERTYPE[number] = "Yahoo";

  @Inject()
  yahooApi: YahooAuctionApi;

  @InjectEntityModel(YahooHunterModel)
  yahooHunterModel: Repository<YahooHunterModel>;

  @InjectEntityModel(YahooAuctionRecord)
  yahooAuctionRecordModel: Repository<YahooAuctionRecord>;

  @Config("emailConfig")
  mailInfo: CustomConfig["emailConfig"];

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

  @TaskLocal("0 */1 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {

    const promiseList: Promise<void>[] = [];

    const hunterList = await this.yahooHunterModel.find({
      relations: ["user"],
    });

    hunterList.forEach(hunter => {
      const { hunterInstanceId, schedule } = hunter;
      promiseList.push(this.spawnCronJob(hunterInstanceId, schedule));
    });

    Promise.all(promiseList)
      .then(() => {
        this.logger.info(
          "all yahoo hunters standing by!"
        );
      })
      .catch(reason => {
        this.logger.error("Oops....Something went wrong when waking up yahoo hunters:" + reason);
        process.exit(-1);
      });
  }

  async hire(ctx: Context, hunterInfo: YahooHunterType) {
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
        const newYahooHunter = new YahooHunterModel();
        newYahooHunter.hunterInstanceId = cronId;
        newYahooHunter.freezingStart = hunterInfo?.freezingRange?.start;
        newYahooHunter.freezingEnd = hunterInfo?.freezingRange?.end;
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
        await this.spawnCronJob(cronId, hunterInfo.schedule)
      },
      rejected: async () => {
        throw new Error("Error when executing add yahooHunter cronJob");
      },
    });

  }

  async goHunt(cronId: string) {
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

    const lastSeenAuctionList =
      (
        await this.yahooAuctionRecordModel.find({
          where: {
            hunter: {
              hunterInstanceId: cronId,
            }
          },
        })
      );

    let filteredGoods = (goodsList || []).filter((good) => {
      const existed = lastSeenAuctionList?.find(item => item.auctionId === good.id);

      if (!existed) return true;

      if (good.currentPrice && existed.currentPrice !== good.currentPrice) return true;

      if (good.buyNowPrice && existed.buyNowPrice !== good.buyNowPrice) return true;
    })

    // FIXME collision between different hunters when getting ignoring goods
    const ignoreGoods = await this.redisClient.smembers(
      `Yahoo_${CONST.USERIGNORE}_${user.email}`
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
          await this.yahooAuctionRecordModel.delete(
            {
              hunter: {
                hunterInstanceId: cronId
              }
            }
          );

          await this.yahooAuctionRecordModel.createQueryBuilder().insert().values((goodsList || []).map(good => ({
            hunter: { hunterInstanceId: cronId },
            auctionId: good.id,
            auctionName: good.name,
            currentPrice: good.currentPrice || null,
            buyNowPrice: good.buyNowPrice || null,
            currentBidCount: good.currentBidCount || null
          }))).execute();
          this.logger.info(
            `email sent to ${user.email
            }, goodsNameRecord:\n${JSON.stringify(
              filteredGoods.map(good => good.name)
            )}\n`
          ); }
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

  async dismiss(id: string) {
    const cronJob = this.cronList[id];
    if (!cronJob) return;
    await this.yahooHunterModel.delete({
      hunterInstanceId: id,
    });
    cronJob.jobInstance?.stop();
    delete this.cronList[id];
    this.logger.info(`task ${id} removed`);
  }

  async transfer(id: string, newHunterInfo: Pick<YahooHunterType, "freezingRange" | "user" | "schedule" | "type" | "searchCondition">) {
    const hunter = await this.yahooHunterModel.findOne({
      where: {
        hunterInstanceId: id,
      },
    });

    if (!isEmpty(hunter)) {
      const {
        schedule: prevSchedule,
        searchConditionSchema: prevSearchConditionSchema
      } = hunter;
      let prevSearchCondition: YahooAuctionGoodsSearchCondition;
      try {
        prevSearchCondition = JSON.parse(prevSearchConditionSchema);
      } catch (e) {
        // pass
      }
      const jobRecord = this.cronList[id];
      if (!jobRecord?.jobInstance) {
        throw new Error(errorCode.commonHunterService.cronJobNotFound);
      }
      const instance = jobRecord.jobInstance;
      this.databaseTransactionWrapper({
        pending: async queryRunner => {
          if (prevSearchCondition?.keyword !== newHunterInfo.searchCondition.keyword) {
            await queryRunner.manager.delete(YahooAuctionRecord, {
              hunter: {
                hunterInstanceId: id
              }
            });
          }
          await queryRunner.manager.update(
            YahooHunterModel,
            { hunterInstanceId: id },
            {
              schedule: newHunterInfo.schedule,
              searchConditionSchema: JSON.stringify(
                newHunterInfo.searchCondition
              ),
              freezingStart: newHunterInfo?.freezingRange?.start,
              freezingEnd: newHunterInfo?.freezingRange?.end
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
          await this.spawnCronJob(id, prevSchedule);
        },
      });
    } else {
      throw new Error(errorCode.commonHunterService.cronJobNotFound);
    }
  }

  async spawnCronJob(id: string, schedule: string) {
    const hunter = this.cronList[id];
    if (hunter?.jobInstance?.running) {
      // cronjob还跑着，直接返回
      this.logger.warn(`task ${id} is alreay running`);
      return;
    }
    const newCronJob = new CronJob(
      schedule,
      () => this.goHunt(id),
      null,
      false
    );
    this.logger.info(`task ${id} spawned and get set to go`);
    const cronDetail: CronDeail = {
      id,
      type: "Yahoo",
      schedule,
      jobInstance: newCronJob,
    };
    this.cronList[id] = cronDetail;
    newCronJob.start();
  }

  async getCronList(email: string) {
    const cronIdList = values(this.cronList).map(cron => cron.id);
    return await this.yahooHunterModel.find({
      hunterInstanceId: In(cronIdList),
      user: { email }
    });
  }
}

