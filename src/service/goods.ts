import { Provide, Inject } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import CONST from "../const";
import { CronDeail, GoodsHunter, UserInfo } from "../types";
import { HunterCronManager } from "./hunterCronManager";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import { isEmpty, omit } from "lodash";
import { Context } from "egg";
import { MercariHunter } from "../model/mercariHunter";
import compareKeyword from "../utils/compareKeywords";

@Provide()
export class GoodsService {


  @Inject()
  hunterCronManager: HunterCronManager;

  @InjectEntityModel(User)
  user: Repository<User>;

  @InjectEntityModel(MercariHunter)
  mercariHunter: Repository<MercariHunter>;

  @Inject()
  ctx: Context;

  async checkTaskExist(url: string, type: GoodsHunter["type"]) {
    const user = this.ctx.user as UserInfo;
    if (type === "Mercari") {
      const currentUser = await this.user.findOne(user.email, { relations: ["mercariHunters"] });
      if (!isEmpty(currentUser?.mercariHunters)) {
        if (currentUser.mercariHunters.some((hunter) => compareKeyword(url, hunter.url))) {
          throw new Error(errorCode.goodsService.taskAlreadyExist);
        }
      }
    }
  }

  async deleteTask(id: string, type: GoodsHunter["type"]) {
    const user = this.ctx.user as UserInfo;
    if (type === "Mercari") {
      const abortingMercariHunter = await this.mercariHunter.findOne({
        where: {
          hunterInstanceId: id
        },
        relations: ["user"]
      });
      if (abortingMercariHunter?.user?.email) {
        const hunterOwnerEmail = abortingMercariHunter.user.email
        if (hunterOwnerEmail !== user.email) {
          throw new Error(errorCode.goodsService.taskPermissionDenied)
        }
        await this.hunterCronManager.dismissHunter(id, "Mercari");
      } else {
        throw new Error(errorCode.goodsService.taskNotFound);
      }
    }
  }

  async listUserTasks(
    email: string,
    type: typeof CONST.HUNTERTYPE[number]
  ): Promise<MercariHunter[]> {
    const user = await this.user.findOne(
      {
        email,
      },
      { relations: ["mercariHunters"] }
    );
    if (type === "Mercari") {
      const allWatchers = await this.hunterCronManager.getCronList();
      return allWatchers;
    }
  }
}
