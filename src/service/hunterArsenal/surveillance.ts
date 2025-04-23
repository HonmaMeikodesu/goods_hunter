import {
  Provide,
  Scope,
  ScopeEnum,
  Init,
  TaskLocal,
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

@Provide()
@Scope(ScopeEnum.Singleton)
export class SurveillanceHunterService extends HunterBase {
  hunterType: (typeof CONST.HUNTERTYPE)[number] = "Surveillance";

  @InjectEntityModel(SurveillanceRecord)
  hunterModel: Repository<SurveillanceRecord>;

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

  async goHunt(cronId: string) {}

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
