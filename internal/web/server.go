// Package web maps the legacy HTTP routes onto the account and hunter modules.
package web

import (
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/cipher"
	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/hunter"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

const maxRequestBody = 1 << 20

type Server struct {
	accounts        *accounts.Module
	hunters         *hunter.Module
	cipher          *cipher.Module
	proxyConfigPath string
	secureCookie    bool
	logger          *slog.Logger
	handler         http.Handler
}

func New(cfg config.Config, accountModule *accounts.Module, hunterModule *hunter.Module, cipherModule *cipher.Module, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	server := &Server{
		accounts: accountModule, hunters: hunterModule, cipher: cipherModule,
		proxyConfigPath: cfg.ProxyConfigPath, secureCookie: cfg.SecureCookie, logger: logger,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", server.endpoint(server.home))
	mux.HandleFunc("POST /login", server.endpoint(server.login))
	mux.HandleFunc("POST /login/", server.endpoint(server.login))
	mux.HandleFunc("POST /register", server.endpoint(server.register))
	mux.HandleFunc("POST /register/", server.endpoint(server.register))
	mux.HandleFunc("GET /register/confirm", server.endpoint(server.confirmRegister))
	mux.HandleFunc("GET /api/config/proxy", server.endpoint(server.proxyConfig))
	mux.HandleFunc("POST /goods/registerGoodsWatcher", server.authenticated(server.registerWatcher))
	mux.HandleFunc("GET /goods/registerSurveillanceWatcher", server.authenticated(server.registerSurveillance))
	mux.HandleFunc("GET /goods/unregisterGoodsWatcher", server.authenticated(server.unregisterWatcher))
	mux.HandleFunc("GET /goods/listGoodsWatcher", server.authenticated(server.listWatchers))
	mux.HandleFunc("POST /goods/updateGoodsWatcher", server.authenticated(server.updateWatcher))
	server.handler = server.middleware(mux)
	return server
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

type endpointFunc func(http.ResponseWriter, *http.Request) error

func (s *Server) endpoint(next endpointFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := next(w, r); err != nil {
			s.writeError(w, err)
		}
	}
}

type authenticatedFunc func(http.ResponseWriter, *http.Request, string) error

func (s *Server) authenticated(next authenticatedFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("loginState")
		if errors.Is(err, http.ErrNoCookie) || cookie.Value == "" {
			http.Redirect(w, r, "/", http.StatusFound)
			return
		}
		if err != nil {
			s.writeError(w, problem.ErrInvalidLoginState)
			return
		}
		email, err := s.accounts.Authenticate(r.Context(), cookie.Value)
		if err != nil {
			s.writeError(w, err)
			return
		}
		if err := next(w, r, email); err != nil {
			s.writeError(w, err)
		}
	}
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tracked := &trackingWriter{ResponseWriter: w}
		tracked.Header().Set("Access-Control-Allow-Origin", "*")
		tracked.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,POST,DELETE,PATCH,OPTIONS")
		tracked.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		tracked.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Method == http.MethodOptions {
			tracked.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("HTTP handler panicked", "panic", recovered)
				if !tracked.wroteHeader {
					s.writeError(tracked, fmt.Errorf("handler panic: %v", recovered))
				}
			}
		}()
		next.ServeHTTP(tracked, r)
	})
}

func (s *Server) home(w http.ResponseWriter, _ *http.Request) error {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	return homeTemplate.Execute(w, nil)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) error {
	email, password, err := credentials(w, r)
	if err != nil {
		return err
	}
	token, expiresAt, err := s.accounts.Login(r.Context(), email, password)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: "loginState", Value: token, Path: "/", Expires: expiresAt,
		HttpOnly: true, Secure: s.secureCookie, SameSite: http.SameSiteLaxMode,
	})
	return writeOK(w, nil)
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) error {
	email, password, err := credentials(w, r)
	if err != nil {
		return err
	}
	if err := s.accounts.Register(r.Context(), email, password); err != nil {
		return err
	}
	return writeOK(w, nil)
}

