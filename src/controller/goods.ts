import {
  Controller,
  Post,
  Inject,
  Provide,
  Body,
  Get,
  Query,
} from "@midwayjs/decorator";
import { HunterCronManager } from "../service/hunterCronManager";
import { Context } from "egg";
import { toNumber } from "lodash";
import { GoodsHunter, UserInfo } from "../types";
import { GoodsService } from "../service/goods";
import errorCode from "../errorCode";
import getHunterType from "../utils/getHunterType";
import CONST from "../const";
import moment from "moment";
import { isValidCron } from "cron-validator";
import isUrl from "../utils/isValidUrl";

@Provide()
@Controller("/goods", { middleware: ["loginStateCheck"] })
export class GoodsController {
  @Inject()
  hunterCronManager: HunterCronManager;

  @Inject()
  goodsService: GoodsService;

  @Inject()
  ctx: Context;

  @Post("/registerGoodsWatcher")
  async registerGoodsWatcher(
    @Body("url")
    url: string,
    @Body("schedule")
    schedule: string,
    @Body("freezeStart")
    freezeStart: string,
    @Body("freezeEnd")
    freezeEnd: string
  ) {
    if (!isUrl(decodeURIComponent(url)) || !isValidCron(schedule)) throw new Error(errorCode.common.invalidRequestBody);
    if (freezeStart || freezeEnd) {
      freezeStart = freezeStart || "";
      freezeEnd = freezeEnd || "";
      const reg = /^\d{2}:\d{2}$/;
      const arr = [freezeStart, freezeEnd];
      if (arr.find(val => !reg.test(val)))
        throw new Error(errorCode.common.invalidRequestBody);
      const hours = arr.map(val => val.split(":")[0]);
      const mins = arr.map(val => val.split(":")[1]);
      if (
        hours.find(val => toNumber(val) > 23 || toNumber(val) < 0) ||
        mins.find(val => toNumber(val) > 59 || toNumber(val) < 0)
      )
        throw new Error(errorCode.common.invalidRequestBody);
    }
    const user = this.ctx.user as UserInfo;
    await this.goodsService.checkTaskExist(url, "Mercari");
    url = decodeURIComponent(url);
    await this.hunterCronManager.hireNewHunterForUser(this.ctx, {
      url,
      type: getHunterType(url),
      schedule,
      user: { email: user.email },
      freezingRange:
        freezeStart && freezeEnd
          ? { start: freezeStart, end: freezeEnd }
          : undefined,
      createdAt: moment().unix().toString(),
    });
  }

  @Get("/unregisterGoodsWatcher")
  async unregisterGoodsWatcher(
    @Query("id")
    id: string
  ) {
    if (!id) throw new Error(errorCode.common.invalidRequestBody);
    await this.goodsService.deleteTask(id, "Mercari");
  }

  @Get("/listGoodsWatcher")
  async listGoodsWatcher(
    @Query("type")
    type: typeof CONST.HUNTERTYPE[number]
  ) {
    if (!CONST.HUNTERTYPE.includes(type))
      throw new Error(errorCode.goodsController.invalidHunterType);
    const user = this.ctx.user as UserInfo;
    const list = await this.goodsService.listUserTasks(user.email, type);
    return list;
  }

  @Get("/ignoreGood")
  async ignoreGood(
    @Query("goodId")
    goodId: string
  ) {
    if (!goodId) throw new Error(errorCode.common.invalidRequestBody);
    const user = this.ctx.user as UserInfo;
    await this.hunterCronManager.addUserIgnoreGoods(user.email, [goodId]);
  }

  @Get("/cancelGoodIgnore")
  async cancelGoodIgnore(
    @Query("goodId")
    goodId: string
  ) {
    if (!goodId) throw new Error(errorCode.common.invalidRequestBody);
    const user = this.ctx.user as UserInfo;
    await this.hunterCronManager.cancelUserIgnoreGoods(user.email, [goodId]);
  }

  @Post("/updateGoodsWatcher")
  async updateGoodsWatcher(
    @Body("id")
    id: string,
    @Body("url")
    url: string,
    @Body("schedule")
    schedule: string,
    @Body("freezeStart")
    freezeStart: string,
    @Body("freezeEnd")
    freezeEnd: string
  ) {
    if (!id || !isUrl(url) || !isValidCron(schedule) || ((freezeStart || freezeEnd) && [freezeStart, freezeEnd].some((item) => !/\d\d:\d\d/.test(item))))  {
      throw new Error(errorCode.common.invalidRequestBody);
    }
    await this.hunterCronManager.transferHunter(id, {
      url,
      schedule,
      freezingRange: {
        start: freezeStart,
        end: freezeEnd,
      },
      user: {
        email: this.ctx.user?.email
      },
    });
  }
}
