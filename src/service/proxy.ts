import { Inject, Provide } from "@midwayjs/decorator";
import { MercariApi } from "../api/site/mercari";
import { CipherPayload } from "../types";
import CipherServive from "./cipher";
import isValidUrl from "../utils/isValidUrl";
import { ReadStream } from "fs";
import errorCode from "../errorCode";
import { Context } from "egg";

@Provide()
export default class ProxyService {

    @Inject()
    mercariApi: MercariApi;

    @Inject()
    cipher: CipherServive;

    @Inject()
    ctx: Context;

    async getMercariImage(payload: CipherPayload): Promise<string> {
        const imageUrl = await this.cipher.decode(payload);

        if (!isValidUrl(imageUrl)) throw new Error(errorCode.proxyService.invalidImageUrl);
        this.ctx.res.setHeader("Content-Type", "image/jpg");
        return this.mercariApi.fetchThumbNailsAndConvertToBase64(imageUrl);
    }
}

