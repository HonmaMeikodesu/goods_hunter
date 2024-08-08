import { App, IMidwayApplication, Inject, ISimulation, MidwayMockService, Mock } from "@midwayjs/core";
import { MercariApi } from "../api/site/mercari";
import { YahooAuctionApi } from "../api/site/yahoo";
import { SurugayaApi } from "../api/site/surugaya";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { ProxyGet, ProxyPost } from "../api/request";
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

    async setup(): Promise<void> {

        const originMercariFetchGoodsList = this.mercariApi.fetchGoodsList;

        this.mercariApi.proxyPost = async (url: URL | string) => {
            if (url.toString().includes("entities:search")) {
                const fileContent = await readFile(resolve(__dirname, "../api/site/mercari/mock/goodsList.json"));
                return JSON.parse(fileContent.toString());
            }
        };

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

        this.yahooAuctionApi.proxyGet = async (url: URL | string) => {
            if (url.toString().includes("search")) {
                const fileContent = await readFile(resolve(__dirname, "../api/site/yahoo/mock/goodsList.html"));
                return fileContent.toString() as any;
            }
        }

        this.yahooAuctionApi.fetchGoodsList = async function(...args: any) {
            const res: ReturnType<typeof originYahooAuctionFetchGoodsList> = originYahooAuctionFetchGoodsList.call(this, ...args);
            const data = await res;
            return data.map((item) => ({ ...item, id: v4() }));
        }

        const originSurugayaFetchGoodsList = this.surugayaApi.fetchGoodsList;

        this.surugayaApi.proxyGet = async (url: URL | string) => {
            if (url.toString().includes("search")) {
                const fileContent = await readFile(resolve(__dirname, "../api/site/surugaya/mock/goodsList.html"));
                return fileContent.toString() as any;
            }
        };

        this.surugayaApi.fetchGoodsList = async function(...args: any) {
            const res: ReturnType<typeof originSurugayaFetchGoodsList> = originSurugayaFetchGoodsList.call(this, ...args);
            const data = await res;
            return data.map((item) => ({ ...item, id: `https://www.suruga-ya.jp/product/detail/${v4()}` }));
        };

        this.mockService.mockClassProperty(EmailService, "sendEmail", (msg: Mail.Options) => {
            console.log(msg);
        })
    }

    enableCondition(): boolean | Promise<boolean> {
        return !!process.env.enableMock
    }
}


