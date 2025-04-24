import { CipherPayload } from "../../types";
import { MercariGoodsSearchCondition, MercariGoodsSurveillanceCondition } from "./mercari/types";
import { YahooAuctionGoodsSearchCondition, YahooGoodsSurveillanceCondition } from "./yahoo/types";

export type GoodsSearchConditionBase = {
  keyword: string;
}

export type GoodsSurveillanceConditionBase = {
    type: "mercari" | "yahoo"
    url: string,
    criteria: string[]
}

export type GoodsSearchCondition = MercariGoodsSearchCondition | YahooAuctionGoodsSearchCondition;
export type GoodsSurveillanceCondition = MercariGoodsSurveillanceCondition | YahooGoodsSurveillanceCondition;

export type GoodsBreifExtension = {
  thumbnailData: CipherPayload
  ignoreInstruction: CipherPayload;
}

