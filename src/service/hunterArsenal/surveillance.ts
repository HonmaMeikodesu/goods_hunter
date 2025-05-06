import {
  Provide,
  Scope,
  ScopeEnum,
  Init,
  TaskLocal,
  Inject,
} from "@midwayjs/decorator";
import { Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import Mail from "nodemailer/lib/mailer";
import { mercariGoodsDetail } from "../../template";
import { Context } from "egg";
import CONST from "../../const";
import HunterBase from "./base";
import {
  MercariHunter as MercariHuntetType,
  SurveillanceHunter,
} from "../../types";
import { SurveillanceRecord } from "../../model/surveillanceRecord";
import { first, isEmpty } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import { GoodsSurveillanceConditionBase } from "../../api/site/types";
import { YahooAuctionApi } from "../../api/site/yahoo";
import { MercariApi } from "../../api/site/mercari";
import { GoodsDetailData } from "../../api/site/mercari/types";
import { render } from "ejs";

@Provide()
@Scope(ScopeEnum.Singleton)
export class SurveillanceHunterService extends HunterBase {
  hunterType: (typeof CONST.HUNTERTYPE)[number] = "Surveillance";

  @InjectEntityModel(SurveillanceRecord)
  hunterModel: Repository<SurveillanceRecord>;

  @Inject()
  mercariApi: MercariApi;

  @Inject()
  yahooApi: YahooAuctionApi;


  @TaskLocal("0 */1 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {
    await super.init();
  }

  async hire(ctx: Context, hunterInfo: SurveillanceHunter) {
    let snapshot: string;
    if (hunterInfo?.searchCondition?.type === "mercari") {
      snapshot = JSON.stringify(await this.mercariApi.fetchGoodDetail({
        id: hunterInfo.searchCondition.goodId,
      }));
    }
    const hunterId = await super.hire(
      ctx,
      hunterInfo,
      SurveillanceRecord,
      "surveillanceRecords"
    );

    await this.updateSnapshot(hunterId as string, snapshot);
  }

    async updateSnapshot(hunterId: string, newShapshot: string) {
      await this.hunterModel.update(
        {
          hunterInstanceId: hunterId,
        },
        {
          snapshot: newShapshot,
        }
      );
    }
  async goHunt(cronId: string) {
    const currentHunterInfo = await this.hunterModel.findOne({
      where: {
        hunterInstanceId: cronId,
      },
      relations: ["user"],
    });
    if (isEmpty(currentHunterInfo)) return;
    const { searchConditionSchema, freezingStart, freezingEnd, user, snapshot } =
      currentHunterInfo;
    if (
      freezingStart &&
      freezingEnd &&
      isBetweenDayTime(freezingStart, freezingEnd)
    ) {
      this.logger.info(`task ${cronId} sleeping, exiting...`);
      return;
    }
    let searchCondition: GoodsSurveillanceConditionBase;
    try {
      searchCondition = JSON.parse(searchConditionSchema);
      if (!searchCondition.goodId || !searchCondition.type) {
        throw new Error("no goodId or type found!");
      }
    } catch (e) {
      this.logger.error(
        `Invalid Mercari Hunter search condition when executiong cronjob{${cronId}}, ${e}`
      );
      return;
    }

    const sendMercariUpdateAndSaveDb = async (newSnapshot: GoodsDetailData) => {
      const prev = JSON.parse(snapshot || "{}") as GoodsDetailData;
      const { name, status, price, id, thumbnails } = newSnapshot;
      const html = render(mercariGoodsDetail, {
        data: {
          id,
          thumbnailData: await this.cipher.encode(first(thumbnails)),
          status,
          name,
          oldPrice: prev.price,
          newPrice: price,
          hunterId: cronId,
        },
        serverHost: this.serverInfo.serverHost,
      });
      const emailMessage: Mail.Options = {
        to: user.email,
        subject: `Mercari item: ${name}`,
        html,
      };
      await this.emailService.sendEmail(emailMessage);
      this.logger.info(
        `Mercari Subscription email sent to ${user.email}, goodRecord:${id}/${name}}\n`
      );

      await this.updateSnapshot(cronId, JSON.stringify(newSnapshot));
    }

    if (searchCondition?.type === "mercari") {
      const prev = JSON.parse(snapshot) as GoodsDetailData;
      const latestGoodsDetail = await this.mercariApi.fetchGoodDetail({ id: searchCondition.goodId });
      if (( isEmpty(snapshot) || latestGoodsDetail.price !== prev.price || prev.status !== latestGoodsDetail.status ) && latestGoodsDetail.status !== "invalid") {
        await sendMercariUpdateAndSaveDb(latestGoodsDetail);
      }
      if (latestGoodsDetail.status === "invalid" || latestGoodsDetail.status === "sold_out") {
        await this.dismiss(cronId);
        this.logger.info(`Mercari item ${searchCondition.goodId} becomes no longer available, deleting the subscription...`);
      }
    }
  }

  async transfer(
    id: string,
    newHunterInfo: Partial<Pick<
      SurveillanceHunter,
      "freezingRange" | "schedule" | "type" | "searchCondition"
    >>
  ) {
    await super.transfer(id, newHunterInfo, SurveillanceRecord);
  }
}

