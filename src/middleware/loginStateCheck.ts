import { Provide, Logger } from '@midwayjs/decorator';
import { ILogger } from "@midwayjs/logger";
import { IWebMiddleware, IMidwayWebNext } from '@midwayjs/web';
import { Context } from 'egg';
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { LoginState } from '../model/loginState';
import errorCode from "../errorCode";
import moment from 'moment';
import { UserInfo } from "../types";

@Provide()
export class LoginStateCheck implements IWebMiddleware {

  @InjectEntityModel(LoginState)
  loginStateModel: Repository<LoginState>;

  @Logger()
  logger: ILogger;

  resolve() {
    return async (ctx: Context, next: IMidwayWebNext) => {
      const loginState = ctx.cookies.get("loginState")  as string | undefined;
      console.log(1234);
      if (!loginState) {
        ctx.redirect("/");
        ctx.res.end();
        return;
      }
      const record = await this.loginStateModel.findOne({
        loginState,
      }, {
        relations: [ "user" ]
      });
      if (!record?.user?.email) throw new Error(errorCode.loginStateMiddleware.invalidLoginState);
      if (moment().isAfter(record?.expiredAt)) throw new Error(errorCode.loginStateMiddleware.expiredLoginState);
      // check passed
      ctx.user = {
        email: record.user.email
      } as UserInfo;
      await next();
    };
  }
}