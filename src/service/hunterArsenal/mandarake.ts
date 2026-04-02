import { Provide, Inject, Scope, ScopeEnum, Init, TaskLocal } from "@midwayjs/decorator";
import { In, Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { isEmpty } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import CONST from "../../const";
import HunterBase from "./base";
import { mandarakeGoodsList } from "../../template";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import { MandarakeApi } from "../../api/site/mandarake";
import { MandarakeHunter as MandarakeHunterModel } from "../../model/mandarakeHunter";
import { MandarakeHunter as MandarakeHunterType } from "../../types";
import { MandarakeGoodsRecord } from "../../model/mandarakeGoodsRecord";
import {
  MandarakeGoodsSearchCondition,
  GoodsListResponse as MandarakeGoodsListResponse,
} from "../../api/site/mandarake/types";

@Provide()
@Scope(ScopeEnum.Singleton)
export class MandarakeHunterService extends HunterBase {
  hunterType: (typeof CONST.HUNTERTYPE)[number] = "Mandarake";

  @Inject()
  mandarakeApi: MandarakeApi;

  @InjectEntityModel(MandarakeHunterModel)
  hunterModel: Repository<MandarakeHunterModel>;

  @InjectEntityModel(MandarakeGoodsRecord)
  mandarakeGoodsRecordModel: Repository<MandarakeGoodsRecord>;

  @TaskLocal("*/2 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {
    await super.init();
  }

  async hire(ctx: Context, hunterInfo: MandarakeHunterType) {
    await super.hire(ctx, hunterInfo, MandarakeHunterModel, "mandarakeHunters");
  }

  async goHunt(cronId: string) {
    const currentHunterInfo = await this.hunterModel.findOne({
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
    let searchCondition: MandarakeGoodsSearchCondition;
    try {
      searchCondition = JSON.parse(searchConditionSchema);
      if (!searchCondition.keyword) {
        throw new Error("no keyword found!");
      }
    } catch (e) {
      this.logger.error(
        `Invalid Mandarake Hunter search condition when executiong cronjob{${cronId}}, ${e}`
      );
      return;
    }
    let resp: MandarakeGoodsListResponse = null;
    try {
      resp = await this.mandarakeApi.fetchGoodsList(searchCondition);
    } catch (e) {
      this.logger.error(
        `Fail to fetch good list when executing cronjob{${cronId}}, ${e}`
      );
      return;
    }
    const goodsList = resp.items;
    if (isEmpty(goodsList)) {
      this.logger.info(`task ${cronId} gets an empty goodsList, exiting...`);
      return;
    }
    const goodsIds = goodsList.map(good => good.id);
    const lastSeenGoodList = await this.mandarakeGoodsRecordModel.find({
      where: {
        hunter: {
          hunterInstanceId: cronId,
        },
        id: In(goodsIds),
      },
      select: ["id"],
    });

    const lastSeenGoodIds = new Set(lastSeenGoodList.map(item => item.id));

    let filteredGoods = goodsList.filter(good => {
      return !lastSeenGoodIds.has(good.id);
    });

    try {
         if (!isEmpty(filteredGoods)) {
          const html = render(mandarakeGoodsList, {
            data: filteredGoods,
            serverHost: this.serverInfo.serverHost,
          });

          const emailMessage: Mail.Options = {
            to: user.email,
            subject: `New update on Mandarake goods of your interest, keyword:${searchCondition.keyword}`,
            html,
          };
          await this.emailService.sendEmail(emailMessage);

          await this.mandarakeGoodsRecordModel.createQueryBuilder().insert().values(filteredGoods.map(good => ({
            id: good.id,
            name: good.name,
            hunter: { hunterInstanceId: cronId },
            price: good.price || null,
          }))).execute();

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
    } catch(e) {
        this.logger.error(
          `task ${cronId} execution failed at ${moment().format(
            "YYYY:MM:DD hh:mm:ss"
          )}, here is the error message:\n${e}`
        );
    }
  }

  async transfer(
    id: string,
    newHunterInfo: Pick<
      MandarakeHunterType,
      "freezingRange" | "schedule" | "searchCondition"
    >
  ) {
    await super.transfer(id, newHunterInfo, MandarakeHunterModel);

    const hunter = await this.hunterModel.findOne({
      where: {
        hunterInstanceId: id,
      },
    });

    const {
      searchConditionSchema: prevSearchConditionSchema,
    } = hunter;
    let prevSearchCondition: MandarakeGoodsSearchCondition;
    try {
      prevSearchCondition = JSON.parse(prevSearchConditionSchema);
    } catch (e) {
      // pass
    }

    if (prevSearchCondition?.keyword !== newHunterInfo.searchCondition.keyword) {
      await this.hunterModel.manager.delete(MandarakeGoodsRecord, {
        hunter: {
          hunterInstanceId: id
        }
      });
    }
  }
}