func credentials(w http.ResponseWriter, r *http.Request) (string, string, error) {
	if isJSON(r) {
		var request struct {
			Email    string `json:"email"`
			Password string `json:"password"`
		}
		if err := decodeJSON(w, r, &request); err != nil {
			return "", "", err
		}
		return request.Email, request.Password, nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	if err := r.ParseForm(); err != nil {
		return "", "", problem.ErrInvalidRequest
	}
	return r.FormValue("email"), r.FormValue("password"), nil
}

func (s *Server) confirmRegister(w http.ResponseWriter, r *http.Request) error {
	if err := s.accounts.Confirm(r.Context(), r.URL.Query().Get("code")); err != nil {
		return err
	}
	return writeOK(w, nil)
}

func (s *Server) proxyConfig(w http.ResponseWriter, r *http.Request) error {
	if s.cipher == nil {
		return fmt.Errorf("proxy cipher is not configured")
	}
	info, err := os.Stat(s.proxyConfigPath)
	if err != nil {
		return fmt.Errorf("read proxy configuration: %w", err)
	}
	if info.Size() > 2<<20 {
		return fmt.Errorf("proxy configuration exceeds 2 MiB")
	}
	raw, err := os.ReadFile(s.proxyConfigPath)
	if err != nil {
		return fmt.Errorf("read proxy configuration: %w", err)
	}
	payload, err := s.cipher.Encode(string(raw))
	if err != nil {
		return err
	}
	return writeOK(w, payload)
}

type watcherRequest struct {
	ID              string           `json:"id"`
	Type            model.HunterType `json:"type"`
	Schedule        string           `json:"schedule"`
	FreezeStart     string           `json:"freezeStart"`
	FreezeEnd       string           `json:"freezeEnd"`
	SearchCondition json.RawMessage  `json:"searchCondition"`
}

func parseWatcherRequest(w http.ResponseWriter, r *http.Request) (watcherRequest, error) {
	if isJSON(r) {
		var request watcherRequest
		if err := decodeJSON(w, r, &request); err != nil {
			return watcherRequest{}, err
		}
		return request, nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	if err := r.ParseForm(); err != nil {
		return watcherRequest{}, problem.ErrInvalidRequest
	}
	rawCondition := strings.TrimSpace(r.FormValue("searchCondition"))
	if !json.Valid([]byte(rawCondition)) {
		return watcherRequest{}, problem.ErrInvalidRequest
	}
	return watcherRequest{
		ID: r.FormValue("id"), Type: model.HunterType(r.FormValue("type")), Schedule: r.FormValue("schedule"),
		FreezeStart: r.FormValue("freezeStart"), FreezeEnd: r.FormValue("freezeEnd"), SearchCondition: json.RawMessage(rawCondition),
	}, nil
}

func (s *Server) registerWatcher(w http.ResponseWriter, r *http.Request, email string) error {
	request, err := parseWatcherRequest(w, r)
	if err != nil {
		return err
	}
	id, err := s.hunters.Hire(r.Context(), email, hunter.HireInput{
		Type: request.Type, Schedule: request.Schedule, FreezeStart: request.FreezeStart,
		FreezeEnd: request.FreezeEnd, SearchCondition: request.SearchCondition,
	})
	if err != nil {
		return err
	}
	return writeOK(w, map[string]string{"id": id})
}

func (s *Server) registerSurveillance(w http.ResponseWriter, r *http.Request, email string) error {
	condition, err := json.Marshal(model.SurveillanceCondition{
		Type: model.Site(r.URL.Query().Get("type")), GoodID: r.URL.Query().Get("goodId"),
	})
	if err != nil {
		return err
	}
	id, err := s.hunters.Hire(r.Context(), email, hunter.HireInput{
		Type: model.HunterSurveillance, Schedule: "0 * * * *", FreezeStart: "00:30", FreezeEnd: "08:00", SearchCondition: condition,
	})
	if err != nil {
		return err
	}
	return writeOK(w, map[string]string{"id": id})
}

func (s *Server) unregisterWatcher(w http.ResponseWriter, r *http.Request, email string) error {
	if err := s.hunters.Delete(r.Context(), email, r.URL.Query().Get("id"), model.HunterType(r.URL.Query().Get("type"))); err != nil {
		return err
	}
	return writeOK(w, nil)
}

type watcherResponse struct {
	HunterInstanceID      string           `json:"hunterInstanceId"`
	Type                  model.HunterType `json:"type"`
	FreezingStart         string           `json:"freezingStart,omitempty"`
	FreezingEnd           string           `json:"freezingEnd,omitempty"`
	Schedule              string           `json:"schedule"`
	SearchConditionSchema string           `json:"searchConditionSchema"`
	Snapshot              string           `json:"snapshot,omitempty"`
	CreatedAt             time.Time        `json:"createdAt"`
	UpdatedAt             time.Time        `json:"updatedAt"`
}

func (s *Server) listWatchers(w http.ResponseWriter, r *http.Request, email string) error {
	watchers, err := s.hunters.List(r.Context(), email)
	if err != nil {
		return err
	}
	response := make([]watcherResponse, 0, len(watchers))
	for _, watcher := range watchers {
		response = append(response, watcherResponse{
			HunterInstanceID: watcher.HunterInstanceID, Type: watcher.Type,
			FreezingStart: watcher.FreezingStart, FreezingEnd: watcher.FreezingEnd,
			Schedule: watcher.Schedule, SearchConditionSchema: watcher.SearchConditionSchema,
			Snapshot: watcher.Snapshot, CreatedAt: watcher.CreatedAt, UpdatedAt: watcher.UpdatedAt,
		})
	}
	return writeOK(w, response)
}

func (s *Server) updateWatcher(w http.ResponseWriter, r *http.Request, email string) error {
	request, err := parseWatcherRequest(w, r)
	if err != nil {
		return err
	}
	if err := s.hunters.Update(r.Context(), email, hunter.UpdateInput{
		ID: request.ID, Type: request.Type, Schedule: request.Schedule,
		FreezeStart: request.FreezeStart, FreezeEnd: request.FreezeEnd, SearchCondition: request.SearchCondition,
	}); err != nil {
		return err
	}
	return writeOK(w, nil)
}

func isJSON(r *http.Request) bool {
	return strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json")
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBody)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		return problem.ErrInvalidRequest
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return problem.ErrInvalidRequest
	}
	return nil
}

type envelope struct {
	Code string `json:"code"`
	Data any    `json:"data,omitempty"`
	Msg  string `json:"msg,omitempty"`
}

func writeOK(w http.ResponseWriter, data any) error {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(envelope{Code: "200", Data: data})
}

func (s *Server) writeError(w http.ResponseWriter, err error) {
	public, ok := problem.Public(err)
	status := http.StatusInternalServerError
	response := envelope{Code: "000000", Msg: "系统异常"}
	if ok {
		status = public.HTTPStatus
		response.Code = public.Code
	} else {
		s.logger.Error("request failed", "error", err)
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}

type trackingWriter struct {
	http.ResponseWriter
	wroteHeader bool
}

func (w *trackingWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *trackingWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (w *trackingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

var homeTemplate = template.Must(template.New("home").Parse(homePage))
