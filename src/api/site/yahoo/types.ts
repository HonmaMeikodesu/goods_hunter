import { GoodsBreifExtension, GoodsSearchConditionBase, GoodsSurveillanceConditionBase } from "../types";

export type GoodsListResponse = GoodsBreif[];

export type GoodsBreif = GoodsBreifExtension & {
    id: string;
    name: string;
    thumbImgUrl: string;
    currentPrice: number;
    buyNowPrice?: number;
    currentBidCount: number;
    endTime: number;
    isFreeShipping?: boolean;
    isBrandNew?: boolean;
}


export type YahooAuctionGoodsSearchCondition = GoodsSearchConditionBase & {
    category?: string;
    epoch?: number;
};


export type YahooGoodsSurveillanceCondition = GoodsSurveillanceConditionBase & {
   criteria: Array<"price">;
}

