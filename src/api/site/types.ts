import { CipherPayload } from "../../types";
import { MercariGoodsSearchCondition } from "./mercari/types";

export type GoodsSearchCondition = MercariGoodsSearchCondition;

export type GoodsBreifExtension = {
  thumbnailData: CipherPayload
  ignoreInstruction: CipherPayload;
}
