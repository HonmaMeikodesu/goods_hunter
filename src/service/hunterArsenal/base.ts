import { Inject, Logger, Config, TaskLocal } from "@midwayjs/decorator";
import { ILogger } from "@midwayjs/logger";
import { RedisService } from "@midwayjs/redis";
import { CustomConfig } from "../../config/config.default";
import CipherServive from "../cipher";
import { EmailService } from "../email";
import { DatabaseTransactionWrapper } from "../../utils/databaseTransactionWrapper";
import { CronDeail } from "../../types";
import CONST from "../../const";
import { CronJob, CronTime } from "cron";

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

    @Logger()
    logger: ILogger;

    @Inject()
    emailService: EmailService;

    @Config("serverInfo")
    serverInfo: CustomConfig["serverInfo"];

    @Inject()
    cipher: CipherServive;

    abstract hire(...any: any): Promise<any>;

    abstract dismiss(hunterInstanceId: string): Promise<any>;

    abstract transfer(id: string, newHunterInfo: any): Promise<any>;

    abstract goHunt(hunterInstanceId: string): Promise<any>;
}
