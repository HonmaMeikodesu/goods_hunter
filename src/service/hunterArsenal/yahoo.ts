import { Provide, Inject, Scope, ScopeEnum, Config, TaskLocal, Init } from "@midwayjs/decorator";
import { YahooAuctionApi } from "../../api/site/yahoo";
import { In, Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { YahooHunter as YahooHunterModel } from "../../model/yahooHunter";
import { YahooHunter as YahooHunterType } from "../../types";
import { isEmpty } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import { YahooAuctionGoodsSearchCondition, GoodsListResponse as YahooGoodsListResponse } from "../../api/site/yahoo/types";
import CONST from "../../const";
import HunterBase from "./base";
import { yahooGoodsList } from "../../template";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import { CustomConfig } from "../../config/config.default";
import { YahooAuctionRecord } from "../../model/yahooAuctionRecord";

@Provide()
@Scope(ScopeEnum.Singleton)
export class YahooHunterService extends HunterBase {

  hunterType: typeof CONST.HUNTERTYPE[number] = "Yahoo";

  @Inject()
  yahooApi: YahooAuctionApi;

  @InjectEntityModel(YahooHunterModel)
  hunterModel: Repository<YahooHunterModel>;

  @InjectEntityModel(YahooAuctionRecord)
  yahooAuctionRecordModel: Repository<YahooAuctionRecord>;

  @Config("emailConfig")
  mailInfo: CustomConfig["emailConfig"];

  @TaskLocal("0 * * * *")
  private async cookieHeartBeatCheck() {
    const yahooCookieValid = await this.yahooApi.checkCookieHeartBeat();
    // Only emit known codes: upstream errors can contain URLs or credentials.
    const knownReasons = ["NEEDS_LOGIN", "FC_NEEDS_LOGIN", "FC_CHECK_FAILED", "FC_AUTH_UNVERIFIED",
      "STATE_UNREADABLE", "STATE_INVALID", "STATE_STALE", "COOKIES_MISSING", "COOKIES_EXPIRED",
      "COOKIE_INVALID", "COOKIE_DOMAIN_INVALID", "LEGACY_UNREADABLE"];
    const reason = knownReasons.includes(yahooCookieValid?.reason) ? yahooCookieValid.reason : "UNKNOWN";
    this.logger.info(`Yahoo session check: ${yahooCookieValid?.result ? "OK" : reason}`);
    if (yahooCookieValid?.result) return;
    // Connectivity, unreadable state and stale snapshots do not prove expiry.
    // Only a login requirement or expired cookies warrants an email.
    if (!["NEEDS_LOGIN", "FC_NEEDS_LOGIN", "COOKIES_EXPIRED"].includes(reason)) return;

    // Shared, atomic cooldown survives restarts and intermittent recovery. Claim
    // before SMTP: an ambiguous send failure must not cause duplicate messages.
    try {
      const claimed = await this.redisClient.set("goods-hunter:yahoo:login-alert:v1", "1", "EX", 86400, "NX");
      if (claimed !== "OK") return;
    } catch {
      this.logger.error("Yahoo session alert suppressed: cooldown store unavailable");
      return;
    }
    try {
      await this.emailService.sendEmail({
        to: this.mailInfo.contactSystemOwner,
        subject: "Yahoo session needs login",
        text: `Yahoo session requires login or its cookies have expired (${reason}). Check the session manager status and use the remote login command if needed. Reminders are limited to once per 24 hours.`
      });
    } catch {
      this.logger.error("Yahoo session alert delivery failed; daily cooldown retained");
    }
  }

  @TaskLocal("*/2 * * * *")
  private async selfPingPong() {
    await super.pingpongTask();
  }

  @Init()
  async init() {
      await super.init();
  }

  async hire(ctx: Context, hunterInfo: YahooHunterType) {
      await super.hire(ctx, hunterInfo, YahooHunterModel, "yahooHunters");
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

    const goodsIds = goodsList.map(good => good.id);
    const lastSeenAuctionList = await this.yahooAuctionRecordModel.find({
      where: {
        hunter: {
          hunterInstanceId: cronId,
        },
        auctionId: In(goodsIds),
      },
      select: ["auctionId"],
    });

    const lastSeenAuctionIds = new Set(lastSeenAuctionList.map(item => item.auctionId));

    const filteredGoods = goodsList.filter((good) => {
      return !lastSeenAuctionIds.has(good.id);
    });

    try {
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
        await this.yahooAuctionRecordModel.createQueryBuilder().insert().values(filteredGoods.map(good => ({
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
        );
      }
      this.logger.info(
        `task ${cronId} executed steady and sound at ${moment().format(
          "YYYY:MM:DD hh:mm:ss"
        )}`
      );
    } catch (e) {
      this.logger.error(
        `task ${cronId} execution failed at ${moment().format(
          "YYYY:MM:DD hh:mm:ss"
        )}, here is the error message:\n${e}`
      );
    };
  }


  async transfer(id: string, newHunterInfo: Pick<YahooHunterType, "freezingRange" | "schedule" | "searchCondition">) {
      await super.transfer(id, newHunterInfo, YahooHunterModel);
      const hunter = await this.hunterModel.findOne({
          where: {
              hunterInstanceId: id,
          },
      });

      const {
          searchConditionSchema: prevSearchConditionSchema
      } = hunter;
      let prevSearchCondition: YahooAuctionGoodsSearchCondition;
      try {
          prevSearchCondition = JSON.parse(prevSearchConditionSchema);
      } catch (e) {
          // pass
      }
      if (prevSearchCondition?.keyword !== newHunterInfo.searchCondition.keyword) {
          await this.hunterModel.manager.delete(YahooAuctionRecord, {
              hunter: {
                  hunterInstanceId: id
              }
          });
      }
  }
}
