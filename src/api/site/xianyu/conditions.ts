import { XianyuSearchCondition } from "./types";

export function yuanToFen(value: number): number {
  const fen = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(fen) || Math.abs(value * 100 - fen) > 0.000001) {
    throw new Error("闲鱼 prices must be nonnegative CNY amounts with at most two decimal places");
  }
  return fen;
}

export function normalizeXianyuCondition(value: XianyuSearchCondition): XianyuSearchCondition {
  if (!value || typeof value.keyword !== "string" || !value.keyword.trim() || value.keyword.trim().length > 100) {
    throw new Error("闲鱼 keyword must contain 1 to 100 characters");
  }
  if (Object.keys(value).some(key => !["keyword", "minPrice", "maxPrice", "includeKeywords", "excludeKeywords", "notifyExisting"].includes(key))) {
    throw new Error("闲鱼 currently supports only the newest first page and anonymous access");
  }
  for (const price of [value.minPrice, value.maxPrice]) {
    if (price !== undefined) yuanToFen(price);
  }
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    throw new Error("闲鱼 minPrice must not exceed maxPrice");
  }
  for (const words of [value.includeKeywords, value.excludeKeywords]) {
    if (words !== undefined && (!Array.isArray(words) || words.length > 30
      || words.some(word => typeof word !== "string" || !word.trim() || word.length > 100))) {
      throw new Error("闲鱼 title filters must contain at most 30 nonempty strings");
    }
  }
  if (value.notifyExisting !== undefined && typeof value.notifyExisting !== "boolean") {
    throw new Error("闲鱼 notifyExisting must be a boolean");
  }
  const normalizeWords = (words: string[] = []) => [...new Set(words.map(word => word.trim().toLowerCase()))].sort();
  return {
    keyword: value.keyword.trim(), minPrice: value.minPrice, maxPrice: value.maxPrice,
    includeKeywords: normalizeWords(value.includeKeywords), excludeKeywords: normalizeWords(value.excludeKeywords),
    notifyExisting: value.notifyExisting === true,
  };
}
