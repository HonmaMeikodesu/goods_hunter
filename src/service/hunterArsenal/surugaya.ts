import { Provide, Inject, Scope, ScopeEnum, Config, TaskLocal, Init } from "@midwayjs/decorator";
import { In, Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { SurugayaHunter as SurugayaHunterType } from "../../types";
import { isEmpty } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import CONST from "../../const";
import HunterBase from "./base";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import { CustomConfig } from "../../config/config.default";
import { SurugayaApi } from "../../api/site/surugaya";
import { SurugayaHunter as SurugayaHunterModel } from "../../model/surugaya";
import { SurugayaGoodsSearchCondition, GoodsListResponse as SurugayaGoodsListResponse } from "../../api/site/surugaya/types";
import { surugayaGoodsList } from "../../template";
import { SurugayaGoodsRecord } from "../../model/surugayaGoodsRecord";

@Provide()
@Scope(ScopeEnum.Singleton)
export class SurugayaHunterService extends HunterBase {

    hunterType: typeof CONST.HUNTERTYPE[number] = "Surugaya";

    @Inject()
    suruguyaApi: SurugayaApi;

    @InjectEntityModel(SurugayaHunterModel)
    hunterModel: Repository<SurugayaHunterModel>;

    @InjectEntityModel(SurugayaGoodsRecord)
    surugayaGoodsRecordModel: Repository<SurugayaGoodsRecord>;

    @Config("emailConfig")
    mailInfo: CustomConfig["emailConfig"];

    @TaskLocal("0 */1 * * * *")
    private async selfPingPong() {
        await super.pingpongTask();
    }

    @Init()
    async init() {
        await super.init();
    }

    async hire(ctx: Context, hunterInfo: SurugayaHunterType) {
        await super.hire(ctx, hunterInfo, SurugayaHunterModel, "surugayaHunters");
    }

    async goHunt(cronId: string) {
        const currentHunterInfo = await this.hunterModel.findOne({
            where: {
                hunterInstanceId: cronId,
            },
            relations: ["user"],
        });
        if (isEmpty(currentHunterInfo)) return;
        const { searchConditionSchema, freezingStart, freezingEnd, user } =
            currentHunterInfo;
        if (
            freezingStart &&
            freezingEnd &&
            isBetweenDayTime(freezingStart, freezingEnd)
        ) {
            this.logger.info(`task ${cronId} sleeping, exiting...`);
            return;
        }
        let searchCondition: SurugayaGoodsSearchCondition;
        try {
            searchCondition = JSON.parse(searchConditionSchema);
            if (!searchCondition.keyword) {
                throw new Error("no keyword found!");
            }
        } catch (e) {
            this.logger.error(
                `Invalid Surugaya Hunter search condition when executiong cronjob{${cronId}}, ${e}`
            );
            return;
        }
        let goodsList: SurugayaGoodsListResponse = [];
        try {
            goodsList = await this.suruguyaApi.fetchGoodsList(searchCondition);
        } catch (e) {
            this.logger.error(
                `Fail to fetch good list when executing cronjob{${cronId}}, ${e}`
            );
            return;
        }
        if (isEmpty(goodsList)) {
            this.logger.info(
                `task ${cronId} gets an empty goodsList, exiting...`
            );
            return;
        }

        const lastSeenGoodList =
            (
                await this.surugayaGoodsRecordModel.find({
                    where: {
                        hunter: {
                            hunterInstanceId: cronId
                        },
                    },
                })
            );

        let filteredGoods = (goodsList || []).filter((good) => {
            const existed = lastSeenGoodList?.find(item => item.id === good.id);

            if (!existed) return true;

            if (good.price && existed.price !== good.price) return true;

            if (good.marketPlacePrice && existed.marketPlacePrice !== good.marketPlacePrice) return true;

        })
        // FIXME collision between different hunters when getting ignoring goods
        const ignoreGoods = await this.redisClient.smembers(
            `Surugaya_${CONST.USERIGNORE}_${user.email}`
        );
        filteredGoods = filteredGoods.filter(
            good => !ignoreGoods.includes(good.id)
        );
        Promise.all(
            filteredGoods.map(async good => {
                good.thumbnailData = await this.cipher.encode(
                    good.thumbImgUrl
                );
                good.ignoreInstruction = await this.cipher.encode(
                    `${user.email} ${good.id}`
                );
                return good;
            })
        )
            .then(async () => {
                if (!isEmpty(filteredGoods)) {
                    const html = render(surugayaGoodsList, {
                        data: filteredGoods,
                        serverHost: this.serverInfo.serverHost,
                    });

                    const emailMessage: Mail.Options = {
                        to: user.email,
                        subject: `New update on surugaya auctions of your interest, keyword:${searchCondition.keyword}`,
                        html,
                    };
                    await this.emailService.sendEmail(emailMessage);
                    await this.surugayaGoodsRecordModel.delete({
                        hunter: {
                            hunterInstanceId: cronId
                        }
                    });
                    await this.surugayaGoodsRecordModel.createQueryBuilder().insert().values((goodsList || []).map(good => ({
                        id: good.id,
                        name: good.name,
                        hunter: { hunterInstanceId: cronId },
                        price: good.price || null,
                        marketPlacePrice: good.marketPlacePrice || null,
                    }))).execute();
                    this.logger.info(
                        `email sent to ${user.email
                        }, goodsNameRecord:\n${JSON.stringify(
                            filteredGoods.map(good => good.name)
                        )}\n`
                    );
                }
                this.logger.info(
                    `task ${cronId} executed steady and sound at ${moment().format(
                        "YYYY:MM:DD hh:mm:ss"
                    )}`
                );
            })
            .catch(e => {
                this.logger.error(
                    `task ${cronId} execution failed at ${moment().format(
                        "YYYY:MM:DD hh:mm:ss"
                    )}, here is the error message:\n${e}`
                );
            });
    }


    async transfer(id: string, newHunterInfo: Pick<SurugayaHunterType, "freezingRange" | "schedule" | "searchCondition">) {
        await super.transfer(id, newHunterInfo, SurugayaHunterModel);
        const hunter = await this.hunterModel.findOne({
            where: {
                hunterInstanceId: id,
            },
        });

        const {
            searchConditionSchema: prevSearchConditionSchema
        } = hunter;
        let prevSearchCondition: SurugayaGoodsSearchCondition;
        try {
            prevSearchCondition = JSON.parse(prevSearchConditionSchema);
        } catch (e) {
            // pass
        }
        if (prevSearchCondition?.keyword !== newHunterInfo.searchCondition.keyword) {
            await this.hunterModel.manager.delete(SurugayaGoodsRecord, {
                hunter: {
                    hunterInstanceId: id
                }
            });
        }
    }

}

