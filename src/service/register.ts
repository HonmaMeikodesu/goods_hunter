import { Provide, Inject, Scope, ScopeEnum, Body } from "@midwayjs/decorator";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import errorCode from "../errorCode";
import serverInfo from "../private/server";
import sha256 from "crypto-js/sha256";
import { EmailService } from "./email";
import emailConfig from "../private/mail";
import { RedisService } from "@midwayjs/redis";
import CONST from "../const";
import { v4 } from "uuid";


@Provide()
export class RegisterService {

  @InjectEntityModel(User)
  userModel: Repository<User>;

  @Inject()
  emailService: EmailService;

  @Inject("redis:redisService")
  redisClient: RedisService;

  private async sendVerification(email: string, code: string) {
    await this.emailService.sendEmail({
      to: emailConfig.systemOwner,
      subject: "You got a new user register verification to confirm",
      html: `new user email: ${email}, click <a src="http://${serverInfo.serverHost}/register/confirm?code=${code}">here</a> to accept, ignore to decline`
    });
  }

  async generateVericationCode(email: string, password: string) {
    const code = v4();
    await this.redisClient.setex(`${CONST.REGISTERCODE}${code}`, 60 * 60 * 12, JSON.stringify({ email, password }));
    await this.sendVerification(email, code);
  }

  async confirmRegister(code: string) {
    const user = await this.redisClient.get(`${CONST.REGISTERCODE}${code}`);
    if (!user) throw new Error(errorCode.registerService.invalidVerificationCode);
    const { password, email } = JSON.parse(user) as User;
    const digest = sha256(password).toString();
    const record = await this.userModel.findAndCount({
      email,
      password: digest,
    });
    if (record[1] !== 0) throw new Error(errorCode.registerService.userAlreadyExist);
    const newUser = new User();
    newUser.email = email;
    newUser.password = digest;
    await this.userModel.save(newUser);
    await this.emailService.sendEmail({
      to: email,
      subject: "Your account has been confirmed and registered, have fun and enjoy your hunting here, fresh one :)"
    })
  }
}