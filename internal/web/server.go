package web

import (
	"crypto/hmac"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strings"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/hunter"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

//go:embed login.html
var loginHTML string

type server struct {
	accounts  *accounts.Service
	hunters   *hunter.Service
	proxy     proxyConfig
	logger    *slog.Logger
	cookieKey string
	secure    bool
}

func New(cfg config.Config, accounts *accounts.Service, hunters *hunter.Service, logger *slog.Logger) (http.Handler, error) {
	proxy, err := newProxyConfig(cfg.ProxyPath, cfg.ProxyKey)
	if err != nil {
		return nil, err
	}
	s := &server{accounts: accounts, hunters: hunters, proxy: proxy, logger: logger,
		cookieKey: cfg.CookieKey, secure: strings.HasPrefix(cfg.PublicURL, "https://")}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", s.home)
	mux.HandleFunc("POST /login", s.login)
	mux.HandleFunc("POST /login/{$}", s.login)
	mux.HandleFunc("POST /register", s.register)
	mux.HandleFunc("POST /register/{$}", s.register)
	mux.HandleFunc("GET /register/confirm", s.confirm)
	mux.HandleFunc("GET /api/config/proxy", s.getProxy)
	mux.HandleFunc("POST /goods/registerGoodsWatcher", s.withLogin(s.registerWatcher))
	mux.HandleFunc("GET /goods/registerSurveillanceWatcher", s.withLogin(s.registerSurveillance))
	mux.HandleFunc("GET /goods/listGoodsWatcher", s.withLogin(s.listWatchers))
	mux.HandleFunc("POST /goods/updateGoodsWatcher", s.withLogin(s.updateWatcher))
	mux.HandleFunc("GET /goods/unregisterGoodsWatcher", s.withLogin(s.deleteWatcher))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, PATCH")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		mux.ServeHTTP(w, r)
	}), nil
}

