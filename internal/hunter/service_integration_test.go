package hunter

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
)

type fixtureCollector struct {
	search    func(model.Site, model.Condition) ([]model.Item, error)
	snapshot  model.Snapshot
	heartbeat string
}

func (f *fixtureCollector) Search(_ context.Context, site model.Site, c model.Condition) ([]model.Item, error) {
	return f.search(site, c)
}

func (f *fixtureCollector) Snapshot(context.Context, model.Condition) (model.Snapshot, error) {
	return f.snapshot, nil
}

func (f *fixtureCollector) YahooHeartbeat(context.Context) string { return f.heartbeat }

type fixtureSender struct {
	outbox []notify.Message
	fail   bool
}

func (f *fixtureSender) Send(_ context.Context, message notify.Message) error {
	if f.fail {
		return errors.New("fixture SMTP failure")
	}
	f.outbox = append(f.outbox, message)
	return nil
}

func TestStorageSchedulingAndNotifications(t *testing.T) {
	dsn, cacheURL := os.Getenv("GOODS_HUNTER_TEST_MYSQL_DSN"), os.Getenv("GOODS_HUNTER_TEST_REDIS_URL")
	if dsn == "" || cacheURL == "" {
		t.Skip("set the integration test MySQL DSN and Redis URL")
	}
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(dsn, location)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	raw, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	options, err := redis.ParseURL(cacheURL)
	if err != nil {
		t.Fatal(err)
	}
	cache := redis.NewClient(options)
	t.Cleanup(func() { cache.Close() })
	owner := model.NewID() + "@example.invalid"
	ctx := t.Context()
	if err := db.CreateUser(ctx, owner, model.NewID()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = raw.Exec("DELETE FROM `user` WHERE email=?", owner) })

	cfg := config.Config{Location: location, PublicURL: "https://watch.example.invalid",
		Email: config.Email{ContactSystemOwner: "operator@example.invalid"}}
	collector := &fixtureCollector{}
	sender := &fixtureSender{}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	newService := func() *Service {
		s := New(ctx, cfg, db, cache, collector, sender, logger)
		if err := s.Restore(ctx); err != nil {
			t.Fatal(err)
		}
		return s
	}

	// Seed the same MySQL columns used by Midway, including a pending Xianyu
	// row written before its image became available.
	mercariID, xianyuID := model.NewID(), model.NewID()
	seedSQL(t, raw, "INSERT INTO mercari_hunter(hunterInstanceId,userEmail,schedule,searchConditionSchema) VALUES (?,?,?,?)",
		mercariID, owner, "* * * * *", `{"keyword":"Mercari fixture"}`)
	seedSQL(t, raw, "INSERT INTO mercari_goods_record(hunterHunterInstanceId,id,name) VALUES (?,?,?)",
		mercariID, "m123", "Already seen")
	seedSQL(t, raw, "INSERT INTO xianyu_hunter(hunterInstanceId,userEmail,schedule,searchConditionSchema,initialized) VALUES (?,?,?,?,1)",
		xianyuID, owner, "* * * * *", `{"keyword":"Xianyu fixture","minPrice":0}`)
	seedSQL(t, raw, "INSERT INTO xianyu_goods_record(hunterInstanceId,id,name,priceFen,thumbnailImageUrl,itemUrl,notificationPending) VALUES (?,?,?,?,?,?,1)",
		xianyuID, "123", "<商品> 完整标题", 1499, "", "https://www.goofish.com/item?id=123")

	s := newService()
	collector.search = func(site model.Site, _ model.Condition) ([]model.Item, error) {
		if site == model.Xianyu {
			return []model.Item{{ID: "123", Image: "https://img.alicdn.com/fixture.jpg", Amount: 1499}}, nil
		}
		return []model.Item{{ID: "m123", Name: "Already seen"}, {ID: "m456", Name: "New item", Status: "STATUS_ON_SALE",
			URL: "https://jp.mercari.com/item/m456"}}, nil
	}
	run := func(site model.Site, id string) {
		t.Helper()
		j := s.findJob(jobKey{site, id})
		if j == nil {
			t.Fatal("watcher was not restored")
		}
		s.run(ctx, j, j.generation)
	}
	run(model.Mercari, mercariID)
	run(model.Mercari, mercariID)
	if len(sender.outbox) != 1 || strings.Contains(sender.outbox[0].HTML, "Already seen") ||
		!strings.Contains(sender.outbox[0].HTML, "价格暂缺") {
		t.Fatalf("legacy Mercari deduplication or rendering failed")
	}
	run(model.Xianyu, xianyuID)
	run(model.Xianyu, xianyuID)
	if len(sender.outbox) != 2 {
		t.Fatalf("pending Xianyu notification delivered %d times", len(sender.outbox)-1)
	}
	for _, want := range []string{"https://img.alicdn.com/fixture.jpg", "人民币 ¥14.99", "&lt;商品&gt; 完整标题", "-webkit-line-clamp:2"} {
		if !strings.Contains(sender.outbox[1].HTML, want) {
			t.Errorf("Xianyu notification missing %q", want)
		}
	}

	flea := model.Watcher{Site: model.YahooFleamarket, Owner: owner, Schedule: "* * * * *",
		Condition: `{"keyword":" 缶バッジ ","excludeKeywords":["B","a"]}`}
	if err := s.Register(ctx, flea); err != nil {
		t.Fatal(err)
	}
	list, err := s.List(ctx, owner)
	if err != nil || len(list) != 3 {
		t.Fatalf("unexpected watcher list: %v (%v)", list, err)
	}
	flea.ID = list[1].ID
	if list[1].Site != model.YahooFleamarket {
		t.Fatalf("unexpected watcher order: %v", list)
	}
	collector.search = func(model.Site, model.Condition) ([]model.Item, error) { return nil, market.TargetMismatch }
	run(model.YahooFleamarket, flea.ID)
	assertInitialized(t, db, flea, false)
	current := []model.Item{{ID: "h123", Name: "Skip first baseline", Amount: 500, Status: "OPEN"}}
	collector.search = func(model.Site, model.Condition) ([]model.Item, error) { return current, nil }
	run(model.YahooFleamarket, flea.ID)
	assertInitialized(t, db, flea, true)
	if len(sender.outbox) != 2 {
		t.Fatal("first baseline unexpectedly sent mail")
	}
	current = append(current, model.Item{ID: "h456", Name: "New after baseline", Amount: 850, Status: "OPEN"})
	sender.fail = true
	run(model.YahooFleamarket, flea.ID)
	sender.fail = false

	// A restart followed by an empty, valid scan still drains the persisted queue.
	s = newService()
	current = nil
	run(model.YahooFleamarket, flea.ID)
	run(model.YahooFleamarket, flea.ID)
	if len(sender.outbox) != 3 || !strings.Contains(sender.outbox[2].HTML, "New after baseline") {
		t.Fatal("pending Yahoo!フリマ notification was lost or duplicated")
	}
	flea.Schedule = "*/20 * * * *"
	flea.Condition = `{"keyword":"缶バッジ","excludeKeywords":[" A ","b","B"]}`
	if err := s.Update(ctx, flea); err != nil {
		t.Fatal(err)
	}
	assertInitialized(t, db, flea, true)

	inFlight := s.findJob(jobKey{flea.Site, flea.ID})
	started, release, completed := make(chan struct{}), make(chan struct{}), make(chan struct{})
	collector.search = func(model.Site, model.Condition) ([]model.Item, error) {
		close(started)
		<-release
		return []model.Item{{ID: "stale-h1", Name: "Stale scan", Amount: 1000, Status: "OPEN"}}, nil
	}
	go func() {
		defer close(completed)
		s.run(ctx, inFlight, inFlight.generation)
	}()
	<-started
	flea.Condition = `{"keyword":"別の缶バッジ"}`
	updateErr := s.Update(ctx, flea)
	close(release)
	<-completed
	if updateErr != nil {
		t.Fatal(updateErr)
	}
	assertInitialized(t, db, flea, false)
	if len(sender.outbox) != 3 {
		t.Fatal("stale scan sent mail after the condition changed")
	}

	detail := model.Watcher{Site: model.Surveillance, Owner: owner, Schedule: "0 * * * *", Condition: `{"type":"mercari","goodId":"m123"}`}
	collector.snapshot = model.Snapshot{ID: "m123", Name: "Fixture", Price: "¥123", Status: "on_sale"}
	if err := s.Register(ctx, detail); err != nil {
		t.Fatal(err)
	}
	if err := s.Register(ctx, detail); err != problem.DuplicateTask {
		t.Fatalf("duplicate surveillance = %v", err)
	}
	list, err = s.List(ctx, owner)
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range list {
		if w.Site == model.Surveillance {
			detail.ID = w.ID
		}
	}
	collector.snapshot.Price = "¥100"
	run(model.Surveillance, detail.ID)
	collector.snapshot.Status = "sold_out"
	run(model.Surveillance, detail.ID)
	if _, err := db.Watcher(ctx, model.Surveillance, detail.ID); !errors.Is(err, problem.TaskNotFound) {
		t.Fatalf("sold item task is still present: %v", err)
	}
	if len(sender.outbox) != 5 || !strings.Contains(sender.outbox[3].HTML, "¥123 →") ||
		!strings.Contains(sender.outbox[4].HTML, "已售出") {
		t.Fatal("single-item notifications were not delivered")
	}

	checkHealth(t, s, collector, sender, raw)
}

