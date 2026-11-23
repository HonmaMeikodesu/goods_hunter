package web

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

func (s *server) registerMobileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/mobile/login", s.mobileHTTPS(s.mobileLogin))
	mux.HandleFunc("POST /api/mobile/logout", s.mobileHTTPS(s.withMobileLogin(s.mobileLogout)))
	mux.HandleFunc("GET /api/mobile/state", s.mobileHTTPS(s.withMobileLogin(s.mobileState)))
	mux.HandleFunc("GET /api/mobile/tasks", s.mobileHTTPS(s.withMobileLogin(s.mobileTasks)))
	mux.HandleFunc("POST /api/mobile/mode", s.mobileHTTPS(s.withMobileLogin(s.mobileMode)))
	mux.HandleFunc("POST /api/mobile/scan", s.mobileHTTPS(s.withMobileLogin(s.mobileScan)))
	mux.HandleFunc("GET /api/mobile/products", s.mobileHTTPS(s.withMobileLogin(s.mobileProducts)))
	mux.HandleFunc("POST /api/mobile/viewed", s.mobileHTTPS(s.withMobileLogin(s.mobileViewed)))
}

func (s *server) mobileHTTPS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		peer, _, _ := net.SplitHostPort(r.RemoteAddr)
		local := net.ParseIP(peer).IsLoopback()
		if r.TLS != nil || (local && s.mobile.Origin == "") ||
			(local && "https://"+r.Host == s.mobile.Origin && r.Header.Get("X-Forwarded-Proto") == "https") {
			next(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if s.mobile.Origin != "" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			http.Redirect(w, r, s.mobile.Origin+r.URL.EscapedPath(), http.StatusPermanentRedirect)
			return
		}
		writeJSON(w, http.StatusUpgradeRequired, response{Code: string(problem.ConnectionCode), Msg: "请使用 HTTPS"})
	}
}

func (s *server) validConnectionCode(code string) bool {
	provided, expected := sha256.Sum256([]byte(strings.TrimSpace(code))), sha256.Sum256([]byte(s.mobile.Code))
	return len(s.mobile.Code) >= 32 && subtle.ConstantTimeCompare(provided[:], expected[:]) == 1
}

func (s *server) mobileLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input struct {
		credentials
		ConnectionCode string `json:"connectionCode"`
	}
	if err := decodeJSON(r, &input); err != nil {
		s.respond(w, r, nil, err)
		return
	}
	if !s.validConnectionCode(input.ConnectionCode) {
		writeJSON(w, http.StatusForbidden, response{Code: string(problem.ConnectionCode)})
		return
	}
	token, err := s.accounts.MobileLogin(r.Context(), input.Email, input.Password, s.mobile.Code)
	s.respond(w, r, map[string]string{"token": token}, err)
}

func mobileToken(r *http.Request) string {
	scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
	if strings.EqualFold(scheme, "Bearer") {
		return token
	}
	return ""
}

func (s *server) mobileLogout(r *http.Request, _ string) (any, error) {
	return nil, s.accounts.LogoutMobile(r.Context(), s.mobile.Code, mobileToken(r))
}

func (s *server) withMobileLogin(handler authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		token := mobileToken(r)
		if token == "" {
			writeJSON(w, http.StatusUnauthorized, response{Code: string(problem.InvalidLogin)})
			return
		}
		owner, err := s.accounts.AuthenticateMobile(r.Context(), s.mobile.Code, token)
		switch {
		case errors.Is(err, problem.InvalidLogin), errors.Is(err, problem.ExpiredLogin):
			writeJSON(w, http.StatusUnauthorized, response{Code: err.Error()})
			return
		case err != nil:
			s.respond(w, r, nil, err)
			return
		}
		data, err := handler(r, owner)
		s.respond(w, r, data, err)
	}
}

func (s *server) mobileState(r *http.Request, owner string) (any, error) {
	return s.hunters.ActiveState(r.Context(), owner)
}

