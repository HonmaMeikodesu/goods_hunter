import { Controller, Post, Inject, Provide, Body } from '@midwayjs/decorator';
import { ProxyGet } from '../api/request';
import { HunterCronManager } from '../service/hunterCronManager';

@Provide()
@Controller()
export class RegisterGoodsController {

  @Inject()
  hunterCronManager: HunterCronManager;

  @Post('/registerGoodsWatcher')
  async registerGoodsWatcher(@Body() url: string, @Body() schedule: string) {
    await this.hunterCronManager.addCronTask({ url,schedule });
    return '123!';
  }
}
