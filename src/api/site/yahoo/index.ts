import { Config, Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyGet } from "../../request";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { GoodsBreif, GoodsListResponse, YahooAuctionGoodsSearchCondition } from "./types";
import { JSDOM } from "jsdom";
import { cloneDeep } from "lodash";

const PAGE_SIZE = 60;

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

        const { keyword, category, epoch } = options;

        const initSearchOptions: Array<[string, string]> = [
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
                PAGE_SIZE.toString()
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
            initSearchOptions.push([ "auccat", category ]);
        }

        const yahooAuctionSearchUrls: URL[] = new Array(epoch || 1).fill(null).map(() => new URL("https://auctions.yahoo.co.jp/search/search"));

        const searchOptions = new Array(epoch || 1).fill(null).map((__, idx) => {
            const next = cloneDeep(initSearchOptions);
            const item = next.find((item) => item[0] === "b");
            item[1] = ( PAGE_SIZE * idx + 1 ).toString();
            return next;
        });

        searchOptions.forEach((pageSearchOptions, idx) => {
            pageSearchOptions.forEach((item => {
                yahooAuctionSearchUrls[idx].searchParams.append(item[0], item[1]);
            }))
        })

        await Promise.all(yahooAuctionSearchUrls.map(async (yahooAuctionSearchUrl, idx) => {

            this.logger.info(`requesting to ${yahooAuctionSearchUrl}..., currentPage: ${idx}`);

            const domStr = await this.proxyGet<string>(yahooAuctionSearchUrl, {
                "Cookie": this.cookie
            });


            const dom = new JSDOM(domStr);

            const goodListElements: NodeListOf<HTMLLIElement> = dom.window.document.querySelectorAll(".Result__body .Products__items .Product");

            goodListElements.forEach((good) => {

                // TODO don't use data here
                const { auctionBuynowprice, auctionEndtime } = (good.querySelector(".Product__detail .Product__bonus") as HTMLDivElement)?.dataset as {
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

                const { auctionImg, auctionIsfreeshipping, auctionTitle, auctionId, auctionPrice } = (good.querySelector(".Product__detail .Product__titleLink") as HTMLAnchorElement)?.dataset as {
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

                const currentBidCount = good.querySelector(".Product__detail .Product__otherInfo .Product__bidWrap .Product__bid")?.textContent;

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
        }));


        return goodsList;

    }

    async checkCookieHeartBeat(): Promise<{ result: boolean; cookie: string }> {
        const userPageUrl = "https://auctions.yahoo.co.jp/user/jp/show/mystatus";

        const domStr = await this.proxyGet<string>(
            userPageUrl,
            {
                "Cookie": this.cookie
            });

        const dom = new JSDOM(domStr);

        return {
            cookie: this.cookie,
            result: !!dom.window.document.querySelector("#acMdStatus")
        };
    }

}



