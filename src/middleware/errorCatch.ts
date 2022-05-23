import { Provide, Logger } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { IWebMiddleware, IMidwayWebNext } from "@midwayjs/web";
import { Context } from "egg";

@Provide()
export class ErrorCatchMiddleware implements IWebMiddleware {
  @Logger()
  logger: ILogger;

  resolve() {
    return async (ctx: Context, next: IMidwayWebNext) => {
      try {
        await next();
        ctx.res.statusCode = 200;
        ctx.body = {
          code: "200",
          data: ctx.body,
        };
      } catch (e) {
        this.logger.error(e.msg);
        if (/\d{6}/.test(e.message)) {
          ctx.res.statusCode = 400;
          ctx.body = {
            code: e.message,
          };
        } else {
          ctx.res.statusCode = 500;
          ctx.body = {
            code: "000000",
            msg: e.message,
          };
        }
      }
    };
  }
}
