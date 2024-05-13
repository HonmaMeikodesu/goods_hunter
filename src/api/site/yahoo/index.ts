import { Config, Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyGet } from "../../request";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { GoodsBreif, GoodsListResponse, YahooAuctionGoodsSearchCondition } from "./types";
import { JSDOM } from "jsdom";

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class YahooAuctionApi extends ApiBase {
    @Inject("proxyGet")
    proxyGet: ProxyGet;

    @Logger()
    logger: ILogger;

    @Config("yahooAuctionCookie")
    cookie: string;

    async fetchGoodsList(options: YahooAuctionGoodsSearchCondition): Promise<GoodsListResponse> {

        const goodsList: GoodsBreif[] = [];

        const { keyword, category } = options;

        const yahooAuctionSearchUrl = new URL("https://auctions.yahoo.co.jp/search/search");

        const searchOptions: Array<[string, string]> = [
            [
                "p",
                keyword
            ],
            [
                "va",
                keyword
            ],
            [
                "is_postage_mode",
                "1"
            ],
            [
                "dest_pref_code",
                "13"
            ],
            [
                "exflg",
                "1"
            ],
            [
                "b",
                "1"
            ],
            [
                "n",
                "50"
            ],
            [
                "s1",
                "new"
            ],
            [
                "o1",
                "d"
            ],
            [
                "rc_ng",
                "1"
            ]
        ];

        if (category) {
            searchOptions.push([ "auccat", category ]);
        }

        searchOptions.forEach((item => {
            yahooAuctionSearchUrl.searchParams.append(item[0], item[1]);
        }))

        const domStr = await this.proxyGet<string>(yahooAuctionSearchUrl);

        const dom = new JSDOM(domStr);

        const goodListElements: NodeListOf<HTMLLIElement> = dom.window.document.querySelectorAll(".Result__body .Products__items .Product");

        goodListElements.forEach((good) => {
            const { auctionId, auctionBuynowprice, auctionEndtime, auctionPrice } = ( good.querySelector(".Product__detail .Product__bonus") as HTMLDivElement )?.dataset as {
                auctionBuynowprice: string;
                auctionCaneasypayment: string;
                auctionCategoryidpath: string;
                auctionEndtime: string;
                auctionId: string;
                auctionIsshoppingitem: string;
                auctionPrice: string;
                auctionSellerid: string;
                auctionStartprice: string
            };

            const { auctionImg, auctionIsfreeshipping, auctionTitle } = ( good.querySelector(".Product__detail .Product__titleLink") as HTMLAnchorElement )?.dataset as {
                auctionCategory: string;
                auctionId: string;
                auctionImg: string;
                auctionIsflea: string;
                auctionIsfreeshipping: string;
                auctionPrice: string;
                auctionTitle: string;
                clParams: string;
                cl_cl_index: string;
            };

            const currentBidCount = good.querySelector(".Product__detail .Product__otherInfo .Product__bidWrap .Product__bid").textContent;

            const isBrandNew = good.querySelector(".Product__detail .Product__icons .Product__icon--unused");

            goodsList.push({
                id: auctionId,
                name: auctionTitle,
                thumbImgUrl: auctionImg,
                currentPrice: parseInt(auctionPrice),
                buyNowPrice: parseInt(auctionBuynowprice) || undefined,
                currentBidCount: parseInt(currentBidCount),
                endTime: parseInt(auctionEndtime) * 1000,
                isFreeShipping: auctionIsfreeshipping === "1",
                isBrandNew: !!isBrandNew,
                thumbnailData: null,
                ignoreInstruction: null
            });
        })

        return goodsList;

    }

}



