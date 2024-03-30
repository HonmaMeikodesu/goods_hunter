import { Provide, Inject, Scope, ScopeEnum, Init, Config } from "@midwayjs/decorator";
import { createTransport, Transporter } from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import { CustomConfig } from "../config/config.default";

@Provide()
@Scope(ScopeEnum["Singleton"])
export class EmailService {

  private transporter: Transporter;

  @Config("emailConfig")
  mailInfo: CustomConfig["emailConfig"];

  @Init()
  async init() {
    this.transporter = createTransport(
      `smtps://${this.mailInfo.user}:${this.mailInfo.password}@${this.mailInfo.host}/?pool=true`
    );
  }

  async sendEmail(message: Mail.Options) {
    await this.transporter.sendMail({
      from: this.mailInfo.systemOwner,
      ...message,
    });
  }
}

