export type GoodsBreif = {
    id: string;
    category: string;
    name: string;
    thumbImgUrl: string;
    currentPrice: number;
    isFreeShipping: boolean;
    shippingFee?: number;
    buyNowPrice?: number;
    endTime: number;
    status: any;
    currentBidCount: number;
}


export type YahooAuctionGoodsSearchCondition = {
    // TODO 后面再做详细区分
    url: string;
}
