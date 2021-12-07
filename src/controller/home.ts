import { Controller, Get, Inject, Provide } from '@midwayjs/decorator';
import { ProxyGet } from '../api/request';

@Provide()
@Controller('/')
export class HomeController {

  @Inject("proxyGet")
  proxyGet: ProxyGet;

  @Get('/')
  async home() {
    await this.proxyGet("https://api.mercari.jp/search_index/search?sort=score&order=desc&limit=120&keyword=anohana&status=on_sale&page=0", {
      "X-Platform": "Web",
      "DPoP": "eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7ImNydiI6IlAtMjU2Iiwia3R5IjoiRUMiLCJ4IjoiZlRHTFpZbFpGemkteHF1U0VyZWNwQTFxSklPRENRN1F5bV91VjNZY0JIbyIsInkiOiJmbkdMMk1XcGVFaWQtUWdmUldWdnJtVXljc3piV1pTLWI5eERJc0dpNW1BIn19.eyJpYXQiOjE2Mzg4OTQzOTAsImp0aSI6ImU1YWYwNGJlLWNmYWUtNDcxMi04NmNjLWQyNTQwMDQ5ODAxOSIsImh0dSI6Imh0dHBzOi8vYXBpLm1lcmNhcmkuanAvc2VhcmNoX2luZGV4L3NlYXJjaCIsImh0bSI6IkdFVCIsInV1aWQiOiI2YTgwMGNmYS03MmYzLTQxZGItYTE2Zi00NGQ1YjAxYzlhNGQifQ.5M0y5JF9GoiWXcAnFcoSoEIeq1cAfvzrQm-uJarc0yAMPbZTUdLpY_BS8DaofbZnHIl4vFUnCno_OVipBqLRDA"
    }).then((data) => console.log(data));

    return 'Hello Midwayjs!';
  }
}
