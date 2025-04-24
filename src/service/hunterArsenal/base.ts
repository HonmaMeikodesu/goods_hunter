import { Inject, Logger, Config, TaskLocal } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { User } from "../../model/user";
import { RedisService } from "@midwayjs/redis";
import { CustomConfig } from "../../config/config.default";
import CipherServive from "../cipher";
import { EmailService } from "../email";
import { DatabaseTransactionWrapper } from "../../utils/databaseTransactionWrapper";
import { CronDeail, GoodsHunter, UserInfo } from "../../types";
import CONST from "../../const";
import { CronJob, CronTime } from "cron";
import {In, Repository} from "typeorm";
import {Context} from "egg";
import { v4 as uuid } from "uuid";
import {GoodsHunterModelBase} from "../../model/types";
import {isEmpty, values} from "lodash";
import errorCode from "../../errorCode";

interface CronList {
    [uuid: string]: CronDeail;
}

export default abstract class HunterBase {
    protected cronList: CronList = {};

    hunterType: typeof CONST.HUNTERTYPE[number];

    @Inject()
    databaseTransactionWrapper: DatabaseTransactionWrapper;

    @Inject("redis:redisService")
    redisClient: RedisService;

    abstract hunterModel: Repository<any>;

    async init() {

        const promiseList: Promise<void>[] = [];

        const hunterList = await this.hunterModel.find({
            relations: ["user"],
        });

        hunterList.forEach(hunter => {
            const { hunterInstanceId, schedule } = hunter;
            promiseList.push(this.spawnCronJob(hunterInstanceId, schedule));
        });

        Promise.all(promiseList)
        .then(() => {
            this.logger.info(
                `all ${this.hunterType} hunters standing by!`
            );
        })
        .catch(reason => {
            this.logger.error(`Oops....Something went wrong when waking up ${this.hunterType} hunters:` + reason);
            process.exit(-1);
        });
    }

    async hire(ctx: Context, hunterInfo: GoodsHunter, HunterModel: { new (): GoodsHunterModelBase }, hunterRelationName: keyof User) {
        const user = ctx.user as UserInfo;
        const { email } = user;
        const cronId = uuid();
        await this.databaseTransactionWrapper({
            pending: async queryRunner => {
                // 先将新的hunterInfo绑定请求用户持久化到DB
                const user = await queryRunner.manager.findOne(
                    User,
                    { email },
                    { relations: [hunterRelationName] }
                );
                const newHunter = new HunterModel();
                newHunter.hunterInstanceId = cronId;
                newHunter.freezingStart = hunterInfo?.freezingRange?.start;
                newHunter.freezingEnd = hunterInfo?.freezingRange?.end;
                newHunter.schedule = hunterInfo?.schedule;
                newHunter.searchConditionSchema = JSON.stringify(
                    hunterInfo?.searchCondition
                );
                ( user[hunterRelationName] as any ).push(newHunter);

                await queryRunner.manager.save(user);
            },
            resolved: async () => {
                // 创建定时任务，定时任务实时从DB取数据进行定时任务的执行（schedule修改无法实时获取，需要重启cronJob）
                await this.spawnCronJob(cronId, hunterInfo.schedule)
            },
            rejected: async () => {
                throw new Error(`Error when executing add ${this.hunterType} cronJob`);
            },
        });
    }

    async pingpongTask() {
        Object.keys(this.cronList).map(async key => {
            const { jobInstance, id, schedule } = this.cronList[key];
            if (!jobInstance.running) {
                this.logger.error(
                    `task ${id} terminated unexpectedly, try respawning...`
                );
                await this.spawnCronJob(id, schedule);
            }
        });
        this.logger.info(
            `${this.hunterType} hunter ping pong check ends, current cronList: ${Object.keys(
                this.cronList
            ).join(",")}`
        );
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
            type: this.hunterType,
            schedule,
            jobInstance: newCronJob,
        };
        this.cronList[id] = cronDetail;
        newCronJob.start();
    }

    async getCronList(email: string) {
        const cronIdList = values(this.cronList).map(cron => cron.id);
        return await this.hunterModel.find({
            hunterInstanceId: In(cronIdList),
            user: { email }
        });
    }

    @Logger()
    logger: ILogger;

    @Inject()
    emailService: EmailService;

    @Config("serverInfo")
    serverInfo: CustomConfig["serverInfo"];

    @Inject()
    cipher: CipherServive;

    async dismiss(id: string) {
        const cronJob = this.cronList[id];
        if (!cronJob) return;
        await this.hunterModel.delete({
            hunterInstanceId: id,
        });
        cronJob.jobInstance?.stop();
        delete this.cronList[id];
        this.logger.info(`task ${id} removed`);
    }

    async transfer(id: string, newHunterInfo: Pick<GoodsHunter, "freezingRange" | "user" | "schedule" | "type" | "searchCondition">, HunterModel: { new (): GoodsHunterModelBase }) {
        const hunter = await this.hunterModel.findOne({
            where: {
                hunterInstanceId: id,
            },
        });

        if (!isEmpty(hunter)) {
            const {
                schedule: prevSchedule,
            } = hunter;
            const jobRecord = this.cronList[id];
            if (!jobRecord?.jobInstance) {
                throw new Error(errorCode.commonHunterService.cronJobNotFound);
            }
            const instance = jobRecord.jobInstance;
            this.databaseTransactionWrapper({
                pending: async queryRunner => {
                    await queryRunner.manager.update(
                        HunterModel,
                        { hunterInstanceId: id },
                        {
                            schedule: newHunterInfo.schedule,
                            searchConditionSchema: JSON.stringify(
                                newHunterInfo.searchCondition
                            ),
                            freezingStart: newHunterInfo?.freezingRange?.start,
                            freezingEnd: newHunterInfo?.freezingRange?.end,
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

    abstract goHunt(hunterInstanceId: string): Promise<any>;
}
