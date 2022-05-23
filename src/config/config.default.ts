import { EggAppConfig, EggAppInfo, PowerPartial } from "egg";

export type DefaultConfig = PowerPartial<EggAppConfig>;

export default (appInfo: EggAppInfo) => {
  const config = {} as DefaultConfig;

  // use for cookie sign key, should change to your own and keep security
  config.keys = appInfo.name + "_1638373943741_7420";

  // add your config here
  config.middleware = [];

  config.midwayFeature = {
    // true 代表使用 midway logger
    // false 或者为空代表使用 egg-logger
    replaceEggLogger: true,
  };

  // config.security = {
  //   csrf: false,
  // };

  config.redis = {
    client: {
      port: 6379, // Redis port
      host: "127.0.0.1", // Redis host
      password: "honmameiko",
      db: 0,
    },
  };

  config.taskConfig = {
    redis: {
      port: 6379,
      host: "127.0.0.1",
      password: "honmameiko",
    },
    prefix: "honmameiko-schedule",
    defaultJobOptions: {
      repeat: {
        tz: "Asia/Shanghai",
      },
    },
  };

  config.orm = {
    type: "mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "honmameiko",
    password: "honmameiko",
    database: "goods_hunter",
    logging: true,
    synchronize: true,
    timezone: "+08:00",
  };

  config.middleware = ["errorCatchMiddleware"];

  return config;
};
