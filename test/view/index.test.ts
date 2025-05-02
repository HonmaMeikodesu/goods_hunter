import { createApp, createHttpRequest, close } from "@midwayjs/mock";
import { Framework } from "@midwayjs/web";
import { Application } from "egg";
import { EmailService } from "../../src/service/email";
import { readFileSync } from "fs";
import path from "path";
import { CustomConfig } from "../../src/config/config.default";
import {mercariGoodsDetail } from "../../src/template";
import { GoodsDetailData as MercariGoodsDetailData } from "../../src/api/site/mercari/types";
import CipherServive from "../../src/service/cipher";
import { render } from "ejs";
import { first } from "lodash";

describe('view/*.ejs', () => {

    let app: Application;

    let emailService: EmailService;

    let cipher: CipherServive;
  
    beforeAll(async () => {
      // create app
      app = await createApp<Framework>();
      emailService = await app.getApplicationContext().getAsync(EmailService);
      cipher = await app.getApplicationContext().getAsync(CipherServive);
    });
  
    afterAll(async () => {
      await close(app);
    });
  
  it('should send user mercari goodDetail content', async () => {

    const serverInfo: CustomConfig["serverInfo"] = app.getConfig("serverInfo");

    const goodDetailDemo: MercariGoodsDetailData = JSON.parse(readFileSync(
      path.join(__dirname, "./fixtures/mercariGoodDetail.json"),
      { encoding: "utf-8" }
    )).data;

    debugger;

    const { id, thumbnails, price, name, status } = goodDetailDemo;

    const htmlPage = render(mercariGoodsDetail, {
      data: {
        id,
        thumbnailData: await cipher.encode(first(thumbnails)!),
        status,
        name,
        oldPrice: 0,
        newPrice: price
      },
      serverHost: serverInfo.serverHost,
    })

    console.log(htmlPage);

    expect(true).toBe(true);
  });
  
  });
