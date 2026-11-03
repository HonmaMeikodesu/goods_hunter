import { EggAppConfig, EggAppInfo, PowerPartial } from "egg";
import { readFileSync } from "fs";
import path from "path";

export type CustomConfig = {
serverInfo: {
serverHost: string;
	    },
emailConfig: {
user: string;
password: string;
host: string;
systemOwner: string;
contactSystemOwner: string;
	     },
secretKeyJwkData: JsonWebKey;
alicloudConfig?: {
accessKeyId: string;
accessKeySecret: string;
url: string;
yahooFleamarketUrl?: string;
xianyuUrl?: string;
};
}

export type DefaultConfig = PowerPartial<EggAppConfig> & CustomConfig;

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

	config.cors = {
origin: "*",
	allowMethods: "GET,HEAD,PUT,POST,DELETE,PATCH",
	};

	config.task = {
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

	config.emailConfig = JSON.parse(readFileSync(path.resolve(__dirname, "../private/email.json")).toString());

	config.secretKeyJwkData = JSON.parse(readFileSync(path.resolve(__dirname, "../private/secret.json")).toString());

	config.serverInfo = JSON.parse(readFileSync(path.resolve(__dirname, "../private/server.json")).toString());

	config.yahooSession = {
		file: process.env.YAHOO_SESSION_FILE || "",
		legacyFile: process.env.YAHOO_COOKIE_FILE || path.resolve(__dirname, "../private/yahoo.json"),
		maxAgeSeconds: Number(process.env.YAHOO_SESSION_MAX_AGE_SECONDS || 21600),
		authenticatedSelector: process.env.YAHOO_AUTH_SELECTOR || undefined,
	};

	try {
		config.alicloudConfig = JSON.parse(readFileSync(path.resolve(__dirname, "../private/alicloud.json")).toString());
	} catch (e) {
		config.alicloudConfig = { accessKeyId: "", accessKeySecret: "", url: "" };
	}
	config.alicloudConfig.yahooFleamarketUrl = process.env.YAHOO_FLEAMARKET_FC_URL || config.alicloudConfig.yahooFleamarketUrl || "";
	config.alicloudConfig.xianyuUrl = process.env.XIANYU_FC_URL || config.alicloudConfig.xianyuUrl || "";


	config.egg = {
port: 7001,
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

