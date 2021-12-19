import { Controller, Post, Inject, Provide, Body } from '@midwayjs/decorator';
import { HunterCronManager } from '../service/hunterCronManager';
import { Context } from "egg";
import { UserInfo } from '../types';

@Provide()
@Controller('/')
export class RegisterGoodsController {

  @Inject()
  hunterCronManager: HunterCronManager;

  @Inject()
  ctx: Context;

  @Post('/registerGoodsWatcher', { middleware: ['loginStateCheck'] })
  async registerGoodsWatcher(@Body() url: string, @Body() schedule: string) {
    const user = this.ctx.user as UserInfo;
    await this.hunterCronManager.addCronTask({ url, schedule, user: { email: user.email } });
  }
}
