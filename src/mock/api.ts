import { App, IMidwayApplication, Inject, ISimulation, MidwayMockService, Mock } from "@midwayjs/core";
import { MercariApi } from "../api/site/mercari";
import { YahooAuctionApi } from "../api/site/yahoo";
import { SurugayaApi } from "../api/site/surugaya";
import { MandarakeApi } from "../api/site/mandarake";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { EmailService } from "../service/email";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import { v4 } from "uuid";
import { random, uniq } from "lodash";
@Mock()
export class ApiMock implements ISimulation {
    @App()
    app: IMidwayApplication;

    @Inject()
    mockService: MidwayMockService;

    @Inject()
    yahooAuctionApi: YahooAuctionApi;

    @Inject()
    mercariApi: MercariApi;

    @Inject()
    surugayaApi: SurugayaApi;

    @Inject()
    mandarakeApi: MandarakeApi;

    async setup(): Promise<void> {

        const originMercariFetchGoodsList = this.mercariApi.fetchGoodsList;
        const originMercariFetchGoodDetail = this.mercariApi.fetchGoodDetail;

        this.mercariApi.alicloudApi = {
            alicloudConfig: {
                accessKeyId: "",
                accessKeySecret: "",
                url: "",
            },
            logger: {} as any,
            fetchHtmlViaServerless: async (targetUrl: string, pageLoadedAssertion?: string, cookies?: Array<{ name: string; value: string; domain: string; path: string }>, maxAssertionWaitSeconds?: number, maxRetries?: number) => {
                if (targetUrl.includes("items/get")) {
                    const fileContent = await readFile(resolve(__dirname, "../api/site/mercari/mock/goodDetail.html"));
                    const content = fileContent.toString();
                    return {
                        success: true,
                        url: targetUrl,
                        title: "Mock Title",
                        content: content,
                        content_length: content.length,
                        cookies_count: 0,
                        cookies: [],
                        cloudflare_detected: false,
                        retry_count: 1
                    } as any;
                }
                return {
                    success: true,
                    url: targetUrl,
                    title: "",
                    content: "",
                    content_length: 0,
                    cookies_count: 0,
                    cookies: [],
                    cloudflare_detected: false,
                    retry_count: 1
                } as any;
            }
        }


        this.mercariApi.fetchGoodDetail = async function (...args: any[]) {
            const res: ReturnType<typeof originMercariFetchGoodDetail> = originMercariFetchGoodDetail.call(this, ...args);
            const data = await res;
            const nextPrice = Math.round(Math.random() * 10000);
            return {
                ...data,
                price: nextPrice
            }
        }

        this.mercariApi.fetchGoodsList = async function (...args: any[]) {
            const res: ReturnType<typeof originMercariFetchGoodsList> = originMercariFetchGoodsList.call(this, ...args);
            const data = await res;
            let time_cursor = moment();
            const items = (data.items || []).map((item) => {
                const updated = Math.round(time_cursor.valueOf() / 1000).toString();
                time_cursor = time_cursor.subtract({ second: 10 });
                return { ...item, updated }
            });
            return {
                ...data,
                items
            }
        }

        const originYahooAuctionFetchGoodsList = this.yahooAuctionApi.fetchGoodsList;

        this.yahooAuctionApi.fetchGoodsList = async function (...args: any) {
            const res: ReturnType<typeof originYahooAuctionFetchGoodsList> = originYahooAuctionFetchGoodsList.call(this, ...args);
            const data = await res;
            return data.map((item) => ({ ...item, id: v4() }));
        }

        const originSurugayaFetchGoodsList = this.surugayaApi.fetchGoodsList;

        this.surugayaApi.fetchGoodsList = async function (...args: any) {
            const res: ReturnType<typeof originSurugayaFetchGoodsList> = originSurugayaFetchGoodsList.call(this, ...args);
            const data = await res;
            return data.map((item) => ({ ...item, id: `https://www.suruga-ya.jp/product/detail/${v4()}` }));
        };

        const originMandarakeFetchGoodsList = this.mandarakeApi.fetchGoodsList;

        this.mandarakeApi.alicloudApi = {
            alicloudConfig: {
                accessKeyId: "",
                accessKeySecret: "",
                url: "",
            },
            logger: {} as any,
            fetchHtmlViaServerless: async (targetUrl: string) => {
                if (targetUrl.includes("mandarake")) {
                    const fileContent = await readFile(resolve(__dirname, "../api/site/mandarake/mock/goodsList.html"));
                    const content = fileContent.toString();
                    return {
                        success: true,
                        url: targetUrl,
                        title: "Mock Mandarake",
                        content: content,
                        content_length: content.length,
                        cookies_count: 0,
                        cookies: [],
                        cloudflare_detected: false,
                        retry_count: 1
                    } as any;
                }
                return { success: false } as any;
            }
        };

        this.mandarakeApi.fetchGoodsList = async function (...args: any) {
            const res: ReturnType<typeof originMandarakeFetchGoodsList> = originMandarakeFetchGoodsList.call(this, ...args);
            const data = await res;
            return {
                ...data,
                items: (data.items || []).map(item => ({ ...item, id: v4() }))
            };
        };

        this.mockService.mockClassProperty(EmailService, "sendEmail", (msg: Mail.Options) => {
            process.stdout.write(JSON.stringify(msg));
        })
    }

    enableCondition(): boolean | Promise<boolean> {
        return !!process.env.enableMock
    }
}


