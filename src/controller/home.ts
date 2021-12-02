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
          headers: {
            'X-Platform': 'web',
            DPoP: 'eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7ImNydiI6IlAtMjU2Iiwia3R5IjoiRUMiLCJ4IjoiZlRHTFpZbFpGemkteHF1U0VyZWNwQTFxSklPRENRN1F5bV91VjNZY0JIbyIsInkiOiJmbkdMMk1XcGVFaWQtUWdmUldWdnJtVXljc3piV1pTLWI5eERJc0dpNW1BIn19.eyJpYXQiOjE2MzgzNzE4MDksImp0aSI6IjIxYjE5YzU2LTI2NjYtNGVjYS1hZjNiLTQwN2M4NDk5YjViZCIsImh0dSI6Imh0dHBzOi8vYXBpLm1lcmNhcmkuanAvc2VhcmNoX2luZGV4L3NlYXJjaCIsImh0bSI6IkdFVCIsInV1aWQiOiI2YTgwMGNmYS03MmYzLTQxZGItYTE2Zi00NGQ1YjAxYzlhNGQifQ.Y8wMdUC36scGmCqKdvT-ZvFcGukswu3pnnIfxae5ZgyUIO1U6vRmun_3M3hbMMdlp7esU7n9EexeOoF4CJamzA',
          },
          httpsAgent: agent,
          proxy: false,
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
