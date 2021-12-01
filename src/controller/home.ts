import { Controller, Get, Provide } from '@midwayjs/decorator';
import axios from 'axios';

@Provide()
@Controller('/')
export class HomeController {
  @Get('/')
  async home() {
    process.stdout.write('requesting\n');
    axios
      .get(
        'https://api.mercari.jp/search_index/search?sort=score&order=desc&limit=120&keyword=anohana&status=on_sale&page=0'
      )
      .then(data => {
        process.stdout.write(data.data);
      });
    return 'Hello Midwayjs!';
  }
}
