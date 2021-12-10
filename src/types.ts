import { CronJob } from "cron";

export interface GoodsHunter {
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