type response struct {
	Code string `json:"code"`
	Data any    `json:"data,omitempty"`
	Msg  string `json:"msg,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (s *server) respond(w http.ResponseWriter, r *http.Request, data any, err error) {
	if err == nil {
		writeJSON(w, http.StatusOK, response{Code: "200", Data: data})
		return
	}
	var code problem.Code
	if errors.As(err, &code) {
		writeJSON(w, http.StatusBadRequest, response{Code: string(code)})
		return
	}
	s.logger.Error("HTTP request failed", "route", r.Pattern, "error", err)
	writeJSON(w, http.StatusInternalServerError, response{Code: "000000", Msg: "系统异常"})
}

func (s *server) home(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, loginHTML)
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func decodeJSON(r *http.Request, dest any) error {
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dest); err != nil || decoder.Decode(new(any)) != io.EOF {
		return problem.InvalidRequest
	}
	return nil
}

func readCredentials(r *http.Request) (credentials, error) {
	var input credentials
	kind, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if kind == "application/x-www-form-urlencoded" {
		if err := r.ParseForm(); err != nil {
			return input, problem.InvalidRequest
		}
		input.Email, input.Password = r.PostForm.Get("email"), r.PostForm.Get("password")
		return input, nil
	}
	err := decodeJSON(r, &input)
	return input, err
}

const loginCookie = "loginState"

func (s *server) login(w http.ResponseWriter, r *http.Request) {
	input, err := readCredentials(r)
	if err != nil {
		s.respond(w, r, nil, err)
		return
	}
	token, err := s.accounts.Login(r.Context(), input.Email, input.Password)
	if err == nil {
		cookie := http.Cookie{Name: loginCookie, Value: token, Path: "/",
			HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.secure || r.TLS != nil}
		http.SetCookie(w, &cookie)
		if s.cookieKey != "" {
			cookie.Name, cookie.Value = loginCookie+".sig", s.signCookie(token)
			http.SetCookie(w, &cookie)
		}
	}
	s.respond(w, r, nil, err)
}

func (s *server) signCookie(value string) string {
	mac := hmac.New(sha256.New, []byte(s.cookieKey))
	_, _ = io.WriteString(mac, loginCookie+"="+value)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (s *server) register(w http.ResponseWriter, r *http.Request) {
	input, err := readCredentials(r)
	if err == nil {
		err = s.accounts.Register(r.Context(), input.Email, input.Password)
	}
	s.respond(w, r, nil, err)
}

func (s *server) confirm(w http.ResponseWriter, r *http.Request) {
	s.respond(w, r, nil, s.accounts.Confirm(r.Context(), r.URL.Query().Get("code")))
}

func (s *server) getProxy(w http.ResponseWriter, r *http.Request) {
	payload, err := s.proxy.payload()
	if err != nil {
		s.respond(w, r, nil, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, payload)
}

type authedHandler func(*http.Request, string) (any, error)

func (s *server) withLogin(handler authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(loginCookie)
		if err != nil || cookie.Value == "" {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		if s.cookieKey != "" {
			sig, err := r.Cookie(loginCookie + ".sig")
			if err != nil || !hmac.Equal([]byte(sig.Value), []byte(s.signCookie(cookie.Value))) {
				s.respond(w, r, nil, problem.InvalidLogin)
				return
			}
		}
		owner, err := s.accounts.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			s.respond(w, r, nil, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		data, err := handler(r, owner)
		s.respond(w, r, data, err)
	}
}

type watcherBody struct {
	ID              string          `json:"id"`
	Site            model.Site      `json:"type"`
	Schedule        string          `json:"schedule"`
	FreezeStart     string          `json:"freezeStart"`
	FreezeEnd       string          `json:"freezeEnd"`
	SearchCondition json.RawMessage `json:"searchCondition"`
}

func readWatcher(r *http.Request, owner string) (model.Watcher, error) {
	var input watcherBody
	if err := decodeJSON(r, &input); err != nil {
		return model.Watcher{}, err
	}
	w := model.Watcher{Site: input.Site, ID: input.ID, Owner: owner, Schedule: input.Schedule, Condition: string(input.SearchCondition)}
	if input.FreezeStart != "" || input.FreezeEnd != "" {
		w.FreezeStart, w.FreezeEnd = &input.FreezeStart, &input.FreezeEnd
	}
	return w, nil
}

func (s *server) registerWatcher(r *http.Request, owner string) (any, error) {
	watcher, err := readWatcher(r, owner)
	if err != nil {
		return nil, err
	}
	return nil, s.hunters.Register(r.Context(), watcher)
}

func (s *server) registerSurveillance(r *http.Request, owner string) (any, error) {
	query := r.URL.Query()
	raw, _ := json.Marshal(map[string]string{"type": query.Get("type"), "goodId": query.Get("goodId")})
	start, end := "00:30", "08:00"
	return nil, s.hunters.Register(r.Context(), model.Watcher{
		Site: model.Surveillance, Owner: owner, Schedule: "0 * * * *", Condition: string(raw), FreezeStart: &start, FreezeEnd: &end,
	})
}

func (s *server) updateWatcher(r *http.Request, owner string) (any, error) {
	watcher, err := readWatcher(r, owner)
	if err != nil {
		return nil, err
	}
	return nil, s.hunters.Update(r.Context(), watcher)
}

func (s *server) deleteWatcher(r *http.Request, owner string) (any, error) {
	query := r.URL.Query()
	return nil, s.hunters.Delete(r.Context(), model.Site(query.Get("type")), query.Get("id"), owner)
}

type watcherRow struct {
	ID          string     `json:"hunterInstanceId"`
	Type        model.Site `json:"type,omitempty"`
	Schedule    string     `json:"schedule"`
	FreezeStart *string    `json:"freezingStart"`
	FreezeEnd   *string    `json:"freezingEnd"`
	Condition   string     `json:"searchConditionSchema"`
	Created     string     `json:"createdAt"`
	Updated     string     `json:"updatedAt"`
	Initialized *bool      `json:"initialized,omitempty"`
}

func (s *server) listWatchers(r *http.Request, owner string) (any, error) {
	watchers, err := s.hunters.List(r.Context(), owner)
	if err != nil {
		return nil, err
	}
	const dateFormat = "2006-01-02T15:04:05.000Z"
	rows := make([]any, 0, len(watchers))
	for _, w := range watchers {
		row := watcherRow{
			ID: w.ID, Schedule: w.Schedule, FreezeStart: w.FreezeStart, FreezeEnd: w.FreezeEnd, Condition: w.Condition,
			Created: w.CreatedAt.UTC().Format(dateFormat), Updated: w.UpdatedAt.UTC().Format(dateFormat),
		}
		if w.Site.UsesBaseline() {
			row.Type, row.Initialized = w.Site, &w.Initialized
		}
		if w.Site == model.Surveillance {
			rows = append(rows, struct {
				watcherRow
				Snapshot *string `json:"snapshot"`
			}{row, w.Snapshot})
		} else {
			rows = append(rows, row)
		}
	}
	return rows, nil
}
