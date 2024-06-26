import { CipherPayload } from "../../../types";
import { GoodsBreifExtension, GoodsSearchConditionBase } from "../types";

export interface GoodsListResponse {
  meta: any;
  items: Array<GoodsBreif>;
}

type GoodsSalesStatus = "STATUS_ON_SALE" | "STATUS_TRADING" | "STATUS_SOLD_OUT";

interface GoodsBreif extends GoodsBreifExtension {
  id: string,
  sellerId: string,
  buyerId: string,
  status: GoodsSalesStatus,
  name: string,
  price: string,
  created: string,
  updated: string,
  thumbnails: Array<string>,
  itemType: string,
  itemConditionId: string,
  shippingPayerId: string,
  shopName: string,
  itemSize: null,
  shippingMethodId: string,
  categoryId: string
}

export type MercariGoodsSearchCondition = GoodsSearchConditionBase & {
  excludeKeyword?: string,
  status: Array<GoodsSalesStatus>,
  categoryId?: string[],
  priceMin?: number,
  priceMax?: number,
  itemConditionId?: number[],
  shippingPayerId?: number[],
  pageSize: number;
}