func seedSQL(t *testing.T, db *sql.DB, statement string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(t.Context(), statement, args...); err != nil {
		t.Fatal(err)
	}
}

func assertInitialized(t *testing.T, db *store.Store, w model.Watcher, want bool) {
	t.Helper()
	watcher, err := db.Watcher(t.Context(), w.Site, w.ID)
	if err != nil || watcher.Initialized != want {
		t.Fatalf("baseline initialized = %v, want %v (error %v)", watcher.Initialized, want, err)
	}
}

func checkHealth(t *testing.T, s *Service, collector *fixtureCollector, sender *fixtureSender, raw *sql.DB) {
	t.Helper()
	ctx := t.Context()
	date := time.Date(2035, 7, 22, 22, 0, 0, 0, s.cfg.Location)
	key := dailyReportPrefix + date.Format(time.DateOnly)
	if err := s.cache.Del(ctx, key, yahooAlertKey).Err(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.cache.Del(context.Background(), key, yahooAlertKey).Err() })
	t.Cleanup(func() {
		_, _ = raw.Exec("DELETE FROM search_scan_record WHERE completedAt>=? AND completedAt<?", "2035-07-21 23:59:59", "2035-07-23")
	})
	for _, record := range []struct {
		at      time.Time
		outcome string
	}{
		{date.Add(-time.Millisecond), "VALID"},
		{date.Add(-time.Hour), "CONNECTION_CLOSED"},
		{date, "INVALID_ITEMS"},
		{date.Add(-22*time.Hour - time.Millisecond), "INVALID_ITEMS"},
	} {
		if err := s.db.RecordScan(ctx, model.Yahoo, record.outcome, record.at); err != nil {
			t.Fatal(err)
		}
	}
	begin := len(sender.outbox)
	s.reportToday(ctx, date)
	s.reportToday(ctx, date)
	if len(sender.outbox) != begin+1 ||
		!strings.Contains(sender.outbox[begin].Text, "Yahoo!オークション｜共 2 次 · 有效 1 次 (50.0%) · 异常 1 次 (50.0%)") ||
		strings.Contains(sender.outbox[begin].Text, "商品列表无法解析") {
		t.Fatal("incorrect daily report window or cooldown")
	}
	for _, reason := range []string{"FC_CHECK_FAILED", "NEEDS_LOGIN", "OK", "COOKIES_EXPIRED"} {
		collector.heartbeat = reason
		s.checkYahoo(ctx)
	}
	if len(sender.outbox) != begin+2 || sender.outbox[begin+1].Subject != "Yahoo session needs login" ||
		!strings.Contains(sender.outbox[begin+1].Text, "(NEEDS_LOGIN)") {
		t.Fatal("Yahoo session alert misclassified or repeated")
	}
}

func TestFreezeAcrossMidnight(t *testing.T) {
	start, end := "23:30:00", "08:00:00"
	w := model.Watcher{FreezeStart: &start, FreezeEnd: &end}
	for _, tc := range []struct {
		hour, minute int
		want         bool
	}{{23, 29, false}, {23, 30, true}, {0, 15, true}, {7, 59, true}, {8, 0, false}} {
		now := time.Date(2026, 11, 20, tc.hour, tc.minute, 0, 0, time.UTC)
		if got := frozen(w, now); got != tc.want {
			t.Errorf("frozen at %s = %v, want %v", now.Format("15:04"), got, tc.want)
		}
	}
}
