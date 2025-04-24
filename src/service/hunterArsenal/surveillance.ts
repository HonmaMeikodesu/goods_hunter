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
import { Context } from "egg";
import CONST from "../../const";
import HunterBase from "./base";
import {
  MercariHunter as MercariHuntetType,
  SurveillanceHunter,
} from "../../types";
import { SurveillanceRecord } from "../../model/surveillanceRecord";
import {isEmpty} from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import {GoodsSurveillanceCondition, GoodsSurveillanceConditionBase} from "../../api/site/types";
import {YahooAuctionApi} from "../../api/site/yahoo";
import {MercariApi} from "../../api/site/mercari";

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
    await super.hire(
      ctx,
      hunterInfo,
      SurveillanceRecord,
      "surveillanceRecords"
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
    let searchCondition: GoodsSurveillanceConditionBase;
    try {
      searchCondition = JSON.parse(searchConditionSchema);
      if (!searchCondition.url || !searchCondition.type) {
        throw new Error("no url or type found!");
      }
    } catch (e) {
      this.logger.error(
        `Invalid Mercari Hunter search condition when executiong cronjob{${cronId}}, ${e}`
      );
      return;
    }
    
    let curr: any = null;
    switch(searchCondition.type) {
        case "mercari":
            curr = await this.mercariApi.fetchGoodDetail({});
            break;
        case "yahoo":
            curr = await this.yahooApi.fetchGoodDetail({});
    };
    judgeGood({ prev: currentHunterInfo.snapshot, curr, type: searchCondition.type, criteria: searchCondition.criteria  });
  }

  async transfer(
    id: string,
    newHunterInfo: Pick<
      MercariHuntetType,
      "freezingRange" | "user" | "schedule" | "type" | "searchCondition"
    >
  ) {
    await super.transfer(id, newHunterInfo, SurveillanceRecord);
  }
}

function judgeGood(params: { curr: any; prev: any; type: GoodsSurveillanceConditionBase["type"], criteria: GoodsSurveillanceConditionBase["criteria"] }) {

}
