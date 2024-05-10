import { Controller, Get, Inject, Provide, Query } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import ProxyService from "../service/proxy";

@Provide()
@Controller("proxy")
export default class ProxyController {

    @Inject()
    proxy: ProxyService;

    @Get("/getImage")
    async getImage(@Query("iv") iv: string, @Query("message") message: string, @Query("digest") digest: string) {
        if (!iv || !message || !digest) throw new Error(errorCode.common.invalidRequestBody);
        return await this.proxy.getImage({ digest, data: { message, iv }});
    }

}

