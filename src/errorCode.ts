const type = {
  middleware: "01",
  controller: "02",
  service: "03",
  common: "04",
  misc: "05",
  manager: "06"
};

const middleware = {
  loginStateCheck: "01",
  errorCatch: "02",
};

const controller = {
  goods: "01",
  login: "02",
  register: "03",
  proxy: "04"
};

const service = {
  email: "01",
  hunterRouteService: "02",
  login: "03",
  register: "04",
  goods: "05",
  cipher: "06",
  proxy: "07",
  commonHunter: "08",
};

const misc = {
  utils: "01",
};

export default {
  loginStateMiddleware: {
    missingLoginState: type.middleware + middleware.loginStateCheck + "01",
    invalidLoginState: type.middleware + middleware.loginStateCheck + "02",
    expiredLoginState: type.middleware + middleware.loginStateCheck + "03",
  },
  loginController: {},
  loginService: {
    wrongEmailOrPassword: type.service + service.login + "01",
  },
  registerController: {},
  registerService: {
    userAlreadyExist: type.service + service.register + "01",
    invalidVerificationCode: type.service + service.register + "02",
  },
  common: {
    invalidRequestBody: type.common + "0001",
  },
  goodsController: {
    invalidHunterType: type.controller + controller.goods + "01",
  },
  goodsService: {
    taskNotFound: type.service + service.goods + "02",
    taskPermissionDenied: type.service + service.goods + "03"
  },
  cipherService: {
    messageCorrupted: type.service + service.cipher + "01",
    messageConsumed: type.service + service.cipher + "02"
  },
  proxyService: {
    invalidImageUrl: type.service + service.proxy + "01"
  },
  commonHunterService: {
    cronJobNotFound: type.service + service.commonHunter + "01"
  }
};


