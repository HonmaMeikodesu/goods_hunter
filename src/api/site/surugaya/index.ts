import { Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { GoodsBreif, GoodsListResponse, SurugayaGoodsSearchCondition } from "./types";
import { JSDOM } from "jsdom";
import { cloneDeep } from "lodash";

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class SurugayaApi extends ApiBase {

    @Logger()
    logger: ILogger;

    @Inject()
    alicloudApi: AliCloudApi;

    async fetchGoodsList(options: SurugayaGoodsSearchCondition): Promise<GoodsListResponse> {

        const goodsList: GoodsBreif[] = [];

        const { keyword, category, epoch, adultMode, adultOnly } = options;

        // https://www.suruga-ya.jp/search?category=110000&search_word=myKw&adult_s=3&inStock=Off
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

        if (adultOnly && adultMode) {
            initSearchOptions.push(["adult_s", "3"]);
        }

        const surugayaSearchUrls: URL[] = new Array(epoch || 1).fill(null).map(() => new URL("https://www.suruga-ya.jp/search"));

        const searchOptions = new Array(epoch || 1).fill(null).map((__, idx) => {
            const next = cloneDeep(initSearchOptions);
            const pageIndex = idx + 1;
            if (pageIndex > 1) {
                next.push(["page", pageIndex.toString()]);
            }
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

            let domStr: string;

            const resp = await this.alicloudApi.fetchHtmlViaServerless(surugayaSearchUrl.toString(), "search_result", [
                {
                    name: "safe_search_option",
                    value: "3",
                    domain: "www.suruga-ya.jp",
                    path: "/"
                },
                {
                    name: "safe_search_expired",
                    value: "3",
                    domain: "www.suruga-ya.jp",
                    path: "/"
                },
            ], undefined, maxRetry);
            domStr = resp.content;

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
                    marketPlacePrice
                });
            })
        }));

        return goodsList;

    }

}





