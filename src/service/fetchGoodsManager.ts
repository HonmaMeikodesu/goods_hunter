import { Provide, Inject, Scope, ScopeEnum } from "@midwayjs/decorator";
import { v4 as uuid } from "uuid";
import { CronJob } from "cron";
import { GoodsHunter, MercariHunter } from "../types";

function hunterCognition<T extends GoodsHunter>(hunterInfo: GoodsHunter, cognitionFunc: (info: typeof hunterInfo) => boolean): hunterInfo is T {
  return cognitionFunc(hunterInfo);
}

interface CronList {
  [uuid: string]: CronJob
}

@Provide()
@Scope(ScopeEnum["Singleton"])
class FetchGoodsManager {
  private cronList: CronList;
  getCronList() {
    return this.cronList;
  }
  addToCronList(hunterInfo: GoodsHunter) {
    if(hunterCognition<MercariHunter>(hunterInfo, (info) => !!info.url)) {
      const newCronJob = new CronJob('* * * * * *', (() => {
        const preyInfo = hunterInfo
      }), null, true, 'America/Los_Angeles')
    }
  }
}