import { Controller, Get, Provide, Inject } from "@midwayjs/decorator";
import { render } from "ejs";
import { indexPage } from "../template";
import server from "../private/server";
import { Context } from "egg";

@Provide()
@Controller("/")
export class HomeController {
  @Inject()
  ctx: Context;

  @Get("/")
  async home() {
    const loginPage = render(indexPage, {
      serverHost: server.serverHost,
    });
    this.ctx.res.setHeader("Content-Type", "text/html");
    this.ctx.res.statusCode = 200;
    this.ctx.res.write(loginPage);
    this.ctx.res.end();
  }
}
