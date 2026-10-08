import { Config, Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { GoodsBreif, GoodsListResponse, YahooAuctionGoodsSearchCondition } from "./types";
import { JSDOM } from "jsdom";
import { cloneDeep } from "lodash";

const PAGE_SIZE = 50;

// opensearch uses generated CSS classes. Read semantic markup and the auction
// link's metadata instead; visible prices include tax, unlike tracking prices.
function parseOpenSearch(document: Document): GoodsBreif[] | undefined {
    const titles = [...document.querySelectorAll('[data-grid-item-title]')];
    if (!titles.length) return undefined;
    const goods: GoodsBreif[] = [];
    let searchCards = 0;
    for (const title of titles) {
        const link = title.closest('a');
        const card = title.closest('li');
        const metadata: Record<string, string> = {};
        (link?.getAttribute('data-cl-params') || '').split(';').forEach(part => {
            const colon = part.indexOf(':');
            if (colon > 0) metadata[part.slice(0, colon)] = part.slice(colon + 1);
        });
        if (metadata._cl_vmodule !== 'aal') continue; // Exclude shopping ads/recommendations.
        searchCards++;
        const url = new URL(link.getAttribute('href'), 'https://auctions.yahoo.co.jp');
        const id = /^(?:\/jp)?\/auction\/([a-zA-Z0-9]+)$/.exec(url.pathname)?.[1];
        if (!['auctions.yahoo.co.jp', 'page.auctions.yahoo.co.jp'].includes(url.hostname) || !id) continue;
        if (!card) throw new Error('Yahoo auction card markup is missing');
        const readPrice = (label: string) => {
            const row = [...link.querySelectorAll('p')].find(p => p.firstElementChild?.textContent?.trim() === label);
            const amount = row?.textContent?.trim().slice(label.length).match(/^\s*([\d,]+)\s*円/);
            return amount ? Number(amount[1].replace(/,/g, '')) : undefined;
        };
        const buyNowPrice = readPrice('即決');
        const currentPrice = readPrice('現在') ?? buyNowPrice;
        const name = title.textContent?.trim();
        const thumbImgUrl = card.querySelector('a[href] img')?.getAttribute('src');
        const endTime = Number(metadata.end) * 1000;
        const bidText = card.querySelector('[aria-label="入札件数"]')?.closest('p')?.textContent?.trim();
        const currentBidCount = bidText ? Number(bidText.replace(/,/g, '')) : 0;
        if (!name || !thumbImgUrl || !Number.isFinite(currentPrice) || !Number.isFinite(endTime) || endTime <= 0 || !Number.isFinite(currentBidCount)) {
            throw new Error(`Yahoo auction markup is incomplete: ${id}`);
        }
        goods.push({ id, name, thumbImgUrl, currentPrice, buyNowPrice, currentBidCount, endTime,
            isFreeShipping: metadata.fs === '1',
            isBrandNew: [...card.querySelectorAll('span')].some(span => span.textContent?.trim() === '未使用'),
        });
    }
    return searchCards ? goods : undefined;
}

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class YahooAuctionApi extends ApiBase {
    @Logger()
    logger: ILogger;

    @Config("yahooAuctionCookie")
    cookie: string;

    @Inject()
    alicloudApi: AliCloudApi;

    getParsedCookies() {
        return this.cookie ? this.cookie.split(";").map(c => {
            const [name, ...valueParts] = c.trim().split("=");
            return {
                name: name,
                value: valueParts.join("="),
                domain: "auctions.yahoo.co.jp",
                path: "/"
            };
        }).filter(c => c.name) : undefined;
    }

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

        const maxRetry = (epoch || 1) * 2;

        const parsedCookies = this.getParsedCookies();

        await Promise.all(yahooAuctionSearchUrls.map(async (yahooAuctionSearchUrl, idx) => {

            this.logger.info(`requesting to ${yahooAuctionSearchUrl}..., currentPage: ${idx}`);

            const response = await this.alicloudApi.fetchHtmlViaServerless(yahooAuctionSearchUrl.toString(), "/jp/auction/", parsedCookies, 30, maxRetry);
            if (!response.success || !response.content) throw new Error('Yahoo page fetch failed');
            const domStr = response.content;

            const dom = new JSDOM(domStr);

            try {
                const isResultEmpty = (dom.window.document.querySelector(".Result__body .Products .Notice") as HTMLDivElement)?.textContent?.includes("一致する商品はありません。キーワードの一部を利用した結果を表示しています");
                if (isResultEmpty) return;
                if ([...dom.window.document.querySelectorAll('p')].some(p => p.textContent?.replace(/\s+/g, '') === '条件に一致する商品は見つかりませんでした')) return;
                const openSearchGoods = parseOpenSearch(dom.window.document);
                if (openSearchGoods !== undefined) {
                    goodsList.push(...openSearchGoods);
                    return;
                }

                const goodListElements: HTMLLIElement[] = isResultEmpty ? [] : [ ...dom.window.document.querySelectorAll(".Result__body .Products__items .Product") ] as HTMLLIElement[];
                if (!goodListElements.length) throw new Error('Yahoo page has no recognizable items; empty or unfinished markup');

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
                        isBrandNew: !!isBrandNew
                    });
                })
            } finally {
                dom.window.close();
            }
        }));


        return [...new Map(goodsList.map(good => [good.id, good])).values()];

    }

    async checkCookieHeartBeat(): Promise<{ result: boolean; cookie: string }> {
        const userPageUrl = "https://auctions.yahoo.co.jp/user/jp/show/mystatus";

        const parsedCookies = this.getParsedCookies();

        const { content: domStr } = await this.alicloudApi.fetchHtmlViaServerless(userPageUrl, "#acMdStatus", parsedCookies, undefined, 3);

        const dom = new JSDOM(domStr);

        return {
            cookie: this.cookie,
            result: !!dom.window.document.querySelector("#acMdStatus")
        };
    }

    async fetchGoodDetail(searchOptions: any): Promise<any> {
        return Promise.resolve();
    }
}

