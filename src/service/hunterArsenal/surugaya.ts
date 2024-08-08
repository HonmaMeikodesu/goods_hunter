import { Provide, Inject, Scope, ScopeEnum, Logger, Config, TaskLocal, Init } from "@midwayjs/decorator";
import { In, Repository } from "typeorm";
import { InjectEntityModel } from "@midwayjs/orm";
import { Context } from "egg";
import { CronDeail, SurugayaHunter as SurugayaHunterType, UserInfo } from "../../types";
import { CronJob, CronTime } from "cron";
import { v4 as uuid } from "uuid";
import { User } from "../../model/user";
import { differenceBy, isEmpty, values } from "lodash";
import isBetweenDayTime from "../../utils/isBetweenDayTime";
import CONST from "../../const";
import HunterBase from "./base";
import { render } from "ejs";
import Mail from "nodemailer/lib/mailer";
import moment from "moment";
import errorCode from "../../errorCode";
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
    surugayaHunterModel: Repository<SurugayaHunterModel>;

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

        const promiseList: Promise<void>[] = [];

        const hunterList = await this.surugayaHunterModel.find({
            relations: ["user"],
        });

        hunterList.forEach(hunter => {
            const { hunterInstanceId, schedule } = hunter;
            promiseList.push(this.spawnCronJob(hunterInstanceId, schedule));
        });

        Promise.all(promiseList)
            .then(() => {
                this.logger.info(
                    "all surugaya hunters standing by!"
                );
            })
            .catch(reason => {
                this.logger.error("Oops....Something went wrong when waking up surugaya hunters:" + reason);
                process.exit(-1);
            });
    }

    async hire(ctx: Context, hunterInfo: SurugayaHunterType) {
        const user = ctx.user as UserInfo;
        const { email } = user;
        const cronId = uuid();
        await this.databaseTransactionWrapper({
            pending: async queryRunner => {
                // 先将新的hunterInfo绑定请求用户持久化到DB
                const user = await queryRunner.manager.findOne(
                    User,
                    { email },
                    { relations: ["surugayaHunters"] }
                );
                const newSurugayaHunter = new SurugayaHunterModel();
                newSurugayaHunter.hunterInstanceId = cronId;
                newSurugayaHunter.freezingStart = hunterInfo?.freezingRange?.start;
                newSurugayaHunter.freezingEnd = hunterInfo?.freezingRange?.end;
                newSurugayaHunter.schedule = hunterInfo?.schedule;
                newSurugayaHunter.searchConditionSchema = JSON.stringify(
                    hunterInfo?.searchCondition
                );
                newSurugayaHunter.createdAt = hunterInfo.bornAt;
                user.surugayaHunters.push(newSurugayaHunter);

                await queryRunner.manager.save(user);
            },
            resolved: async () => {
                // 创建定时任务，定时任务实时从DB取数据进行定时任务的执行（schedule修改无法实时获取，需要重启cronJob）
                await this.spawnCronJob(cronId, hunterInfo.schedule)
            },
            rejected: async () => {
                throw new Error("Error when executing add surugayaHunter cronJob");
            },
        });
    }

    async goHunt(cronId: string) {
        const currentHunterInfo = await this.surugayaHunterModel.findOne({
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

    async dismiss(id: string) {
        const cronJob = this.cronList[id];
        if (!cronJob) return;
        await this.surugayaHunterModel.delete({
            hunterInstanceId: id,
        });
        cronJob.jobInstance?.stop();
        delete this.cronList[id];
        this.logger.info(`task ${id} removed`);
    }

    async transfer(id: string, newHunterInfo: Pick<SurugayaHunterType, "freezingRange" | "user" | "schedule" | "type" | "searchCondition">) {
        const hunter = await this.surugayaHunterModel.findOne({
            where: {
                hunterInstanceId: id,
            },
        });

        if (!isEmpty(hunter)) {
            const {
                schedule: prevSchedule,
                searchConditionSchema: prevSearchConditionSchema
            } = hunter;
            let prevSearchCondition: SurugayaGoodsSearchCondition;
            try {
                prevSearchCondition = JSON.parse(prevSearchConditionSchema);
            } catch (e) {
                // pass
            }
            const jobRecord = this.cronList[id];
            if (!jobRecord?.jobInstance) {
                throw new Error(errorCode.commonHunterService.cronJobNotFound);
            }
            const instance = jobRecord.jobInstance;
            this.databaseTransactionWrapper({
                pending: async queryRunner => {
                    if (prevSearchCondition?.keyword !== newHunterInfo.searchCondition.keyword) {
                        await queryRunner.manager.delete(SurugayaGoodsRecord, {
                            hunter: {
                                hunterInstanceId: id
                            }
                        });
                    }
                    await queryRunner.manager.update(
                        SurugayaHunterModel,
                        { hunterInstanceId: id },
                        {
                            schedule: newHunterInfo.schedule,
                            searchConditionSchema: JSON.stringify(
                                newHunterInfo.searchCondition
                            ),
                            freezingStart: newHunterInfo?.freezingRange?.start,
                            freezingEnd: newHunterInfo?.freezingRange?.end
                        }
                    );
                    if (prevSchedule !== newHunterInfo.schedule) {
                        // 需要重置crobJobInstance
                        instance.stop();
                        instance.setTime(new CronTime(newHunterInfo.schedule));
                        instance.start();
                    }
                },
                rejected: async () => {
                    // 更新失败，尝试重启原先的cronjob
                    await this.spawnCronJob(id, prevSchedule);
                },
            });
        } else {
            throw new Error(errorCode.commonHunterService.cronJobNotFound);
        }
    }

    async spawnCronJob(id: string, schedule: string) {
        const hunter = this.cronList[id];
        if (hunter?.jobInstance?.running) {
            // cronjob还跑着，直接返回
            this.logger.warn(`task ${id} is alreay running`);
            return;
        }
        const newCronJob = new CronJob(
            schedule,
            () => this.goHunt(id),
            null,
            false
        );
        this.logger.info(`task ${id} spawned and get set to go`);
        const cronDetail: CronDeail = {
            id,
            type: "Surugaya",
            schedule,
            jobInstance: newCronJob,
        };
        this.cronList[id] = cronDetail;
        newCronJob.start();
    }

    async getCronList(email: string) {
        const cronIdList = values(this.cronList).map(cron => cron.id);
        return await this.surugayaHunterModel.find({
            hunterInstanceId: In(cronIdList),
            user: { email }
        });
    }
}