type mobileSearchTask struct {
	ID        string `json:"id"`
	Keyword   string `json:"keyword"`
	SearchURL string `json:"searchUrl,omitempty"`
	AdultMode bool   `json:"adultMode,omitempty"`
	AdultOnly bool   `json:"adultOnly,omitempty"`
}

type mobileSiteTasks struct {
	Site               model.Site         `json:"site"`
	AdultModeSupported bool               `json:"adultModeSupported"`
	Tasks              []mobileSearchTask `json:"tasks"`
}

func (s *server) mobileTasks(r *http.Request, owner string) (any, error) {
	watchers, err := s.hunters.List(r.Context(), owner)
	if err != nil {
		return nil, err
	}
	groups := make([]mobileSiteTasks, 0, len(model.Sites))
	indices := make(map[model.Site]int, len(model.Sites))
	for _, watcher := range watchers {
		if watcher.Site == model.Surveillance {
			continue
		}
		index, found := indices[watcher.Site]
		if !found {
			index = len(groups)
			indices[watcher.Site] = index
			groups = append(groups, mobileSiteTasks{Site: watcher.Site, AdultModeSupported: watcher.Site == model.Surugaya})
		}
		group := &groups[index]
		task := mobileSearchTask{ID: watcher.ID}
		if condition, err := model.ReadCondition(watcher.Site, watcher.Condition); err == nil {
			task.Keyword = condition.Keyword
			task.SearchURL = market.SearchURL(watcher.Site, condition)
			task.AdultMode = group.AdultModeSupported && condition.AdultMode
			task.AdultOnly = task.AdultMode && condition.AdultOnly
		}
		group.Tasks = append(group.Tasks, task)
	}
	return groups, nil
}

func (s *server) mobileMode(r *http.Request, owner string) (any, error) {
	var input struct{ Active *bool }
	if err := decodeJSON(r, &input); err != nil || input.Active == nil {
		return nil, problem.InvalidRequest
	}
	if err := s.hunters.SetActiveMode(r.Context(), owner, *input.Active); err != nil {
		return nil, err
	}
	return s.hunters.ActiveState(r.Context(), owner)
}

func (s *server) mobileScan(r *http.Request, owner string) (any, error) {
	var input struct{ Site model.Site }
	if err := decodeJSON(r, &input); err != nil {
		return nil, err
	}
	return s.hunters.StartScan(r.Context(), owner, input.Site)
}

type mobileProduct struct {
	ID      uint64     `json:"id,string"`
	Site    model.Site `json:"site"`
	Name    string     `json:"name"`
	Price   string     `json:"price"`
	URL     string     `json:"url"`
	Image   string     `json:"image"`
	Sold    bool       `json:"sold"`
	FoundAt time.Time  `json:"foundAt"`
}

func (s *server) mobileProducts(r *http.Request, owner string) (any, error) {
	products, err := s.hunters.ActiveProducts(r.Context(), owner)
	if err != nil {
		return nil, err
	}
	rows := make([]mobileProduct, 0, len(products))
	for _, product := range products {
		item := product.Item
		rows = append(rows, mobileProduct{ID: product.ID, Site: product.Site, Name: item.Name,
			Price: item.SearchPrice(product.Site), URL: item.URL, Image: item.Image, FoundAt: product.FoundAt,
			Sold: product.Site == model.Mercari && item.Status != "STATUS_ON_SALE"})
	}
	return rows, nil
}

func (s *server) mobileViewed(r *http.Request, owner string) (any, error) {
	var input struct{ IDs []string }
	if err := decodeJSON(r, &input); err != nil || len(input.IDs) == 0 {
		return nil, problem.InvalidRequest
	}
	ids := make([]uint64, 0, len(input.IDs))
	for _, raw := range input.IDs {
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || id == 0 {
			return nil, problem.InvalidRequest
		}
		ids = append(ids, id)
	}
	return nil, s.hunters.MarkActiveProductsViewed(r.Context(), owner, ids)
}
