import { Body, Controller, Get, Inject, Post, Provide, Query } from "@midwayjs/decorator";
import { MercariApi } from "../api/site/mercari";
import CONST from "../const";
import { CipherPayload } from "../types";
import errorCode from "../errorCode";
import ProxyService from "../service/proxy";

@Provide()
@Controller("proxy")
export default class ProxyController {

    @Inject()
    proxy: ProxyService;

    @Get("/getMercariImage")
    async getMercariImage(@Query("iv") iv: string, @Query("message") message: string, @Query("digest") digest: string) {
        if (!iv || !message || !digest) throw new Error(errorCode.common.invalidRequestBody);
        return await this.proxy.getMercariImage({ digest, data: { message, iv }});
    }

}
