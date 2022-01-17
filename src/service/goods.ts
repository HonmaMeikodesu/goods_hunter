import { Provide, Inject } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import { RedisService } from "@midwayjs/redis";
import CONST from "../const";
import { CronDetailInDb, GoodsHunter, UserInfo } from "../types";
import { HunterCronManager } from "./hunterCronManager";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import { omit } from "lodash";
import isValidUrl from "../utils/isValidUrl";


@Provide()
export class GoodsService {

  @Inject("redis:redisService")
  private redisClient: RedisService;

  @Inject()
  hunterCronManager: HunterCronManager;

  @InjectEntityModel(User)
  user: Repository<User>;

  compareKeyword(url1: string, url2: string): boolean {
    if (!isValidUrl(url1) || !isValidUrl(url2)) throw new Error();
    return new URL(decodeURIComponent(url1)).searchParams.get("keyword") === new URL(decodeURIComponent(url2)).searchParams.get("keyword");
  }

  async checkTaskExist(url: string) {
    const values = await this.redisClient.hvals(CONST.HUNTERINFO);
    const tasks = values.map((val) => JSON.parse(val)) as CronDetailInDb<GoodsHunter>[];
    const task = tasks.find((task) => this.compareKeyword(url, task.hunterInfo.url));
    if (task) throw new Error(errorCode.goodsService.taskAlreadyExist);
  }

  async deleteTask(email: string, url: string) {
    const values = await this.redisClient.hvals(CONST.HUNTERINFO);
    const tasks = values.map((val) => JSON.parse(val)) as CronDetailInDb<GoodsHunter>[];
    const task = tasks.find((task) => (task.hunterInfo.user.email === email) && this.compareKeyword(task.hunterInfo.url, url));
    if (!task) throw new Error(errorCode.goodsService.taskNotFound);
    await this.hunterCronManager.removeCronTask(task.id, task.hunterInfo.type);
  }

  async listUserTasks(email: string, type: (typeof CONST.HUNTERTYPE)[number]): Promise<CronDetailInDb[]> {
    const user = await this.user.findOne({
      email
    }, { relations: ["mercariHunters"] });
    if (type === "Mercari") {
      const allCronList = this.hunterCronManager.getCronList();
      return user.mercariHunters.map((hunter) => omit(allCronList[hunter.hunterInstanceId], "jobInstance"));
    }
  }
}