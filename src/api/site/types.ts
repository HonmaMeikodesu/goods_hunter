import { MercariGoodsSearchCondition } from "./mercari/types";
import { YahooAuctionGoodsSearchCondition } from "./yahoo/types";
import { SurugayaGoodsSearchCondition } from "./surugaya/types";
import { MandarakeGoodsSearchCondition } from "./mandarake/types";

export type GoodsSearchConditionBase = {
  keyword: string;
}

export type GoodsSurveillanceConditionBase = {
    type: "mercari" | "yahoo"
    goodId: string
}

export type GoodsSearchCondition =
  | MercariGoodsSearchCondition
  | YahooAuctionGoodsSearchCondition
  | SurugayaGoodsSearchCondition
  | MandarakeGoodsSearchCondition;


export type GoodsBreifExtension = {}
