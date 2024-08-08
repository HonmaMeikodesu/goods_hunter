import { Config, Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ProxyGet } from "../../request";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { GoodsBreif, GoodsListResponse, SurugayaGoodsSearchCondition } from "./types";
import { JSDOM } from "jsdom";
import { cloneDeep, toNumber } from "lodash";

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class SurugayaApi extends ApiBase {
    @Inject("proxyGet")
    proxyGet: ProxyGet;

    @Logger()
    logger: ILogger;

    async fetchGoodsList(options: SurugayaGoodsSearchCondition): Promise<GoodsListResponse> {

        const goodsList: GoodsBreif[] = [];

        const { keyword, category, epoch, adultMode } = options;

        const initSearchOptions: Array<[string, string]> = [
            [
                "category",
                category || ""
            ],
            [
                "search_word",
                keyword
            ],
            [
                "is_marketplace",
                "0"
            ],
            [
                "rankBy",
                "modificationTime:descending"
            ]
        ];

        const surugayaSearchUrls: URL[] = new Array(epoch || 1).fill(null).map(() => new URL("https://www.suruga-ya.jp/search"));

        const searchOptions = new Array(epoch || 1).fill(null).map((__, idx) => {
            const next = cloneDeep(initSearchOptions);
            next.push(["page", idx.toString()]);
            return next;
        });

        searchOptions.forEach((pageSearchOptions, idx) => {
            pageSearchOptions.forEach((item => {
                surugayaSearchUrls[idx].searchParams.append(item[0], item[1]);
            }))
        })

        const maxRetry = (epoch || 1) * 2;

        await Promise.all(surugayaSearchUrls.map(async (surugayaSearchUrl, idx) => {

            this.logger.info(`requesting to ${surugayaSearchUrl}..., currentPage: ${idx}`);

            const domStr = await this.proxyGet<string>(surugayaSearchUrl, {
                "Cookie": adultMode ? "safe_search_option=3; safe_search_expired=3;" : undefined
            }, { maxRetry });

            const dom = new JSDOM(domStr);

            const goodListElements: NodeListOf<HTMLLIElement> = dom.window.document.querySelectorAll("#search_result .item_box .item");

            goodListElements.forEach((good) => {
                const thumbImgUrl = ( good.querySelector(".thum img") as HTMLImageElement )?.src;
                const detailUrl = ( good.querySelector(".item_detail .title > a") as HTMLAnchorElement )?.href;
                const title = good.querySelector(".item_detail .product-name")?.textContent;
                const price = good.querySelector(".item_price .price_teika strong")?.textContent;
                const marketPlacePrice = good.querySelector(".item_price .mgnB5.mgnT5 strong")?.textContent;
                goodsList.push({
                    id: detailUrl,
                    name: title,
                    thumbImgUrl,
                    price,
                    marketPlacePrice,
                    thumbnailData: null,
                    ignoreInstruction: null
                });
            })
        }));

        return goodsList;

    }

}




