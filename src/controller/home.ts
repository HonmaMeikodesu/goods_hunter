import { Controller, Get, Provide } from '@midwayjs/decorator';
import axios from 'axios';
const HttpsProxyAgent = require('https-proxy-agent');

@Provide()
@Controller('/')
export class HomeController {
  @Get('/')
  async home() {
    process.stdout.write('requesting\n');
    const agent = new HttpsProxyAgent('http://localhost:1218');

    axios
      .get(
        'https://api.mercari.jp/search_index/search?sort=score&order=desc&limit=120&keyword=anohana&status=on_sale&page=0',
        {
          httpsAgent: agent,
        }
      )
      .then(data => {
        process.stdout.write(data.data);
      })
      .catch(e => {
        process.stderr.write(e.message);
      });
    return 'Hello Midwayjs!';
  }
}
