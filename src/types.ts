import { CronJob } from "cron";

export interface UserInfo {
  email: string;
}

export interface FreezingRange {
  start: string;
  end: string;
}

export type HunterType = "Mercari";

export interface GoodsHunter {
  type: HunterType;
  user: UserInfo;
  url: string;
  schedule: string;
  freezingRange?: FreezingRange
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