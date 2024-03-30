import { Provide, Logger, Middleware } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { IMiddleware } from "@midwayjs/core";
import { NextFunction } from "@midwayjs/web";
import { Context } from "egg";

@Middleware()
export class ErrorCatchMiddleware
  implements IMiddleware<Context, NextFunction>
{
  @Logger()
  logger: ILogger;

  ignore(ctx?: Context<any>) {
    return ["/proxy"].some(path => ctx.path.includes(path));
  }

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
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
