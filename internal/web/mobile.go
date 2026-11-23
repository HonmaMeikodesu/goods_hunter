package web

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

func (s *server) registerMobileRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/mobile/login", s.mobileLogin)
	mux.HandleFunc("GET /api/mobile/state", s.withMobileLogin(s.mobileState))
	mux.HandleFunc("POST /api/mobile/mode", s.withMobileLogin(s.mobileMode))
	mux.HandleFunc("POST /api/mobile/scan", s.withMobileLogin(s.mobileScan))
	mux.HandleFunc("GET /api/mobile/products", s.withMobileLogin(s.mobileProducts))
	mux.HandleFunc("POST /api/mobile/viewed", s.withMobileLogin(s.mobileViewed))
}

func (s *server) mobileLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input credentials
	if err := decodeJSON(r, &input); err != nil {
		s.respond(w, r, nil, err)
		return
	}
	token, err := s.accounts.Login(r.Context(), input.Email, input.Password)
	s.respond(w, r, map[string]string{"token": token}, err)
}

func (s *server) withMobileLogin(handler authedHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
		if !strings.EqualFold(scheme, "Bearer") || token == "" {
			writeJSON(w, http.StatusUnauthorized, response{Code: string(problem.InvalidLogin)})
			return
		}
		owner, err := s.accounts.Authenticate(r.Context(), token)
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
