import { CipherPayload } from "../../types";
import { MercariGoodsSearchCondition } from "./mercari/types";
import { YahooAuctionGoodsSearchCondition } from "./yahoo/types";

export type GoodsSearchConditionBase = {
  keyword: string;
}

export type GoodsSearchCondition = MercariGoodsSearchCondition | YahooAuctionGoodsSearchCondition;

export type GoodsBreifExtension = {
  thumbnailData: CipherPayload
  ignoreInstruction: CipherPayload;
}

