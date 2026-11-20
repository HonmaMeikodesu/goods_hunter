package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/hunter"
	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/store"
	"github.com/HonmaMeikodesu/goods_hunter/internal/web"
)

type options struct {
	initialize   bool
	check        bool
	yahooSession bool
	fleaKeyword  string
}

func main() {
	var opts options
	flag.BoolVar(&opts.initialize, "init-db", false, "create missing tables in an existing MySQL database and exit")
	flag.BoolVar(&opts.check, "check", false, "check the database, Redis and application configuration without starting jobs")
	flag.BoolVar(&opts.yahooSession, "check-yahoo-session", false, "check the managed Yahoo session via FC and exit")
	flag.StringVar(&opts.fleaKeyword, "check-yahoo-fleamarket", "", "read one page from Yahoo!フリマ FC and exit")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	logger := slog.New(slog.NewTextHandler(os.Stderr, nil))
	if err := run(ctx, opts, logger); err != nil {
		logger.Error("goods-hunter", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, opts options, logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	collector := market.New(cfg.FC, cfg.Yahoo)
	if opts.yahooSession {
		if cfg.Yahoo.SessionFile == "" {
			return errors.New("YAHOO_SESSION_FILE is required")
		}
		reason := collector.YahooHeartbeat(ctx)
		_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"result": reason == "OK", "reason": reason})
		if reason != "OK" {
			return errors.New("Yahoo session check failed")
		}
		return nil
	}
	if opts.fleaKeyword != "" {
		raw, _ := json.Marshal(map[string]string{"keyword": opts.fleaKeyword})
		condition, err := model.ReadCondition(model.YahooFleamarket, string(raw))
		if err != nil {
			return err
		}
		items, err := collector.Search(ctx, model.YahooFleamarket, condition)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]any{"success": true, "count": len(items)})
	}
	db, err := store.Open(cfg.MySQLDSN, cfg.Location)
	if err != nil {
		return err
	}
	defer db.Close()
	setup, cancelSetup := context.WithTimeout(ctx, 30*time.Second)
	defer cancelSetup()
	if opts.initialize {
		return db.InitSchema(setup)
	}
	if err := db.Check(setup); err != nil {
		return err
	}
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return errors.New("invalid GOODS_HUNTER_REDIS_URL")
	}
	redisOpts.ContextTimeoutEnabled = true
	cache := redis.NewClient(redisOpts)
	defer cache.Close()
	if err := cache.Ping(setup).Err(); err != nil {
		return fmt.Errorf("connect to Redis: %w", err)
	}
	sender := notify.SMTP{Email: cfg.Email}
	runCtx, cancelJobs := context.WithCancel(ctx)
	defer cancelJobs()
	service := hunter.New(runCtx, cfg, db, cache, collector, sender, logger)
	if err := service.Restore(setup); err != nil {
		return fmt.Errorf("restore saved watchers: %w", err)
	}
	auth := accounts.New(db, cache, sender, cfg.Email.SystemOwner, cfg.PublicURL)
	handler, err := web.New(cfg, auth, service, logger)
	if err != nil {
		return err
	}
	cancelSetup()
	if opts.check {
		logger.Info("MySQL schema, Redis and saved watchers checked")
		return nil
	}
	listener, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return err
	}
	server := &http.Server{
		Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 155 * time.Second, IdleTimeout: time.Minute,
		BaseContext: func(net.Listener) context.Context { return runCtx },
	}
	service.Start()
	logger.Info("goods-hunter listening", "address", listener.Addr())
	return serve(ctx, server, listener, service, cancelJobs)
}

func serve(ctx context.Context, server *http.Server, listener net.Listener, service *hunter.Service, cancelJobs context.CancelFunc) error {
	exited := make(chan error, 1)
	go func() { exited <- server.Serve(listener) }()
	var serveErr error
	select {
	case serveErr = <-exited:
	case <-ctx.Done():
	}
	cancelJobs()
	shutdown, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	jobs := service.Stop()
	if err := server.Shutdown(shutdown); err != nil {
		_ = server.Close()
		return errors.Join(serveErr, err)
	}
	select {
	case <-jobs.Done():
		return serveErr
	case <-shutdown.Done():
		return errors.Join(serveErr, shutdown.Err())
	}
}
