import { Provide, Logger } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { IMiddleware } from "@midwayjs/core";
import { NextFunction } from "@midwayjs/web";
import { Context } from "egg";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { LoginState } from "../model/loginState";
import errorCode from "../errorCode";
import moment from "moment";
import { UserInfo } from "../types";

@Provide()
export class LoginStateCheck implements IMiddleware<Context, NextFunction> {
  @InjectEntityModel(LoginState)
  loginStateModel: Repository<LoginState>;

  @Logger()
  logger: ILogger;

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      const loginState = ctx.cookies.get("loginState") as string | undefined;
      if (!loginState) {
        ctx.redirect("/");
        ctx.res.end();
        return;
      }
      const record = await this.loginStateModel.findOne(
        {
          loginState,
        },
        {
          relations: ["user"],
        }
      );
      if (!record?.user?.email)
        throw new Error(errorCode.loginStateMiddleware.invalidLoginState);
      if (moment().isAfter(record?.expiredAt))
        throw new Error(errorCode.loginStateMiddleware.expiredLoginState);
      // check passed
      ctx.user = {
        email: record.user.email,
      } as UserInfo;
      await next();
    };
  }
}
