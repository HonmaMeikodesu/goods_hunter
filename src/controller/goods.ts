import { Controller, Post, Inject, Provide, Body, Get, Query } from '@midwayjs/decorator';
import { HunterCronManager } from '../service/hunterCronManager';
import { Context } from "egg";
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
  async registerGoodsWatcher(@Body() url: string, @Body() schedule: string) {
    const user = this.ctx.user as UserInfo;
    await this.hunterCronManager.addCronTask({ url, schedule, user: { email: user.email } });
  }

  @Get('/unregisterGoodsWatcher', { middleware: [ "loginStateCheck" ]})
  async unregisterGoodsWatcher(@Query("url") url: string) {
    if (!url) throw new Error(errorCode.common.invalidRequestBody);
    const user = this.ctx.user as UserInfo;
    await this.goodsService.deleteTask(user.email, url);
  }
}
