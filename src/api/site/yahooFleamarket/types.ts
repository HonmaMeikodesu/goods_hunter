import { GoodsSearchConditionBase } from "../types";

export type YahooFleamarketSearchCondition = GoodsSearchConditionBase & {
  epoch?: number;
  minPrice?: number;
  maxPrice?: number;
  excludeKeywords?: string[];
  notifyExisting?: boolean;
};

export interface YahooFleamarketGoods {
  id: string;
  name: string;
  price: number;
  status: string;
  thumbnailImageUrl: string;
  itemUrl: string;
  openTime?: string;
}

export interface YahooFleamarketPageRequest {
  keyword: string;
  page: number;
  onSaleOnly: boolean;
}

export interface YahooFleamarketPageResponse {
  success: boolean;
  source: "yahooFleamarket";
  keyword: string;
  page: number;
  offset: number;
  totalResultsAvailable: number;
  items: YahooFleamarketGoods[];
  fetchedAt: string;
  error?: string;
  code?: string;
}
