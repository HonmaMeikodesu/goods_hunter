import { Provide, Inject, Scope, ScopeEnum, Logger, Config, Init, TaskLocal } from "@midwayjs/decorator";
import { In, Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { CronDeail, GoodsHunter, UserInfo } from "../../types";
import { CronJob, CronTime } from "cron";
import { v4 as uuid } from "uuid";
import { User } from "../../model/user";
import { first, isEmpty, toNumber, values } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import CONST from "../../const";
import HunterBase from "./base";
import { mercariGoodsList } from "../../template";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import errorCode from "../../errorCode";
import { MercariApi } from "../../api/site/mercari";
import { MercariHunter as MercariHunterModel } from "../../model/mercariHunter";
import { MercariHunter as MercariHuntetType } from "../../types";
import { MercariGoodsSearchCondition, GoodsListResponse as MercariGoodsListResponse } from "../../api/site/mercari/types";

@Provide()
@Scope(ScopeEnum.Singleton)
export class MercariHunterService extends HunterBase {

  hunterType: typeof CONST.HUNTERTYPE[number] = "Mercari";

  @Inject()
  mercariApi: MercariApi;

  @InjectEntityModel(MercariHunterModel)
  mercariHunterModel: Repository<MercariHunterModel>;

  @TaskLocal("0 */1 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {

    const promiseList: Promise<void>[] = [];

    const hunterList = await this.mercariHunterModel.find({
      relations: ["user"],
    });

    hunterList.forEach(hunter => {
      const { hunterInstanceId, schedule } = hunter;
      promiseList.push(this.spawnCronJob(hunterInstanceId, schedule));
    });

    Promise.all(promiseList)
      .then(() => {
        this.logger.info(
          "all mercari hunters standing by!"
        );
      })
      .catch(reason => {
        this.logger.error("Oops....Something went wrong when waking up mercari hunters:" + reason);
        process.exit(-1);
      });
  }

  async hire(ctx: Context, hunterInfo: MercariHuntetType) {
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
        const newMercariHunter = new MercariHunterModel();
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
        await this.spawnCronJob(cronId, hunterInfo?.schedule);
      },
      rejected: async () => {
        throw new Error("Error when executing add mercariHunter cronJob");
      },
    });

  }

  async goHunt(cronId: string) {
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

  async dismiss(id: string) {
    const cronJob = this.cronList[id];
    if (!cronJob) return;
    await this.mercariHunterModel.delete({
      hunterInstanceId: id,
    });
    cronJob.jobInstance?.stop();
    delete this.cronList[id];
    this.logger.info(`task ${id} removed`);
  }

  async transfer(id: string, newHunterInfo: Pick<MercariHuntetType, "freezingRange" | "user" | "schedule" | "type" | "searchCondition">) {
    const hunter = await this.mercariHunterModel.findOne({
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
      let prevSearchCondition: MercariGoodsSearchCondition;
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
          await queryRunner.manager.update(
            MercariHunterModel,
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
      type: "Mercari",
      schedule,
      jobInstance: newCronJob,
    };
    this.cronList[id] = cronDetail;
    newCronJob.start();
  }

  async getCronList(email: string) {
    const cronIdList = values(this.cronList).map(cron => cron.id);
    return await this.mercariHunterModel.find({
      hunterInstanceId: In(cronIdList),
      user: { email }
    });
  }

}
