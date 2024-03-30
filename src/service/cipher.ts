import { Config, Init, Inject, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { CustomConfig } from "../config/config.default";
import { v4 } from "uuid";
import errorCode from "../errorCode";
import { RedisService } from "@midwayjs/redis";
import CONST from "../const";
import { CipherPayload as Payload } from "../types"

@Provide()
@Scope(ScopeEnum["Singleton"])
export default class CipherServive {

    @Config("secretKeyJwkData")
    secretKeyJwkData: CustomConfig["secretKeyJwkData"];

    private secretKey: CryptoKey;

    private subtle = (new Crypto).subtle;

    @Inject("redis:redisService")
    redisClient: RedisService;

    @Init()
    async init() {
        this.secretKey = await this.subtle.importKey("jwk", this.secretKeyJwkData, "AES-GCM", false ,[ "encrypt", "decrypt" ]);
    }

    private generateIv() {
        const iv = new Uint8Array(new Array(12).fill(0));
        const randomStr = v4();
        for (let i = 0; i < iv.length; i++) {
            iv[i] = randomStr.charCodeAt(i);
        }
        return iv;
    }

    private convertBufferToHexString(buffer: ArrayBuffer): string {
        const bufferView = new Uint8Array(buffer);
        return Array.from(bufferView).map(item => item.toString(16).padStart(2, "0")).join("");
    }

    private convertHexStringToBuffer(hexString: string): ArrayBuffer {
        const buffetView = new Uint8Array(new Array(hexString.length / 2).fill(0));
        for (let i = 0; i < hexString.length; i += 2) {
            const hexBlock = hexString[i] + hexString[i + 1];
            buffetView[i / 2] = Number.parseInt(hexBlock, 16);
        }
        return buffetView.buffer;
    }

    async addMessageToConsume(message: string): Promise<void> {
        await this.redisClient.sadd(CONST.CIPHERTRASHBIN, message);
    }

    async checkIfMessageConsumed(message: string): Promise<void> {
        const consumed = await this.redisClient.sismember(CONST.CIPHERTRASHBIN, message);
        if (consumed) throw new Error(errorCode.cipherService.messageConsumed);
    }

    async encode(message: string): Promise<Payload> {
        const iv = this.generateIv();

        const te = new TextEncoder();

        const messageBuffer = te.encode(message);

        const encoded = await this.subtle.encrypt({ name: "AES-GCM", iv }, this.secretKey, messageBuffer);

        const messageHexStr = this.convertBufferToHexString(encoded);

        const ivHexStr = this.convertBufferToHexString(iv.buffer)

        const payloadData: Payload["data"] = { iv: ivHexStr, message: messageHexStr };

        const digest = await this.subtle.digest("SHA-256", te.encode(JSON.stringify(payloadData)));

        return {
            digest: this.convertBufferToHexString(digest),
            data: payloadData
        }
    }

    async decode(payload: Payload ): Promise<string> {

        const { data, digest } = payload || {};

        const te = new TextEncoder();

        const td = new TextDecoder();

        const digestBuffer = await this.subtle.digest("SHA-256", te.encode(JSON.stringify(data)));

        if (this.convertBufferToHexString(digestBuffer) !== digest) {
            throw new Error(errorCode.cipherService.messageCorrupted);
        }

        const { message, iv } = data;

        const msgBuffer = this.convertHexStringToBuffer(message);

        const ivBuffer = this.convertHexStringToBuffer(iv);

        const decoded = await this.subtle.decrypt({ name: "AES-GCM", iv: ivBuffer }, this.secretKey, msgBuffer);

        return td.decode(decoded);
    }
}
