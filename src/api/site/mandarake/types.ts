import { GoodsBreifExtension, GoodsSearchConditionBase } from "../types";

export interface GoodsListResponse {
  items: Array<GoodsBreif>;
}

export interface GoodsBreif extends GoodsBreifExtension {
  id: string,
  name: string,
  price: string,
  thumbnails: Array<string>,
}

export type MandarakeGoodsSearchCondition = GoodsSearchConditionBase & {
  page?: number;
}
