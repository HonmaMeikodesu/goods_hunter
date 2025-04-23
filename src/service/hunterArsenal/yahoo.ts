import { Provide, Inject, Scope, ScopeEnum, Config, TaskLocal, Init } from "@midwayjs/decorator";
import { YahooAuctionApi } from "../../api/site/yahoo";
import { Repository } from "typeorm";
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


  async transfer(id: string, newHunterInfo: Pick<YahooHunterType, "freezingRange" | "user" | "schedule" | "type" | "searchCondition">) {
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

