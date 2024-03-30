import { CronJob } from "cron";
import { GoodsSearchCondition } from "./api/site/types";
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
  searchCondition: GoodsSearchCondition;
  schedule: string;
  freezingRange?: FreezingRange;
  lastShotAt?: string;
  createdAt: string;
}

export interface MercariHunter extends GoodsHunter {
  [key: string]: any;
}

export interface CronDeail {
  id: string;
  type: GoodsHunter["type"],
  jobInstance: CronJob;
}

export type CipherPayload = {
    digest: string;
    data: {
        iv: string;
        message: string;
    };
}


