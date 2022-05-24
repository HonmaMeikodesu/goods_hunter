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
import isValidUrl from "../utils/isValidUrl";
import { MercariHunter } from "../model/mercariHunter";

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

  compareKeyword(url1: string, url2: string): boolean {
    if (!isValidUrl(url1) || !isValidUrl(url2)) throw new Error("Invalid Url");
    return (
      new URL(decodeURIComponent(url1)).searchParams.get("keyword") ===
      new URL(decodeURIComponent(url2)).searchParams.get("keyword")
    );
  }

  async checkTaskExist(url: string, type: GoodsHunter["type"]) {
    const user = this.ctx.user as UserInfo;
    if (type === "Mercari") {
      const currentUser = await this.user.findOne(user.email, { relations: ["mercariHunters"] });
      if (!isEmpty(currentUser?.mercariHunters)) {
        if (currentUser.mercariHunters.some((hunter) => this.compareKeyword(url, hunter.url))) {
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
  ): Promise<Omit<CronDeail, "jobInstance">[]> {
    const user = await this.user.findOne(
      {
        email,
      },
      { relations: ["mercariHunters"] }
    );
    if (type === "Mercari") {
      const allCronList = this.hunterCronManager.getCronList();
      return user.mercariHunters.map(hunter =>
        omit(allCronList[hunter.hunterInstanceId], "jobInstance")
      );
    }
  }
}
