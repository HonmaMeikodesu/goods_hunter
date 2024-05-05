import { Config, Inject, Logger, Provide } from "@midwayjs/decorator";
import { ProxyGet } from "../../request";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { YahooAuctionGoodsSearchCondition } from "./types";

@Provide()
export class YahooAuctionApi extends ApiBase {
    @Inject("proxyGet")
    proxyGet: ProxyGet;

    @Logger()
    logger: ILogger;

    @Config("yahooAuctionCookie")
    cookie: string;

    async fetchGoodsList(options: YahooAuctionGoodsSearchCondition) {
        const yahooAuctionSearchUrl = "https://auctions.yahoo.co.jp/search/search";

        const { url } = options;


        await 
    }

    async getBidRecordList(auctionId: string) {

    }
}
