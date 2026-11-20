package market

import "errors"

type Failure string

func (f Failure) Error() string { return string(f) }

const (
	InvalidRequest    Failure = "INVALID_REQUEST"
	FCConfiguration   Failure = "FC_CONFIGURATION"
	FCAccessDenied    Failure = "FC_ACCESS_DENIED"
	FCRequestFailed   Failure = "FC_REQUEST_FAILED"
	FCTimeout         Failure = "FC_TIMEOUT"
	FetchFailed       Failure = "FETCH_FAILED"
	FetchTimeout      Failure = "FETCH_TIMEOUT"
	ConnectionClosed  Failure = "CONNECTION_CLOSED"
	ConnectionReset   Failure = "CONNECTION_RESET"
	RateLimited       Failure = "RATE_LIMITED"
	Cloudflare        Failure = "CLOUDFLARE_CHALLENGE"
	LoginRequired     Failure = "LOGIN_REQUIRED"
	CookiesExpired    Failure = "COOKIES_EXPIRED"
	CookiesMissing    Failure = "COOKIES_MISSING"
	StateStale        Failure = "STATE_STALE"
	StateUnreadable   Failure = "STATE_UNREADABLE"
	StateInvalid      Failure = "STATE_INVALID"
	CookieInvalid     Failure = "COOKIE_INVALID"
	CookieDomain      Failure = "COOKIE_DOMAIN_INVALID"
	LegacyUnreadable  Failure = "LEGACY_UNREADABLE"
	TargetMismatch    Failure = "TARGET_MISMATCH"
	EmptyContent      Failure = "EMPTY_CONTENT"
	UnverifiedResults Failure = "UNVERIFIED_RESULTS"
	InvalidResponse   Failure = "INVALID_RESPONSE"
	InvalidItems      Failure = "INVALID_ITEMS"
	Unknown           Failure = "UNKNOWN"
)

var Labels = map[Failure]string{
	InvalidRequest: "搜索条件或请求无效", FCConfiguration: "FC 配置缺失",
	FCAccessDenied: "FC 鉴权失败", FCRequestFailed: "FC 请求失败", FCTimeout: "FC 请求超时",
	"INTERNAL_ERROR": "采集器内部错误", FetchFailed: "浏览器抓取失败", FetchTimeout: "浏览器抓取超时",
	ConnectionClosed: "上游连接关闭", ConnectionReset: "上游连接重置", "UPSTREAM_ERROR": "上游响应错误",
	RateLimited: "站点限流", "ACCESS_DENIED": "站点拒绝访问", Cloudflare: "Cloudflare 验证",
	"CHALLENGE_REQUIRED": "站点要求安全验证", LoginRequired: "站点要求登录", "SESSION_PENDING": "会话仍在刷新",
	CookiesExpired: "Yahoo Cookie 已过期", CookiesMissing: "Yahoo Cookie 缺失",
	StateStale: "Yahoo 会话状态过旧", StateUnreadable: "Yahoo 会话文件无法读取",
	StateInvalid: "Yahoo 会话状态无效", CookieInvalid: "Yahoo Cookie 无效",
	CookieDomain: "Yahoo Cookie 域名无效", LegacyUnreadable: "Yahoo Cookie 文件无法读取",
	"SEARCH_TIMEOUT": "目标搜索响应未到达", TargetMismatch: "返回页与目标搜索不符",
	EmptyContent: "FC 返回空内容", UnverifiedResults: "页面无法证实有结果或明确为空",
	"INVALID_PAGE": "搜索页结构异常", InvalidResponse: "搜索响应结构异常",
	InvalidItems: "商品列表无法解析", Unknown: "其他异常",
}

func FailureOf(err error) Failure {
	if err == nil {
		return "VALID"
	}
	var failure Failure
	if errors.As(err, &failure) {
		if known := knownFailure(string(failure)); known != "" {
			return known
		}
	}
	return Unknown
}

func knownFailure(code string) Failure {
	switch code {
	case "NEEDS_LOGIN", "FC_NEEDS_LOGIN":
		return LoginRequired
	}
	failure := Failure(code)
	if _, exists := Labels[failure]; exists {
		return failure
	}
	return ""
}
