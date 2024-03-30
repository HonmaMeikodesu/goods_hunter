import { Inject } from "@midwayjs/decorator";
import { MercariApi } from "../api/site/mercari";
import { CipherPayload } from "../types";
import CipherServive from "./cipher";
import isValidUrl from "../utils/isValidUrl";
import { ReadStream } from "fs";
import errorCode from "../errorCode";

export default class ProxyService {

    @Inject()
    mercariApi: MercariApi;

    @Inject()
    cipher: CipherServive;

    async getMercariImage(payload: CipherPayload): Promise<ReadStream> {
        const imageUrl = await this.cipher.decode(payload);

        // TODO 域名检测
        if (!isValidUrl(imageUrl)) throw new Error(errorCode.proxyService.invalidImageUrl);
            return this.mercariApi.fetchThumbNail(imageUrl);
    }
}
