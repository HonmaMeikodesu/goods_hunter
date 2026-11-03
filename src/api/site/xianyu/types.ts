import { GoodsSearchConditionBase } from "../types";

export type XianyuSearchCondition = GoodsSearchConditionBase & {
  /** Prices entered by users are CNY yuan, with at most two decimal places. */
  minPrice?: number;
  maxPrice?: number;
  excludeKeywords?: string[];
  /** Every configured word must appear in the title; empty means no title filter. */
  includeKeywords?: string[];
  notifyExisting?: boolean;
};

export interface XianyuGoods {
  id: string;
  name: string;
  /** Integer CNY fen. Never reuse the JPY price field. */
  priceFen: number;
  thumbnailImageUrl: string;
  itemUrl: string;
  publishedAt: string | null;
}

export interface XianyuSearchRequest { keyword: string; }

export interface XianyuSearchResponse {
  success: boolean;
  source: "xianyu";
  keyword: string;
  page: 1;
  pageSize: 30;
  sort: "newest";
  currency: "CNY";
  resultState: "items" | "empty";
  hasMore: boolean;
  items: XianyuGoods[];
  fetchedAt: string;
  error?: string;
  code?: string;
}
