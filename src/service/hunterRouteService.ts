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
  CronDeail,
  CipherPayload,
} from "../types";
import CONST from "../const";
import { Context } from "egg";
import { CustomConfig } from "../config/config.default";
import CipherServive from "./cipher";
import { YahooHunter, MercariHunter, SurugayaHunter } from "./hunterArsenal";

function hunterCognition<T extends GoodsHunter>(
  hunterInfo: GoodsHunter,
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
    return [...mercariHunterList, ...yahooHunterList, ...surugayaHunterList];
  }

  // FIXME unlikely conflict between different sites
  async addUserIgnoreGoods(payload: CipherPayload) {
    await this.cipher.checkIfMessageConsumed(payload.data.message);
    const decodedMessage = await this.cipher.decode(payload);
    const [user, goodId] = decodedMessage.split(" ");

    await this.redisClient.sadd(`${CONST.USERIGNORE}_${user}`, goodId);
    await this.cipher.addMessageToConsume(payload.data.message);
  }

  async cancelUserIgnoreGoods(payload: CipherPayload) {
    await this.cipher.checkIfMessageConsumed(payload.data.message);
    const decodedMessage = await this.cipher.decode(payload);

    const [user, goodId] = decodedMessage.split(" ");

    await this.redisClient.srem(`${CONST.USERIGNORE}_${user}`, goodId);
    await this.cipher.addMessageToConsume(payload.data.message);
  }

  async transferHunter(
    id: string,
    newHunterInfo: Pick<
      GoodsHunter,
      "freezingRange" | "user" | "schedule" | "type" | "searchCondition"
    >
  ) {
    if (hunterCognition<MercariHunterType>(newHunterInfo as any, (info) => info.type === "Mercari")) {
      await this.mercariHunter.transfer(id, newHunterInfo)
    }
    if (hunterCognition<YahooHunterType>(newHunterInfo as any, (info) => info.type === "Yahoo")) {
      await this.yahooHunter.transfer(id, newHunterInfo)
    }
    if (hunterCognition<YahooHunterType>(newHunterInfo as any, (info) => info.type === "Surugaya")) {
      await this.surugayaHunter.transfer(id, newHunterInfo);
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
    }
  }

  async hireNewHunterForUser(ctx: Context, hunterInfo: GoodsHunter) {
    if (
      hunterCognition<MercariHunterType>(
        hunterInfo,
        info => info.type === "Mercari"
      )
    ) {
      this.mercariHunter.hire(ctx, hunterInfo);
    }

    if (
      hunterCognition<YahooHunterType>(
        hunterInfo,
        info => info.type === "Yahoo"
      )
    ) {
      this.yahooHunter.hire(ctx, hunterInfo);
    }

    if (
      hunterCognition<YahooHunterType>(
        hunterInfo,
        info => info.type === "Surugaya"
      )
    ) {
      this.surugayaHunter.hire(ctx, hunterInfo);
    }
  }
}


