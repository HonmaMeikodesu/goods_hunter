import { Controller, Get, Provide, Body } from '@midwayjs/decorator';
import errorCode from '../errorCode';

@Provide()
@Controller()
export class LoginController {

  @Get('/login')
  async login(@Body("email") email: string, @Body("password") password: string) {
    if (!email || !password) throw new Error(errorCode.loginController.invalidRequestBody);
    return 'Hello Midwayjs!';
  }
}
