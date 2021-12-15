import { Provide, Inject, Scope, ScopeEnum } from "@midwayjs/decorator";
import { createTransport, Transporter } from "nodemailer";
import Mail from "nodemailer/lib/mailer";
import mailInfo from "../config/mail";

@Provide()
@Scope(ScopeEnum["Singleton"])
export class EmailService {
  private transporter: Transporter;
  constructor() {
    this.transporter = createTransport(`smtps://${mailInfo.user}:${mailInfo.password}@${mailInfo.host}/?pool=true`);
  }

  async sendEmail(message: Mail.Options) {
    await this.transporter.sendMail(message);
  }
}