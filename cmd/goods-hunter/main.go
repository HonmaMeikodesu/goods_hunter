package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/accounts"
	"github.com/HonmaMeikodesu/goods_hunter/internal/cipher"
	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/hunter"
	"github.com/HonmaMeikodesu/goods_hunter/internal/market"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
	"github.com/HonmaMeikodesu/goods_hunter/internal/notify"
	"github.com/HonmaMeikodesu/goods_hunter/internal/state"
	"github.com/HonmaMeikodesu/goods_hunter/internal/web"
)

type sender interface {
	Send(context.Context, model.Mail) error
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(logger); err != nil {
		logger.Error("goods-hunter stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	store, err := state.Open(cfg.DataFile)
	if err != nil {
		return err
	}

	var mailSender sender
	systemOwner := cfg.SMTP.SystemOwner
	switch cfg.MailMode {
	case "smtp":
		mailSender = notify.NewSMTP(cfg.SMTP)
	case "log":
		mailSender = notify.LogSender{Logger: logger}
		if systemOwner == "" {
			systemOwner = "registration-admin@localhost"
		}
	default:
		return errors.New("GH_MAIL_MODE must be smtp or log")
	}
	browser := market.NewAliCloudBrowser(cfg.AliCloud)
	marketplace := market.NewClient(browser, cfg.YahooCookie)
	accountModule := accounts.New(store, mailSender, accounts.Options{
		BaseURL: cfg.BaseURL, SystemOwner: systemOwner,
		RegistrationTTL: cfg.RegistrationTTL, SessionTTL: cfg.SessionTTL, Logger: logger,
	})
	hunterModule := hunter.New(store, marketplace, mailSender, cfg.BaseURL, logger)

	rootContext, stopSignals := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stopSignals()
	if err := hunterModule.Start(rootContext); err != nil {
		return err
	}
	defer func() {
		shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = hunterModule.Stop(shutdownContext)
	}()

	var cipherModule *cipher.Module
	if len(cfg.SecretKey) > 0 {
		cipherModule, err = cipher.New(cfg.SecretKey)
		if err != nil {
			return err
		}
	}
	httpModule := web.New(cfg, accountModule, hunterModule, cipherModule, logger)
	httpServer := &http.Server{
		Addr: cfg.ListenAddress, Handler: httpModule.Handler(),
		ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 130 * time.Second, IdleTimeout: 60 * time.Second,
	}
	serveErrors := make(chan error, 1)
	go func() {
		logger.Info("goods-hunter listening", "address", cfg.ListenAddress, "dataFile", cfg.DataFile, "mailMode", cfg.MailMode)
		serveErrors <- httpServer.ListenAndServe()
	}()

	select {
	case <-rootContext.Done():
		shutdownContext, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownContext)
	case err := <-serveErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}
