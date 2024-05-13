import { GoodsBreifExtension, GoodsSearchConditionBase } from "../types";

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
    category?: string
};



