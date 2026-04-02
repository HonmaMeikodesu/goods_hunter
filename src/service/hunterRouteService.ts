import {
  Provide,
  Inject,
  Scope,
  ScopeEnum,
  Logger,
  Config,
} from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { RedisService } from "@midwayjs/redis";
import {
  GoodsHunter,
  MercariHunter as MercariHunterType,
  YahooHunter as YahooHunterType,
  SurugayaHunter as SurugayaHunterType,
  MandarakeHunter as MandarakeHunterType,
  CipherPayload,
  SurveillanceHunter as SurveillanceHunterType,
} from "../types";
import CONST from "../const";
import { Context } from "egg";
import { CustomConfig } from "../config/config.default";
import CipherServive from "./cipher";
import { YahooHunter, MercariHunter, SurugayaHunter, MandarakeHunter, SurveillanceHunter } from "./hunterArsenal";

function hunterCognition<T extends GoodsHunter>(
  hunterInfo: Partial<GoodsHunter>,
  cognitionFunc: (info: typeof hunterInfo) => boolean
): hunterInfo is T {
  return cognitionFunc(hunterInfo);
}

@Provide()
@Scope(ScopeEnum["Singleton"])
export class HunterRouteService {

  @Inject()
  yahooHunter: YahooHunter;

  @Inject()
  mercariHunter: MercariHunter;

  @Inject()
  surugayaHunter: SurugayaHunter;

  @Inject()
  mandarakeHunter: MandarakeHunter;

  @Inject()
  surveillanceHunter: SurveillanceHunter;

  @Config("serverInfo")
  serverInfo: CustomConfig["serverInfo"];

  @Logger()
  logger: ILogger;

  @Inject("redis:redisService")
  redisClient: RedisService;

  @Inject()
  cipher: CipherServive;

  async getCronList(email: string) {
    const mercariHunterList = await this.mercariHunter.getCronList(email);
    const yahooHunterList = await this.yahooHunter.getCronList(email);
    const surugayaHunterList = await this.surugayaHunter.getCronList(email);
    const mandarakeHunterList = await this.mandarakeHunter.getCronList(email);
    const surveillanceHunterList = await this.surveillanceHunter.getCronList(email);
    return [
      ...mercariHunterList,
      ...yahooHunterList,
      ...surugayaHunterList,
      ...mandarakeHunterList,
      ...surveillanceHunterList,
    ];
  }

  async transferHunter(
    id: string,
    newHunterInfo: Pick<
      GoodsHunter,
      "freezingRange" | "schedule" | "searchCondition"
    >
  ) {
    if (hunterCognition<MercariHunterType>(newHunterInfo, (info) => info.type === "Mercari")) {
      await this.mercariHunter.transfer(id, newHunterInfo)
    }
    if (hunterCognition<YahooHunterType>(newHunterInfo, (info) => info.type === "Yahoo")) {
      await this.yahooHunter.transfer(id, newHunterInfo)
    }
    if (hunterCognition<SurugayaHunterType>(newHunterInfo, (info) => info.type === "Surugaya")) {
      await this.surugayaHunter.transfer(id, newHunterInfo);
    }
    if (hunterCognition<MandarakeHunterType>(newHunterInfo, (info) => info.type === "Mandarake")) {
      await this.mandarakeHunter.transfer(id, newHunterInfo);
    }
    if (hunterCognition<SurveillanceHunterType>(newHunterInfo, (info) => info.type === "Surveillance")) {
      await this.surveillanceHunter.transfer(id, newHunterInfo);
    }
  }

  async dismissHunter(id: string, type: (typeof CONST.HUNTERTYPE)[number]) {
    switch (type) {
      case "Mercari":
        await this.mercariHunter.dismiss(id);
        break;
      case "Yahoo":
        await this.yahooHunter.dismiss(id);
        break;
      case "Surugaya":
        await this.surugayaHunter.dismiss(id);
        break;
      case "Mandarake":
        await this.mandarakeHunter.dismiss(id);
        break;
      case "Surveillance":
        await this.surveillanceHunter.dismiss(id);
    }
  }

  async hireNewHunterForUser(ctx: Context, hunterInfo: GoodsHunter) {
    if (
      hunterCognition<MercariHunterType>(
        hunterInfo,
        info => info.type === "Mercari"
      )
    ) {
      await this.mercariHunter.hire(ctx, hunterInfo);
    }

    if (
      hunterCognition<YahooHunterType>(
        hunterInfo,
        info => info.type === "Yahoo"
      )
    ) {
      await this.yahooHunter.hire(ctx, hunterInfo);
    }

    if (
      hunterCognition<SurugayaHunterType>(
        hunterInfo,
        info => info.type === "Surugaya"
      )
    ) {
      await this.surugayaHunter.hire(ctx, hunterInfo);
    }

    if (
      hunterCognition<MandarakeHunterType>(
        hunterInfo,
        info => info.type === "Mandarake"
      )
    ) {
      await this.mandarakeHunter.hire(ctx, hunterInfo);
    }

    if (
      hunterCognition<SurveillanceHunterType>(
        hunterInfo,
        info => info.type === "Surveillance"
      )
    ) {
      await this.surveillanceHunter.hire(ctx, hunterInfo);
    }

  }
}


