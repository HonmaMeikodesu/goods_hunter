import { Provide, Inject } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import { RedisService } from "@midwayjs/redis";
import CONST from "../const";
import { CronDetailInDb, GoodsHunter, UserInfo } from "../types";
import { HunterCronManager } from "./hunterCronManager";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";


@Provide()
export class GoodsService {

  @Inject("redis:redisService")
  private redisClient: RedisService;

  @Inject()
  hunterCronManager: HunterCronManager;

  @InjectEntityModel(User)
  user: Repository<User>;

  async checkTaskExist(url: string) {
    const values = await this.redisClient.hvals(CONST.HUNTERINFO);
    const tasks = values.map((val) => JSON.parse(val)) as CronDetailInDb<GoodsHunter>[];
    const task = tasks.find((task) => task.hunterInfo.url === url);
    if (task) throw new Error(errorCode.goodsService.taskAlreadyExist);
  }

  async deleteTask(email: string, url: string) {
    const values = await this.redisClient.hvals(CONST.HUNTERINFO);
    const tasks = values.map((val) => JSON.parse(val)) as CronDetailInDb<GoodsHunter>[];
    const task = tasks.find((task) => (task.hunterInfo.user.email === email) && (task.hunterInfo.url === url));
    if (!task) throw new Error(errorCode.goodsService.taskNotFound);
    await this.hunterCronManager.removeCronTask(task.id, task.hunterInfo.type);
  }

  async listUserTasks(email: string, type: (typeof CONST.HUNTERTYPE)[number]) {
    const user = await this.user.findOne({
      email
    });
    if (type === "Mercari") {
      const allCronList = this.hunterCronManager.getCronList();
      return user.mercariHunters.map((hunter) => allCronList[hunter.hunterInstanceId]);
    }
  }
}