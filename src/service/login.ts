import { Provide, Inject, Scope, ScopeEnum, Body } from "@midwayjs/decorator";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import errorCode from "../errorCode";
import { isArray, isEmpty } from "lodash";
import { v4 } from "uuid";
import { LoginState } from "../model/loginState";
import moment from "moment";


@Provide()
export class LoginService {

  @InjectEntityModel(User)
  userModel: Repository<User>;

  @InjectEntityModel(LoginState)
  loginStateModel: Repository<LoginState>;

  async checkValidAndGenerateLoginState(email: string, password: string) {
    const record = await this.userModel.findOne({
      email,
      password,
    }, {
      relations: ["loginStates"]
    });
    if (isEmpty(record)) throw new Error(errorCode.loginService.wrongEmailOrPassword);
    const loginState = await this.generateLoginStateAndSaveInDB(record);
    return loginState;
  }

  async generateLoginStateAndSaveInDB(user: User) {
    const uuid = v4();
    const expiredAt = moment().add(1, "week").format("YYYY-MM-DD HH:mm:ss");
    const loginState = new LoginState();
    loginState.loginState = uuid;
    loginState.expiredAt = expiredAt;
    user.loginStates.push(loginState)
    await this.userModel.save(user);
    return uuid;
  }
}