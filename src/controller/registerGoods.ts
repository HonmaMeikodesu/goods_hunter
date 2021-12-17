import { Controller, Post, Inject, Provide, Body } from '@midwayjs/decorator';
import { HunterCronManager } from '../service/hunterCronManager';
import { Context } from "egg";
import { UserInfo } from '../types';

@Provide()
@Controller('/', { middleware: ["loginStateCheck"]})
export class RegisterGoodsController {

  @Inject()
  hunterCronManager: HunterCronManager;

  @Inject()
  ctx: Context;

  @Post('/registerGoodsWatcher')
  async registerGoodsWatcher(@Body() url: string, @Body() schedule: string) {
    const user = this.ctx.user as UserInfo;
    await this.hunterCronManager.addCronTask({ url, schedule, user: { email: user.email } });
    return {
      code: "200",
    };
  }
}
