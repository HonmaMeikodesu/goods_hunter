import {
  Provide,
  Inject,
  Scope,
  ScopeEnum,
  Init,
  TaskLocal,
} from "@midwayjs/decorator";
import { Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { first, isEmpty, toNumber } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import CONST from "../../const";
import HunterBase from "./base";
import { mercariGoodsList } from "../../template";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import { MercariApi } from "../../api/site/mercari";
import { MercariHunter as MercariHunterModel } from "../../model/mercariHunter";
import { MercariHunter as MercariHuntetType } from "../../types";
import { MercariGoodsRecord } from "../../model/mercariGoodsRecord";
import {
  MercariGoodsSearchCondition,
  GoodsListResponse as MercariGoodsListResponse,
} from "../../api/site/mercari/types";

@Provide()
@Scope(ScopeEnum.Singleton)
export class MercariHunterService extends HunterBase {
  hunterType: (typeof CONST.HUNTERTYPE)[number] = "Mercari";

  @Inject()
  mercariApi: MercariApi;

  @InjectEntityModel(MercariHunterModel)
  hunterModel: Repository<MercariHunterModel>;

  @InjectEntityModel(MercariGoodsRecord)
  mercariGoodsRecordModel: Repository<MercariGoodsRecord>;

  @TaskLocal("0 */1 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {
    await super.init();
  }

  async hire(ctx: Context, hunterInfo: MercariHuntetType) {
    await super.hire(ctx, hunterInfo, MercariHunterModel, "mercariHunters");
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
      this.logger.info(`task ${cronId} gets an empty goodsList, exiting...`);
      return;
    }
    const lastSeenGoodList = await this.mercariGoodsRecordModel.find({
      where: {
        hunter: {
          hunterInstanceId: cronId,
        },
      },
    });

    let filteredGoods = goodsList.filter(good => {
      const existed = lastSeenGoodList?.find(item => item.id === good.id);
      return !existed;
    });
    Promise.all(
      filteredGoods.map(async good => {
        good.thumbnailData = await this.cipher.encode(first(good.thumbnails));
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

          await this.mercariGoodsRecordModel.createQueryBuilder().insert().values(filteredGoods.map(good => ({
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
      })
      .catch(e => {
        this.logger.error(
          `task ${cronId} execution failed at ${moment().format(
            "YYYY:MM:DD hh:mm:ss"
          )}, here is the error message:\n${e}`
        );
      });
  }

  async transfer(
    id: string,
    newHunterInfo: Pick<
      MercariHuntetType,
      "freezingRange" | "schedule" | "searchCondition"
    >
  ) {
    await super.transfer(id, newHunterInfo, MercariHunterModel);

    const hunter = await this.hunterModel.findOne({
      where: {
        hunterInstanceId: id,
      },
    });

    const {
      searchConditionSchema: prevSearchConditionSchema,
    } = hunter;
    let prevSearchCondition: MercariGoodsSearchCondition;
    try {
      prevSearchCondition = JSON.parse(prevSearchConditionSchema);
    } catch (e) {
      // pass
    }

    if (prevSearchCondition?.keyword !== newHunterInfo.searchCondition.keyword) {
      await this.hunterModel.manager.delete(MercariGoodsRecord, {
        hunter: {
          hunterInstanceId: id
        }
      });
    }
  }
}
