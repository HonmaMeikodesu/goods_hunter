import { YahooFleamarketSearchCondition } from "./types";

export function normalizeYahooFleamarketCondition(value: YahooFleamarketSearchCondition): YahooFleamarketSearchCondition {
  if (!value || typeof value.keyword !== "string" || !value.keyword.trim() || value.keyword.trim().length > 200) {
    throw new Error("Yahoo!フリマ keyword must contain 1 to 200 characters");
  }
  const epoch = value.epoch === undefined ? 1 : value.epoch;
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 3) {
    throw new Error("Yahoo!フリマ epoch must be between 1 and 3");
  }
  for (const price of [value.minPrice, value.maxPrice]) {
    if (price !== undefined && (!Number.isSafeInteger(price) || price < 0)) {
      throw new Error("Yahoo!フリマ prices must be nonnegative JPY integers");
    }
  }
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    throw new Error("Yahoo!フリマ minPrice must not exceed maxPrice");
  }
  if (value.excludeKeywords !== undefined && (!Array.isArray(value.excludeKeywords)
    || value.excludeKeywords.length > 30 || value.excludeKeywords.some(word => typeof word !== "string" || !word.trim() || word.length > 200))) {
    throw new Error("Yahoo!フリマ excludeKeywords must contain at most 30 nonempty strings");
  }
  if (value.notifyExisting !== undefined && typeof value.notifyExisting !== "boolean") {
    throw new Error("Yahoo!フリマ notifyExisting must be a boolean");
  }
  return {
    keyword: value.keyword.trim(),
    epoch,
    minPrice: value.minPrice,
    maxPrice: value.maxPrice,
    excludeKeywords: [...new Set((value.excludeKeywords || []).map(word => word.trim().toLowerCase()))].sort(),
    notifyExisting: value.notifyExisting === true,
  };
}
