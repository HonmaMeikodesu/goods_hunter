package web

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/hunter"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/state"
)

type webSender struct {
	mu       sync.Mutex
	messages []model.Mail
}

func (s *webSender) Send(_ context.Context, message model.Mail) error {
	s.mu.Lock()
	s.messages = append(s.messages, message)
	s.mu.Unlock()
	return nil
}

func (s *webSender) firstText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.messages[0].Text
}

type webMarketplace struct{}

func (webMarketplace) Search(context.Context, model.Site, model.SearchCondition) ([]model.Item, error) {
	return nil, nil
}

func (webMarketplace) Snapshot(_ context.Context, _ model.Site, id string) (model.Snapshot, error) {
	return model.Snapshot{ID: id, Name: "item", Price: "100", Status: "on_sale"}, nil
}

func TestLegacyHTTPFlow(t *testing.T) {
	store, err := state.Open(filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	sender := &webSender{}
	accountModule := accounts.New(store, sender, accounts.Options{
		BaseURL: "https://hunter.example", SystemOwner: "owner@example.com",
		RegistrationTTL: time.Hour, SessionTTL: time.Hour,
	})
	hunterModule := hunter.New(store, webMarketplace{}, sender, "https://hunter.example", nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := hunterModule.Start(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		stopCtx, stop := context.WithTimeout(context.Background(), time.Second)
		defer stop()
		_ = hunterModule.Stop(stopCtx)
	}()
	handler := New(config.Config{}, accountModule, hunterModule, nil, nil).Handler()

	register := httptest.NewRequest(http.MethodPost, "/register", strings.NewReader("email=user%40example.com&password=secret"))
	register.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	registerResponse := httptest.NewRecorder()
	handler.ServeHTTP(registerResponse, register)
	assertCode(t, registerResponse, http.StatusOK, "200")
	marker := "Accept registration: "
	text := sender.firstText()
	confirmation, err := url.Parse(strings.TrimSpace(text[strings.Index(text, marker)+len(marker):]))
	if err != nil {
		t.Fatal(err)
	}
	confirmResponse := httptest.NewRecorder()
	handler.ServeHTTP(confirmResponse, httptest.NewRequest(http.MethodGet, "/register/confirm?code="+url.QueryEscape(confirmation.Query().Get("code")), nil))
	assertCode(t, confirmResponse, http.StatusOK, "200")

	login := httptest.NewRequest(http.MethodPost, "/login", strings.NewReader("email=user%40example.com&password=secret"))
	login.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	loginResponse := httptest.NewRecorder()
	handler.ServeHTTP(loginResponse, login)
	assertCode(t, loginResponse, http.StatusOK, "200")
	cookies := loginResponse.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "loginState" || !cookies[0].HttpOnly {
		t.Fatalf("unexpected login cookies: %#v", cookies)
	}

	createBody := `{"type":"Mercari","schedule":"*/5 * * * *","searchCondition":{"keyword":"doll"}}`
	create := httptest.NewRequest(http.MethodPost, "/goods/registerGoodsWatcher", strings.NewReader(createBody))
	create.Header.Set("Content-Type", "application/json")
	create.AddCookie(cookies[0])
	createResponse := httptest.NewRecorder()
	handler.ServeHTTP(createResponse, create)
	assertCode(t, createResponse, http.StatusOK, "200")
	var created struct {
		Code string `json:"code"`
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(createResponse.Body.Bytes(), &created); err != nil || created.Data.ID == "" {
		t.Fatalf("create response = %s, err = %v", createResponse.Body, err)
	}

	list := httptest.NewRequest(http.MethodGet, "/goods/listGoodsWatcher", nil)
	list.AddCookie(cookies[0])
	listResponse := httptest.NewRecorder()
	handler.ServeHTTP(listResponse, list)
	assertCode(t, listResponse, http.StatusOK, "200")
	if !strings.Contains(listResponse.Body.String(), created.Data.ID) || !strings.Contains(listResponse.Body.String(), `"type":"Mercari"`) {
		t.Fatalf("list response = %s", listResponse.Body)
	}

	updateBody := `{"id":"` + created.Data.ID + `","type":"Mercari","schedule":"0 * * * *","searchCondition":{"keyword":"figure"}}`
	update := httptest.NewRequest(http.MethodPost, "/goods/updateGoodsWatcher", strings.NewReader(updateBody))
	update.Header.Set("Content-Type", "application/json")
	update.AddCookie(cookies[0])
	updateResponse := httptest.NewRecorder()
	handler.ServeHTTP(updateResponse, update)
	assertCode(t, updateResponse, http.StatusOK, "200")

	remove := httptest.NewRequest(http.MethodGet, "/goods/unregisterGoodsWatcher?id="+url.QueryEscape(created.Data.ID)+"&type=Mercari", nil)
	remove.AddCookie(cookies[0])
	removeResponse := httptest.NewRecorder()
	handler.ServeHTTP(removeResponse, remove)
	assertCode(t, removeResponse, http.StatusOK, "200")

	unauthenticated := httptest.NewRecorder()
	handler.ServeHTTP(unauthenticated, httptest.NewRequest(http.MethodGet, "/goods/listGoodsWatcher", nil))
	if unauthenticated.Code != http.StatusFound || unauthenticated.Header().Get("Location") != "/" {
		t.Fatalf("unauthenticated response = %d, location %q", unauthenticated.Code, unauthenticated.Header().Get("Location"))
	}
}

func assertCode(t *testing.T, response *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()
	if response.Code != wantStatus {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body)
	}
	var payload struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v (%s)", err, response.Body)
	}
	if payload.Code != wantCode {
		t.Fatalf("code = %q, want %q", payload.Code, wantCode)
	}
}
