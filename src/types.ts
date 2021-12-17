import { CronJob } from "cron";

export interface UserInfo {
  email: string;
}

export interface GoodsHunter {
  user: UserInfo;
  url: string;
  schedule: string;
}

export interface MercariHunter extends GoodsHunter {
  [key: string]: any;
}

export interface CronDetailInDb<T extends GoodsHunter = any> {
  id: string;
  hunterInfo: T;
}

export interface CronDeail<T extends GoodsHunter = any> extends CronDetailInDb<T> {
  jobInstance: CronJob;
}