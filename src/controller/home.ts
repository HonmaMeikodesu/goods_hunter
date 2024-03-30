import { Controller, Get, Provide, Inject, Config } from "@midwayjs/decorator";
import { render } from "ejs";
import { indexPage } from "../template";
import { Context } from "egg";
import { CustomConfig } from "../config/config.default";

@Provide()
@Controller("/")
export class HomeController {
  @Inject()
  ctx: Context;

  @Config("serverInfo")
  serverInfo: CustomConfig["serverInfo"];


  @Get("/")
  async home() {
    const loginPage = render(indexPage, {
      serverHost: this.serverInfo.serverHost,
    });
    this.ctx.res.setHeader("Content-Type", "text/html");
    this.ctx.res.statusCode = 200;
    this.ctx.res.write(loginPage);
    this.ctx.res.end();
  }
}
