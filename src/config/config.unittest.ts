import { EggAppInfo } from "egg";
import { DefaultConfig } from "./config.default";

export const security = {
  csrf: false,
};

export default (appInfo: EggAppInfo) => {
  const config = {} as DefaultConfig;

  config.orm = {
    type: "mysql",
    host: "127.0.0.1",
    port: 3306,
    username: "honmameiko",
    password: "honmameiko",
    database: "goods_hunter_test",
    logging: true,
    synchronize: true,
    timezone: "+08:00",
  };

  return config;
};