const type = {
  middleware: "01",
  controller: "02",
  service: "03",
  common: "04",
  misc: "05",
}

const middleware = {
  loginStateCheck: "01",
  errorCatch: "02",
}

const controller = {
  goods: "01",
  login: "02",
  register: "03"
}

const service = {
  email: "01",
  hunterCronManager: "02",
  login: "03",
  register: "04",
  goods: "05"
}

const misc = {
  utils: "01",
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
  },
  goodsService: {
    taskAlreadyExist: type.service + service.goods + "01",
    taskNotFound: type.service + service.goods + "02",
  },
  getHunterType: {
    invalidUrl: type.misc + misc.utils + "01",
    hunterTypeNotFound: type.misc + misc.utils + "02",
  }
}