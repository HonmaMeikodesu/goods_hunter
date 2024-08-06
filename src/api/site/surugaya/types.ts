import { GoodsBreifExtension, GoodsSearchConditionBase } from "../types";

export type GoodsListResponse = GoodsBreif[];

export type GoodsBreif = GoodsBreifExtension & {
    id: string;
    name: string;
    thumbImgUrl: string;
    price: string;
    marketPlacePrice: string
}


export type SurugayaGoodsSearchCondition = GoodsSearchConditionBase & {
    category?: string;
    epoch?: number;
    adultMode?: boolean;
};




