import { Controller, Get, Provide, Body, Inject, Post } from '@midwayjs/decorator';
import { Context } from 'egg';
import errorCode from '../errorCode';
import { LoginService } from '../service/login';

@Provide()
@Controller()
export class LoginController {

  @Inject()
  loginService: LoginService;

  @Inject()
  ctx: Context;

  @Post('/login')
  async login(@Body("email") email: string, @Body("password") password: string) {
    if (!email || !password) throw new Error(errorCode.common.invalidRequestBody);
    const loginState = await this.loginService.checkValidAndGenerateLoginState(email, password);
    this.ctx.cookies.set("loginState", loginState);
  }
}
