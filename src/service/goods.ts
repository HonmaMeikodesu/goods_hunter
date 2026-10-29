import { Provide, Inject } from "@midwayjs/decorator";
import errorCode from "../errorCode";
import CONST from "../const";
import { GoodsHunter, UserInfo } from "../types";
import { HunterRouteService } from "./hunterRouteService";
import { InjectEntityModel } from "@midwayjs/orm";
import { Repository } from "typeorm";
import { User } from "../model/user";
import { Context } from "egg";
import { MercariHunter } from "../model/mercariHunter";
import { YahooHunter } from "../model/yahooHunter";
import { GoodsHunterModelBase } from "../model/types";
import { SurugayaHunter } from "../model/surugaya";
import { SurveillanceRecord } from "../model/surveillanceRecord";
import { MandarakeHunter } from "../model/mandarakeHunter";
import { YahooFleamarketHunter } from "../model/yahooFleamarketHunter";

@Provide()
export class GoodsService {


  @Inject()
  hunterRouteService: HunterRouteService;

  @InjectEntityModel(User)
  user: Repository<User>;

  @InjectEntityModel(MercariHunter)
  mercariHunterModel: Repository<MercariHunter>;

  @InjectEntityModel(YahooHunter)
  yahooHunterModel: Repository<YahooHunter>;

  @InjectEntityModel(YahooFleamarketHunter)
  yahooFleamarketHunterModel: Repository<YahooFleamarketHunter>;

  @InjectEntityModel(SurugayaHunter)
  surugayaHunterModel: Repository<SurugayaHunter>;

  @InjectEntityModel(MandarakeHunter)
  mandarakeHunterModel: Repository<MandarakeHunter>;

  @InjectEntityModel(SurveillanceRecord)
  surveillanceRecord: Repository<SurveillanceRecord>;


  @Inject()
  ctx: Context;

  private async assertTaskOwner(id: string, type: GoodsHunter["type"]) {
    const user = this.ctx.user as UserInfo;
    const targetModel: Repository<GoodsHunterModelBase> =
      type === "Mercari"
        ? this.mercariHunterModel
        : type === "Yahoo"
        ? this.yahooHunterModel
        : type === "YahooFleamarket"
        ? this.yahooFleamarketHunterModel
        : type === "Surugaya"
        ? this.surugayaHunterModel
        : type === "Mandarake"
        ? this.mandarakeHunterModel
        : this.surveillanceRecord;
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
    } else {
      throw new Error(errorCode.goodsService.taskNotFound);
    }
  }

  async deleteTask(id: string, type: GoodsHunter["type"]) {
    await this.assertTaskOwner(id, type);
    await this.hunterRouteService.dismissHunter(id, type);
  }

  async updateTask(id: string, info: Pick<GoodsHunter, "type" | "searchCondition" | "schedule" | "freezingRange">) {
    await this.assertTaskOwner(id, info.type);
    await this.hunterRouteService.transferHunter(id, info);
  }

  async listUserTasks(
    email: string,
  ): Promise<GoodsHunterModelBase[]> {
    const allUserWatchers = await this.hunterRouteService.getCronList(email);
    return allUserWatchers;
  }
}


