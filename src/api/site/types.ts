import { MercariGoodsSearchCondition } from "./mercari/types";
import { YahooAuctionGoodsSearchCondition } from "./yahoo/types";
import { SurugayaGoodsSearchCondition } from "./surugaya/types";
import { MandarakeGoodsSearchCondition } from "./mandarake/types";
import { YahooFleamarketSearchCondition } from "./yahooFleamarket/types";
import { XianyuSearchCondition } from "./xianyu/types";

export type GoodsSearchConditionBase = {
  keyword: string;
}

export type GoodsSurveillanceConditionBase = {
    type: "mercari" | "yahoo" | "surugaya" | "mandarake";
    goodId: string;
}

export type GoodsSearchCondition =
  | MercariGoodsSearchCondition
  | YahooAuctionGoodsSearchCondition
  | SurugayaGoodsSearchCondition
  | MandarakeGoodsSearchCondition
  | YahooFleamarketSearchCondition
  | XianyuSearchCondition;


export type GoodsBreifExtension = {}
