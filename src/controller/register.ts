import { Controller, Get, Provide, Body, Inject, Post, Query } from '@midwayjs/decorator';
import { Context } from 'egg';
import errorCode from '../errorCode';
import { RegisterService } from '../service/register';

@Provide()
@Controller('/register')
export class RegisterController {

  @Inject()
  registerService: RegisterService;

  @Inject()
  ctx: Context;

  @Post('/')
  async register(@Body("email") email: string, @Body("password") password: string) {
    if (!email || !password) throw new Error(errorCode.common.invalidRequestBody);
    await this.registerService.generateVericationCode(email, password);
  }

  @Get('/confirm')
  async confirmRegister(@Query("code") code: string) {
    if (!code) throw new Error(errorCode.common.invalidRequestBody);
    await this.registerService.confirmRegister(code);
  }
}
