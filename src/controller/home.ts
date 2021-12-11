import { Controller, Get, Inject, Provide } from '@midwayjs/decorator';
import { ProxyGet } from '../api/request';

@Provide()
@Controller('/')
export class HomeController {

  @Inject("proxyGet")
  proxyGet: ProxyGet;

  @Get('/')
  async home() {
    await this.proxyGet("", {
      "X-Platform": "web",
      "DPoP": ""
    }).then((data) => console.log(data));

    return 'Hello Midwayjs!';
  }
}
