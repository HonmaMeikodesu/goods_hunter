import { Config, Inject, Logger, Provide, Scope, ScopeEnum } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { ApiBase } from "../base";
import { AliCloudApi } from "../../alicloud/index";
import { GoodsBreif, GoodsListResponse, YahooAuctionGoodsSearchCondition } from "./types";
import { JSDOM } from "jsdom";
import { cloneDeep } from "lodash";
import { readYahooCookies, YahooSessionConfig, YahooSessionError, yahooPageNeedsLogin, isYahooMyPage, DEFAULT_YAHOO_AUTH_SELECTOR } from "./session";
import { parseSearchPage, SearchPageRules } from "../searchPage";
import { SearchScanError } from "../searchScan";

const PAGE_SIZE = 50;
const legacyCard = ".Result__body .Products__items .Product";
const searchPage: SearchPageRules = {
    queryKeys: ["p", "auccat", "b", "n", "s1", "o1"],
    queryDefaults: { b: "1", n: String(PAGE_SIZE) },
    itemSelector: `a[href*="/auction/"][data-cl-params*="_cl_vmodule:aal"] [data-grid-item-title], ${legacyCard}`,
    emptySelector: ".Result__body .Products .Notice, .Result__body p, main p, main h2, [role=main] p",
    emptyTexts: ["条件に一致する商品は見つかりませんでした", "一致する商品はありません。キーワードの一部を利用した結果を表示しています"],
};

// opensearch uses generated CSS classes. Read semantic markup and the auction
// link's metadata instead; visible prices include tax, unlike tracking prices.
function parseOpenSearch(titles: Element[]): GoodsBreif[] {
    const goods: GoodsBreif[] = [];
    for (const title of titles) {
        const link = title.closest('a');
        const card = title.closest('li');
        const metadata: Record<string, string> = {};
        (link?.getAttribute('data-cl-params') || '').split(';').forEach(part => {
            const colon = part.indexOf(':');
            if (colon > 0) metadata[part.slice(0, colon)] = part.slice(colon + 1);
        });
        if (metadata._cl_vmodule !== 'aal') continue; // Exclude shopping ads/recommendations.
        let url: URL;
        try { url = new URL(link.getAttribute('href'), 'https://auctions.yahoo.co.jp'); }
        catch { throw new SearchScanError("INVALID_ITEMS", "Yahoo auction card URL is invalid"); }
        const id = /^(?:\/jp)?\/auction\/([a-zA-Z0-9]+)$/.exec(url.pathname)?.[1];
        if (!['auctions.yahoo.co.jp', 'page.auctions.yahoo.co.jp'].includes(url.hostname) || !id || !card) {
            throw new SearchScanError("INVALID_ITEMS", "Yahoo auction card markup is invalid");
        }
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
            throw new SearchScanError("INVALID_ITEMS", "Yahoo auction markup is incomplete");
        }
        goods.push({ id, name, thumbImgUrl, currentPrice, buyNowPrice, currentBidCount, endTime,
            isFreeShipping: metadata.fs === '1',
            isBrandNew: [...card.querySelectorAll('span')].some(span => span.textContent?.trim() === '未使用'),
        });
    }
    return goods;
}

function parseLegacyCard(card: Element): GoodsBreif {
    const detail = card.querySelector<HTMLElement>(".Product__detail .Product__bonus")?.dataset;
    const title = card.querySelector<HTMLAnchorElement>(".Product__detail .Product__titleLink")?.dataset;
    const id = title?.auctionId;
    const name = title?.auctionTitle;
    const currentPrice = parseInt(title?.auctionPrice, 10);
    const endTime = parseInt(detail?.auctionEndtime, 10) * 1000;
    const currentBidCount = parseInt(card.querySelector(".Product__bidWrap .Product__bid")?.textContent, 10);
    if (!id || !/^[a-zA-Z0-9]+$/.test(id) || !name?.trim() ||
        !Number.isFinite(currentPrice) || !Number.isFinite(endTime) || endTime <= 0 || !Number.isFinite(currentBidCount)) {
        throw new SearchScanError("INVALID_ITEMS", "Yahoo auction markup is incomplete");
    }
    return {
        id, name, currentPrice, endTime, currentBidCount,
        thumbImgUrl: title.auctionImg,
        buyNowPrice: parseInt(detail?.auctionBuynowprice, 10) || undefined,
        isFreeShipping: title.auctionIsfreeshipping === "1",
        isBrandNew: !!card.querySelector(".Product__icons .Product__icon--unused"),
    };
}

@Provide()
@Scope(ScopeEnum.Request, { allowDowngrade: true })
export class YahooAuctionApi extends ApiBase {
    @Logger()
    logger: ILogger;

    @Config("yahooAuctionCookie")
    cookie: string;

    @Config("yahooSession")
    sessionConfig: YahooSessionConfig;

    @Inject()
    alicloudApi: AliCloudApi;

    getParsedCookies() {
        return readYahooCookies(this.sessionConfig, this.cookie);
    }

    async fetchGoodsList(options: YahooAuctionGoodsSearchCondition): Promise<GoodsListResponse> {

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

        const pages = await Promise.all(yahooAuctionSearchUrls.map(async yahooAuctionSearchUrl => {
            const targetUrl = yahooAuctionSearchUrl.toString();
            const response = await this.alicloudApi.fetchHtmlViaServerless(
                targetUrl, "/jp/auction/", parsedCookies, 30, maxRetry, undefined, searchPage
            );
            if (yahooPageNeedsLogin(response?.url)) throw new YahooSessionError("FC_NEEDS_LOGIN");
            return parseSearchPage(response, targetUrl, searchPage, (_document, state, cards) => {
                if (state === "empty") return [];
                const openSearchGoods = parseOpenSearch(cards.filter(card => card.hasAttribute("data-grid-item-title")));
                if (openSearchGoods.length) return openSearchGoods;
                const legacyGoods = cards.filter(card => card.matches(legacyCard)).map(parseLegacyCard);
                if (!legacyGoods.length) throw new SearchScanError("INVALID_ITEMS");
                return legacyGoods;
            });
        }));

        const goods = ([] as GoodsBreif[]).concat(...pages);
        return [...new Map(goods.map(good => [good.id, good])).values()];

    }

    async checkCookieHeartBeat(): Promise<{ result: boolean; reason?: string }> {
        try {
            const parsedCookies = this.getParsedCookies();
            if (!parsedCookies?.length) return { result: false, reason: "COOKIES_MISSING" };
            // FC assertions are literal text, not CSS selectors. Check the DOM here.
            const response = await this.alicloudApi.fetchHtmlViaServerless("https://auctions.yahoo.co.jp/my", undefined, parsedCookies, undefined, 1);
            if (yahooPageNeedsLogin(response.url)) return { result: false, reason: "FC_NEEDS_LOGIN" };
            if (!response.success || !response.content || !isYahooMyPage(response.url)) return { result: false, reason: "FC_CHECK_FAILED" };
            const dom = new JSDOM(response.content);
            try {
                const result = !!dom.window.document.querySelector(this.sessionConfig?.authenticatedSelector || DEFAULT_YAHOO_AUTH_SELECTOR);
                return { result, reason: result ? undefined : "FC_AUTH_UNVERIFIED" };
            } finally { dom.window.close(); }
        } catch (error) {
            return { result: false, reason: error instanceof YahooSessionError ? error.code : "FC_CHECK_FAILED" };
        }
    }

    async fetchGoodDetail(searchOptions: any): Promise<any> {
        return Promise.resolve();
    }
}
