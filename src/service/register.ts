import { Provide, Inject, Scope, ScopeEnum, Body, Config } from "@midwayjs/decorator";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import errorCode from "../errorCode";
import sha256 from "crypto-js/sha256";
import { EmailService } from "./email";
import { RedisService } from "@midwayjs/redis";
import CONST from "../const";
import { v4 } from "uuid";
import { CustomConfig } from "../config/config.default";

@Provide()
export class RegisterService {
  @InjectEntityModel(User)
  userModel: Repository<User>;

  @Inject()
  emailService: EmailService;

  @Inject("redis:redisService")
  redisClient: RedisService;

  @Config("serverInfo")
  serverInfo: CustomConfig["serverInfo"];

  @Config("emailConfig")
  emailConfig: CustomConfig["emailConfig"];

  private async sendVerification(email: string, code: string) {
    await this.emailService.sendEmail({
      to: this.emailConfig.systemOwner,
      subject: "You got a new user register verification to confirm",
      html: `new user email: ${email}, click <a src="http://${this.serverInfo.serverHost}/register/confirm?code=${code}">here</a> to accept, ignore to decline`,
    });
  }

  async generateVericationCode(email: string, password: string) {
    const code = v4();
    await this.redisClient.setex(
      `${CONST.REGISTERCODE}${code}`,
      60 * 60 * 12,
      JSON.stringify({ email, password })
    );
    await this.sendVerification(email, code);
  }

  async confirmRegister(code: string) {
    const key = `${CONST.REGISTERCODE}${code}`;
    const user = await this.redisClient.get(key);
    if (!user)
      throw new Error(errorCode.registerService.invalidVerificationCode);
    const { password, email } = JSON.parse(user) as User;
    // TODO use HMAC instead (加盐)
    const digest = sha256(password).toString();
    const record = await this.userModel.findAndCount({
      email,
      password: digest,
    });
    if (record[1] !== 0)
      throw new Error(errorCode.registerService.userAlreadyExist);
    const newUser = new User();
    newUser.email = email;
    newUser.password = digest;
    // TODO transaction
    await this.userModel.save(newUser);
    await this.redisClient.del(key);
    await this.emailService.sendEmail({
      to: email,
      subject:
        "Your account has been confirmed and registered, have fun and enjoy your hunting here, fresh one :)",
    });
  }
}


