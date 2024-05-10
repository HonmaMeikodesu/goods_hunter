import { Provide, Inject } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import CONST from "../const";
import { GoodsHunter, UserInfo } from "../types";
import { HunterCronManager } from "./hunterCronManager";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import { Context } from "egg";
import { MercariHunter } from "../model/mercariHunter";
import { YahooHunter } from "../model/yahooHunter";
import { GoodsHunterModelBase } from "../model/types";

@Provide()
export class GoodsService {


  @Inject()
  hunterCronManager: HunterCronManager;

  @InjectEntityModel(User)
  user: Repository<User>;

  @InjectEntityModel(MercariHunter)
  mercariHunterModel: Repository<MercariHunter>;

  @InjectEntityModel(YahooHunter)
  yahooHunterModel: Repository<YahooHunter>;

  @Inject()
  ctx: Context;

  async deleteTask(id: string, type: GoodsHunter["type"]) {
    const user = this.ctx.user as UserInfo;
    const targetModel: Repository<GoodsHunterModelBase> = type === "Mercari" ? this.mercariHunterModel : this.yahooHunterModel;
    const abortingHunter = await targetModel.findOne({
      where: {
        hunterInstanceId: id
      },
      relations: ["user"]
    });
    if (abortingHunter?.user?.email) {
      const hunterOwnerEmail = abortingHunter.user.email
      if (hunterOwnerEmail !== user.email) {
        throw new Error(errorCode.goodsService.taskPermissionDenied)
      }
      await this.hunterCronManager.dismissHunter(id, type);
    } else {
      throw new Error(errorCode.goodsService.taskNotFound);
    }
  }

  async listUserTasks(
    email: string,
  ): Promise<GoodsHunterModelBase[]> {
    const allUserWatchers = await this.hunterCronManager.getCronList(email);
    return allUserWatchers;
  }
}

