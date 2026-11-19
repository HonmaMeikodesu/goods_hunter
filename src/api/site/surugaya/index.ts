import { Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { GoodsBreif, GoodsListResponse, SurugayaGoodsSearchCondition } from "./types";
import { cloneDeep } from "lodash";
import { parseSearchPage, SearchPageRules } from "../searchPage";
import { SearchScanError } from "../searchScan";

const searchPage: SearchPageRules = {
    queryKeys: ["search_word", "category", "page", "adult_s", "is_marketplace", "rankBy"],
    queryDefaults: { page: "1", adult_s: "2" },
    itemSelector: "#search_result .item_box .item",
    emptySelector: "#search_header .hit, #search_result > p, #search_result > h2, #search_result > .notice",
    emptyTexts: ["該当件数:0件", "該当件数:0件中", "該当する商品がありません", "該当する商品はありません", "該当する商品が見つかりませんでした"],
};

export const SURUGAYA_FETCH_COOKIES = [
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
];

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class SurugayaApi extends ApiBase {

    @Logger()
    logger: ILogger;

    @Inject()
    alicloudApi: AliCloudApi;

    async fetchGoodsList(options: SurugayaGoodsSearchCondition): Promise<GoodsListResponse> {

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

        const pages = await Promise.all(surugayaSearchUrls.map(async surugayaSearchUrl => {
            const targetUrl = surugayaSearchUrl.toString();
            const resp = await this.alicloudApi.fetchHtmlViaServerless(
                targetUrl,
                "search_result",
                SURUGAYA_FETCH_COOKIES,
                undefined,
                maxRetry,
                undefined,
                searchPage
            );
            return parseSearchPage(resp, targetUrl, searchPage, (_document, _state, cards): GoodsBreif[] =>
                cards.map(good => {
                    const detailUrl = good.querySelector(".item_detail .title > a")?.getAttribute("href");
                    const name = good.querySelector(".item_detail .product-name")?.textContent;
                    if (!detailUrl || !name?.trim() ||
                        !/^(?:https:\/\/www\.suruga-ya\.jp)?\/product\/detail\/[a-zA-Z0-9]+(?:[/?#]|$)/.test(detailUrl)) {
                        throw new SearchScanError("INVALID_ITEMS", "Surugaya product markup is incomplete");
                    }
                    return {
                        id: detailUrl,
                        name,
                        thumbImgUrl: (good.querySelector(".thum img") as HTMLImageElement)?.src,
                        price: good.querySelector(".item_price .price_teika strong")?.textContent,
                        marketPlacePrice: good.querySelector(".item_price .mgnB5.mgnT5 strong")?.textContent,
                    };
                }));
        }));

        return ([] as GoodsBreif[]).concat(...pages);

    }

}





