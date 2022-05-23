import { CronJob } from "cron";
import CONST from "./const";

export interface UserInfo {
  email: string;
}

export interface FreezingRange {
  start: string;
  end: string;
}

export interface GoodsHunter {
  type: typeof CONST.HUNTERTYPE[number];
  user: UserInfo;
  url: string;
  schedule: string;
  freezingRange?: FreezingRange;
  lastShotAt?: string;
  createdAt: string;
}

export interface MercariHunter extends GoodsHunter {
  [key: string]: any;
}

export interface CronDetailInDb<T extends GoodsHunter = any> {
  id: string;
  hunterInfo: T;
}

export interface CronDeail<T extends GoodsHunter = any>
  extends CronDetailInDb<T> {
  jobInstance: CronJob;
}
