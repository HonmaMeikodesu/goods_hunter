import { App, Controller, Get, Inject, Provide } from '@midwayjs/decorator';
import axios from 'axios';

@Provide()
@Controller('/')
export class HomeController {

  @Inject("proxyGet")
  proxyGet: any;

  @Get('/')
  async home() {
    process.stdout.write('requesting\n');

    return 'Hello Midwayjs!';
  }
}
