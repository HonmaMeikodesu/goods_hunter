import { Inject, Provide } from "@midwayjs/decorator";
import { CipherPayload } from "../types";
import CipherServive from "./cipher";
import isValidUrl from "../utils/isValidUrl";
import { ReadStream } from "fs";
import errorCode from "../errorCode";
import { Context } from "egg";
import { ApiBase } from "../api/site/base";

@Provide()
export default class ProxyService {

    @Inject()
    apiBase: ApiBase;

    @Inject()
    cipher: CipherServive;

    @Inject()
    ctx: Context;

    async getImage(payload: CipherPayload) {
        const imageUrl = await this.cipher.decode(payload);

        if (!isValidUrl(imageUrl)) throw new Error(errorCode.proxyService.invalidImageUrl);
        this.ctx.res.setHeader("Content-Type", "image/webp");
        return this.apiBase.fetchThumbNail(imageUrl);
    }
}


