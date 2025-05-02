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

  @InjectEntityModel(SurugayaHunter)
  surugayaHunterModel: Repository<SurugayaHunter>;

  @InjectEntityModel(SurveillanceRecord)
  surveillanceRecord: Repository<SurveillanceRecord>;


  @Inject()
  ctx: Context;

  async deleteTask(id: string, type: GoodsHunter["type"]) {
    const user = this.ctx.user as UserInfo;
    const targetModel: Repository<GoodsHunterModelBase> = type === "Mercari" ? this.mercariHunterModel : type === "Yahoo" ? this.yahooHunterModel : type === "Surugaya" ? this.surugayaHunterModel : this.surveillanceRecord;
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
      await this.hunterRouteService.dismissHunter(id, type);
    } else {
      throw new Error(errorCode.goodsService.taskNotFound);
    }
  }

  async listUserTasks(
    email: string,
  ): Promise<GoodsHunterModelBase[]> {
    const allUserWatchers = await this.hunterRouteService.getCronList(email);
    return allUserWatchers;
  }
}


