// Package notify contains production adapters for the mail-sending seam.
package notify

import (
	"bufio"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

type LogSender struct {
	Logger *slog.Logger
}

func (s LogSender) Send(_ context.Context, message model.Mail) error {
	logger := s.Logger
	if logger == nil {
		logger = slog.Default()
	}
	logger.Warn("mail delivery is in log mode", "to", message.To, "subject", message.Subject, "text", message.Text)
	return nil
}

type SMTP struct {
	config config.SMTP
}

func NewSMTP(cfg config.SMTP) *SMTP {
	return &SMTP{config: cfg}
}

func (s *SMTP) Send(ctx context.Context, message model.Mail) error {
	from, err := mail.ParseAddress(s.config.SystemOwner)
	if err != nil {
		return fmt.Errorf("parse sender address: %w", err)
	}
	to, err := mail.ParseAddress(message.To)
	if err != nil {
		return fmt.Errorf("parse recipient address: %w", err)
	}
	host := strings.TrimSpace(s.config.Host)
	if host == "" || s.config.Port <= 0 {
		return fmt.Errorf("SMTP host and port are required")
	}
	address := net.JoinHostPort(host, fmt.Sprintf("%d", s.config.Port))
	deadline := time.Now().Add(30 * time.Second)
	if value, ok := ctx.Deadline(); ok && value.Before(deadline) {
		deadline = value
	}

	var client *smtp.Client
	switch s.config.TLSMode {
	case "implicit", "":
		dialer := &tls.Dialer{NetDialer: &net.Dialer{Timeout: 15 * time.Second}, Config: &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}}
		connection, dialErr := dialer.DialContext(ctx, "tcp", address)
		if dialErr != nil {
			return fmt.Errorf("connect to SMTP: %w", dialErr)
		}
		_ = connection.SetDeadline(deadline)
		client, err = smtp.NewClient(connection, host)
	case "starttls", "plain":
		connection, dialErr := (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, "tcp", address)
		if dialErr != nil {
			return fmt.Errorf("connect to SMTP: %w", dialErr)
		}
		_ = connection.SetDeadline(deadline)
		client, err = smtp.NewClient(connection, host)
		if err == nil && s.config.TLSMode == "starttls" {
			err = client.StartTLS(&tls.Config{MinVersion: tls.VersionTLS12, ServerName: host})
		}
	default:
		return fmt.Errorf("unsupported SMTP TLS mode %q", s.config.TLSMode)
	}
	if err != nil {
		return fmt.Errorf("initialize SMTP: %w", err)
	}
	defer func() { _ = client.Close() }()

	if s.config.User != "" {
		if err := client.Auth(smtp.PlainAuth("", s.config.User, s.config.Password, host)); err != nil {
			return fmt.Errorf("authenticate SMTP: %w", err)
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return fmt.Errorf("set SMTP sender: %w", err)
	}
	if err := client.Rcpt(to.Address); err != nil {
		return fmt.Errorf("set SMTP recipient: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("start SMTP body: %w", err)
	}
	if _, err := io.Copy(w, strings.NewReader(formatMessage(from, to, message))); err != nil {
		_ = w.Close()
		return fmt.Errorf("write SMTP body: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("finish SMTP body: %w", err)
	}
	if err := client.Quit(); err != nil {
		return fmt.Errorf("finish SMTP session: %w", err)
	}
	return nil
}

func formatMessage(from, to *mail.Address, message model.Mail) string {
	boundary := "goods-hunter-boundary"
	var b strings.Builder
	w := bufio.NewWriter(&b)
	_, _ = fmt.Fprintf(w, "From: %s\r\n", from.String())
	_, _ = fmt.Fprintf(w, "To: %s\r\n", to.String())
	_, _ = fmt.Fprintf(w, "Subject: %s\r\n", mime.QEncoding.Encode("UTF-8", cleanHeader(message.Subject)))
	_, _ = fmt.Fprintf(w, "MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
	_, _ = fmt.Fprintf(w, "--%s\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", boundary, message.Text)
	_, _ = fmt.Fprintf(w, "--%s\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", boundary, message.HTML)
	_, _ = fmt.Fprintf(w, "--%s--\r\n", boundary)
	_ = w.Flush()
	return b.String()
}

func cleanHeader(value string) string {
	return strings.NewReplacer("\r", " ", "\n", " ").Replace(value)
}
