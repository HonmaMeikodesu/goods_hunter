import { GoodsBreifExtension } from "../types";

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


export type YahooAuctionGoodsSearchCondition = {
    keyword: string,
}

