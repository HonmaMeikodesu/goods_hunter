import { Controller, Post, Inject, Provide, Body, Get, Query } from '@midwayjs/decorator';
import { HunterCronManager } from '../service/hunterCronManager';
import { Context } from "egg";
import { toNumber } from "lodash";
import { UserInfo } from '../types';
import { GoodsService } from '../service/goods';
import errorCode from "../errorCode";

@Provide()
@Controller('/')
export class GoodsController {

  @Inject()
  hunterCronManager: HunterCronManager;

  @Inject()
  goodsService: GoodsService;

  @Inject()
  ctx: Context;

  @Post('/registerGoodsWatcher', { middleware: ['loginStateCheck'] })
  async registerGoodsWatcher(@Body() url: string, @Body() schedule: string, @Body() freezeStart: string, @Body() freezeEnd: string) {
    if (!url || !schedule) throw new Error(errorCode.common.invalidRequestBody);
    if (freezeStart || freezeEnd) {
      freezeStart = freezeStart || "";
      freezeEnd = freezeEnd || "";
      const reg = /^\d{2}:\d{2}$/;
      const arr = [freezeStart, freezeEnd];
      if (arr.find(val => !reg.test(val))) throw new Error(errorCode.common.invalidRequestBody);
      const hours = arr.map(val => val.split(":")[0]);
      const mins = arr.map(val => val.split(":")[1]);
      if (hours.find(val => toNumber(val) > 23 || toNumber(val) < 0) || mins.find(val => toNumber(val) > 59 || toNumber(val) < 0)) throw new Error(errorCode.common.invalidRequestBody);
    }
    const user = this.ctx.user as UserInfo;
    await this.goodsService.checkTaskExist(url);
    await this.hunterCronManager.addCronTask({ url, schedule, user: { email: user.email }, freezingRange: (freezeStart && freezeEnd) ? { start: freezeStart, end: freezeEnd } : undefined});
  }

  @Get('/unregisterGoodsWatcher', { middleware: [ "loginStateCheck" ]})
  async unregisterGoodsWatcher(@Query("url") url: string) {
    if (!url) throw new Error(errorCode.common.invalidRequestBody);
    const user = this.ctx.user as UserInfo;
    await this.goodsService.deleteTask(user.email, url);
  }
}
