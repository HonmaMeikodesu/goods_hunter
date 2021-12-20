import { Provide, Inject } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import { RedisService } from "@midwayjs/redis";
import CONST from "../const";
import { CronDetailInDb, GoodsHunter } from "../types";
import { HunterCronManager } from "./hunterCronManager";


@Provide()
export class GoodsService {

  @Inject("redis:redisService")
  private redisClient: RedisService;

  @Inject()
  hunterCronManager: HunterCronManager;

  async deleteTask(email: string, url: string) {
    const values = await this.redisClient.hvals(CONST.HUNTERINFO);
    const tasks = values.map((val) => JSON.parse(val)) as CronDetailInDb<GoodsHunter>[];
    const task = tasks.find((task) => (task.hunterInfo.user.email === email) && (task.hunterInfo.url === url));
    if (!task) throw new Error(errorCode.goodsService.TaskNotFound);
    await this.hunterCronManager.removeCronTask(task.id);
  }
}