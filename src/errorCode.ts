const type = {
  middleware: "01",
  controller: "02",
  service: "03",
}

const middleware = {
  loginStateCheck: "01",
  errorCatch: "02",
}

const controller = {
  registerGoods: "01",
  login: "02",
}

const service = {
  emailService: "01",
  hunterCronManager: "02",
  login: "03",
}

export default {
  loginStateMiddleware: {
    missingLoginState: type.middleware + middleware.loginStateCheck + "01",
    invalidLoginState: type.middleware + middleware.loginStateCheck + "02",
    expiredLoginState: type.middleware + middleware.loginStateCheck + "03",
  },
  loginController: {
    invalidRequestBody: type.controller + controller.login + "01",
  },
  loginService: {
    wrongEmailOrPassword: type.service + service.login + "01",
  }
}