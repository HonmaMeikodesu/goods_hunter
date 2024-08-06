import { User } from "./user";

export interface GoodsHunterModelBase {
    user: User;

    hunterInstanceId: string;

    freezingStart: string;

    freezingEnd: string;

    schedule: string;

    searchConditionSchema: string;

    createdAt: string;

    updatedAt: string;
}

