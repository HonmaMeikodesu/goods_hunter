import { Provide, Inject, Scope, ScopeEnum, Body } from "@midwayjs/decorator";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import errorCode from "../errorCode";
import { isEmpty } from "lodash";
import { v4 } from "uuid";
import { LoginState } from "../model/loginState";


@Provide()
export class LoginService {

  @InjectEntityModel(User)
  userModel: Repository<User>;

  @InjectEntityModel(LoginState)
  loginStateModel: Repository<LoginState>;

  async checkValid(email: string, password: string) {
    const record = await this.userModel.findOne({
      email,
      password,
    });
    if (isEmpty(record)) throw new Error(errorCode.loginService.wrongEmailOrPassword);
    return;
  }

  async generateLoginStateAndSaveInDB(email: string) {
    const loginState = new LoginState();
  }
}