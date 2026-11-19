import axios from "axios";

export const scanFailureLabels = {
  INVALID_REQUEST: "搜索条件或请求无效",
  FC_CONFIGURATION: "FC 配置缺失",
  FC_ACCESS_DENIED: "FC 鉴权失败",
  FC_REQUEST_FAILED: "FC 请求失败",
  FC_TIMEOUT: "FC 请求超时",
  INTERNAL_ERROR: "采集器内部错误",
  FETCH_FAILED: "浏览器抓取失败",
  FETCH_TIMEOUT: "浏览器抓取超时",
  CONNECTION_CLOSED: "上游连接关闭",
  CONNECTION_RESET: "上游连接重置",
  UPSTREAM_ERROR: "上游响应错误",
  RATE_LIMITED: "站点限流",
  ACCESS_DENIED: "站点拒绝访问",
  CLOUDFLARE_CHALLENGE: "Cloudflare 验证",
  CHALLENGE_REQUIRED: "站点要求安全验证",
  LOGIN_REQUIRED: "站点要求登录",
  SESSION_PENDING: "会话仍在刷新",
  COOKIES_EXPIRED: "Yahoo Cookie 已过期",
  COOKIES_MISSING: "Yahoo Cookie 缺失",
  STATE_STALE: "Yahoo 会话状态过旧",
  STATE_UNREADABLE: "Yahoo 会话文件无法读取",
  STATE_INVALID: "Yahoo 会话状态无效",
  COOKIE_INVALID: "Yahoo Cookie 无效",
  COOKIE_DOMAIN_INVALID: "Yahoo Cookie 域名无效",
  LEGACY_UNREADABLE: "Yahoo Cookie 文件无法读取",
  SEARCH_TIMEOUT: "目标搜索响应未到达",
  TARGET_MISMATCH: "返回页与目标搜索不符",
  EMPTY_CONTENT: "FC 返回空内容",
  UNVERIFIED_RESULTS: "页面无法证实有结果或明确为空",
  INVALID_PAGE: "搜索页结构异常",
  INVALID_RESPONSE: "搜索响应结构异常",
  INVALID_ITEMS: "商品列表无法解析",
  UNKNOWN: "其他异常",
} as const;

export type ScanFailure = keyof typeof scanFailureLabels;

export class SearchScanError extends Error {
  constructor(public readonly code: ScanFailure, message: string = scanFailureLabels[code]) {
    super(message);
    this.name = "SearchScanError";
  }
}

export function knownScanFailure(code: unknown): ScanFailure | undefined {
  if (code === "FC_NEEDS_LOGIN" || code === "NEEDS_LOGIN") return "LOGIN_REQUIRED";
  if (typeof code === "string" && Object.prototype.hasOwnProperty.call(scanFailureLabels, code)) {
    return code as ScanFailure;
  }
}

export function scanFailureReason(error: unknown): ScanFailure {
  if (axios.isAxiosError(error)) {
    const code = knownScanFailure(error.response?.data?.code);
    if (code) return code;
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT" || error.response?.status === 504) {
      return "FC_TIMEOUT";
    }
    if (error.response?.status === 429) return "RATE_LIMITED";
    if (error.response?.status === 401 || error.response?.status === 403) return "FC_ACCESS_DENIED";
    return "FC_REQUEST_FAILED";
  }
  if (error instanceof Error) {
    return knownScanFailure((error as Error & { code?: unknown }).code) || "UNKNOWN";
  }
  return "UNKNOWN";
}

export function readSearchCondition<T>(schema: string, normalize?: (value: T) => T): T {
  try {
    const parsed = JSON.parse(schema);
    if (!parsed || typeof parsed.keyword !== "string" || !parsed.keyword.trim()) {
      throw new Error("Invalid keyword");
    }
    return normalize ? normalize(parsed) : parsed;
  } catch {
    throw new SearchScanError("INVALID_REQUEST");
  }
}
