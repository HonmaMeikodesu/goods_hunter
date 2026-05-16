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
import { mercariGoodsDetail, yahooGoodDetail, surugayaGoodDetail, mandarakeGoodDetail } from "../../template";
import { Context } from "egg";
import CONST from "../../const";
import HunterBase from "./base";
import {
  SurveillanceHunter,
} from "../../types";
import { SurveillanceRecord } from "../../model/surveillanceRecord";
import { isEmpty } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import { GoodsSurveillanceConditionBase } from "../../api/site/types";
import { render } from "ejs";
import { AliCloudApi } from "../../api/alicloud";
import { JSDOM } from "jsdom";
import { MERCARI_FETCH_SCRIPT } from "../../api/site/mercari/index";
import { SURUGAYA_FETCH_COOKIES } from "../../api/site/surugaya/index";
import { MANDARAKE_FETCH_COOKIES } from "../../api/site/mandarake/index";
import { YahooAuctionApi } from "../../api/site/yahoo/index";

@Provide()
@Scope(ScopeEnum.Singleton)
export class SurveillanceHunterService extends HunterBase {
  hunterType: (typeof CONST.HUNTERTYPE)[number] = "Surveillance";

  @InjectEntityModel(SurveillanceRecord)
  hunterModel: Repository<SurveillanceRecord>;

  @Inject()
  alicloudApi: AliCloudApi;

  @Inject()
  yahooApi: YahooAuctionApi;

  @TaskLocal("*/2 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {
    await super.init();
  }

  async fetchItemSnapshot(type: string, id: string) {
    let url = "";
    let cookies: any[] | undefined = undefined;
    let evaluateScript: string | undefined = undefined;
    let pageLoadedAssertion: string | undefined = undefined;

    if (type === "mercari") {
      url = `https://jp.mercari.com/item/${id}`;
      evaluateScript = MERCARI_FETCH_SCRIPT;
      pageLoadedAssertion ="data-testid=\"price\"";
    } else if (type === "surugaya") {
      url = `https://www.suruga-ya.jp/product/detail/${id}`;
      cookies = SURUGAYA_FETCH_COOKIES;
      pageLoadedAssertion = "price_group";
    } else if (type === "yahoo") {
      url = `https://auctions.yahoo.co.jp/jp/auction/${id}`;
      cookies = this.yahooApi.getParsedCookies();
      pageLoadedAssertion = "itemStatus";
    } else if (type === "mandarake") {
      url = `https://order.mandarake.co.jp/order/detailPage/item?itemCode=${id}`;
      cookies = MANDARAKE_FETCH_COOKIES;
      pageLoadedAssertion = "在庫";
    }

    try {
      const resp = await this.alicloudApi.fetchHtmlViaServerless(url, pageLoadedAssertion, cookies, undefined, 3, evaluateScript);
      const dom = new JSDOM(resp.content);
      const document = dom.window.document;

      let price = "";
      let isSold = false;

      if (type === "mercari") {
        price = document.body.querySelector('[data-testid="converted-currency-section"] > p:nth-child(3)')?.textContent || "";
        isSold = !!document.body.querySelector('div[role="img"][data-testid="thumbnail-sticker"][aria-label="売り切れ"]');
      } else if (type === "surugaya") {
        price = document.body.querySelector(".text-price-detail.price-buy")?.textContent || "";
        isSold = !!document.body.querySelector("[value='入荷待ちリストへ']");
      } else if (type === "yahoo") {
        price = document.body.querySelector("div > div > div > dl > dd > span")?.textContent || "";
        isSold = false;
      } else if (type === "mandarake") {
        price = document.body.querySelector(".shohin_price.__price+p")?.textContent || "";
        isSold = !!document.body.querySelector(".operate .soldout");
      }

      const title = document.querySelector('meta[property="og:title"]')?.getAttribute("content") || "";
      const image = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";

      let status = isSold ? "sold_out" : "on_sale";
      // 没有标题
      // 未售出但是获取不到价格
      // 视为异常状态
      if (( !price && !isSold ) || !title) {
        status = "invalid";
      }

      return {
        id,
        name: title,
        price,
        status,
        thumbnails: [image],
      };
    } catch (e) {
      this.logger.error(`Failed to fetch item snapshot for ${type} ${id}: ${e}`);
      return {
        id,
        name: "",
        price: "",
        status: "invalid",
        thumbnails: [],
      };
    }
  }

  async hire(ctx: Context, hunterInfo: SurveillanceHunter) {
    let snapshot: string = "";
    if (hunterInfo?.searchCondition?.type && hunterInfo?.searchCondition?.goodId) {
      const data = await this.fetchItemSnapshot(hunterInfo.searchCondition.type, hunterInfo.searchCondition.goodId);
      snapshot = JSON.stringify(data);
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
        `Invalid Surveillance Hunter search condition when executiong cronjob{${cronId}}, ${e}`
      );
      return;
    }

    const sendUpdateAndSaveDb = async (newSnapshot: any) => {
      const prev = JSON.parse(snapshot || "{}");
      const { name, status, price, id, thumbnails } = newSnapshot;
      
      let template;
      if (searchCondition.type === "mercari") template = mercariGoodsDetail;
      else if (searchCondition.type === "yahoo") template = yahooGoodDetail;
      else if (searchCondition.type === "surugaya") template = surugayaGoodDetail;
      else if (searchCondition.type === "mandarake") template = mandarakeGoodDetail;

      if (!template) return;

      const html = render(template, {
        data: {
          id,
          thumbnails,
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
        subject: `${searchCondition.type} item: ${name}`,
        html,
      };
      await this.emailService.sendEmail(emailMessage);
      this.logger.info(
        `Surveillance Subscription email sent to ${user.email}, goodRecord:${id}/${name}}\n`
      );

      await this.updateSnapshot(cronId, JSON.stringify(newSnapshot));
    }

    const prev = JSON.parse(snapshot || "{}");
    const latestGoodsDetail = await this.fetchItemSnapshot(searchCondition.type, searchCondition.goodId);

    if (latestGoodsDetail.status === "invalid") {
      this.logger.error(`Failed to fetch latest goods detail for hunter ${cronId}, status invalid.`);
      return;
    }
    
    const priceChanged = latestGoodsDetail.price !== prev.price;
    const statusChanged = latestGoodsDetail.status !== prev.status && latestGoodsDetail.status === "sold_out";

    if (isEmpty(snapshot) || priceChanged || statusChanged) {
      await sendUpdateAndSaveDb(latestGoodsDetail);
    }

    if (latestGoodsDetail.status === "sold_out") {
      await this.dismiss(cronId);
      this.logger.info(`${searchCondition.type} item ${searchCondition.goodId} becomes sold out, deleting the subscription...`);
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

