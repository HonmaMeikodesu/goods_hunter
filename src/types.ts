import { CronJob } from "cron";

export interface GoodsHunter {
  url: string;
  frequency: number;
}

export interface MercariHunter extends GoodsHunter {
  [key: string]: any;
}

export interface CronDeail {
  id: string;
  jobInstance: CronJob;
  hunterInfo: GoodsHunter;
}