const type = {
  middleware: "01",
  controller: "02",
  service: "03",
  common: "04",
}

const middleware = {
  loginStateCheck: "01",
  errorCatch: "02",
}

const controller = {
  registerGoods: "01",
  login: "02",
  register: "03"
}

const service = {
  emailService: "01",
  hunterCronManager: "02",
  login: "03",
  register: "04"
}

export default {
  loginStateMiddleware: {
    missingLoginState: type.middleware + middleware.loginStateCheck + "01",
    invalidLoginState: type.middleware + middleware.loginStateCheck + "02",
    expiredLoginState: type.middleware + middleware.loginStateCheck + "03",
  },
  loginController: {
  },
  loginService: {
    wrongEmailOrPassword: type.service + service.login + "01",
  },
  registerController: {
  },
  registerService: {
    userAlreadyExist: type.service + service.register + "01",
    invalidVerificationCode: type.service + service.register + "02"
  },
  common: {
    invalidRequestBody: type.common + "0001",
  }
}