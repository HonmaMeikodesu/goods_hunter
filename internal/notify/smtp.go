package notify

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"

	"github.com/HonmaMeikodesu/goods_hunter/internal/config"
)

type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string
}

type Sender interface {
	Send(context.Context, Message) error
}

type SMTP struct {
	Email config.Email
}

func (s SMTP) Send(ctx context.Context, message Message) error {
	if s.Email.Host == "" {
		return errors.New("SMTP is not configured")
	}
	from, err := mail.ParseAddress(s.Email.SystemOwner)
	if err != nil {
		return errors.New("invalid SMTP sender")
	}
	recipients, err := mail.ParseAddressList(message.To)
	if err != nil {
		return errors.New("invalid SMTP recipients")
	}
	host, port, err := net.SplitHostPort(s.Email.Host)
	if err != nil {
		host, port = strings.Trim(s.Email.Host, "[]"), "465"
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	dial := tls.Dialer{Config: &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}}
	conn, err := dial.DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return errors.New("SMTP connection failed")
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return errors.New("SMTP deadline setup failed")
	}
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return errors.New("SMTP handshake failed")
	}
	defer client.Close()
	if s.Email.User != "" {
		if err := client.Auth(smtp.PlainAuth("", s.Email.User, s.Email.Password, host)); err != nil {
			return errors.New("SMTP authentication failed")
		}
	}
	if err := client.Mail(from.Address); err != nil {
		return errors.New("SMTP rejected sender")
	}
	for _, recipient := range recipients {
		if err := client.Rcpt(recipient.Address); err != nil {
			return errors.New("SMTP rejected recipient")
		}
	}
	body, err := client.Data()
	if err != nil {
		return errors.New("SMTP refused message")
	}
	if err := writeMessage(body, from, recipients, message); err != nil {
		return errors.New("SMTP message write failed")
	}
	if err := body.Close(); err != nil {
		return errors.New("SMTP did not accept message")
	}
	// The DATA reply confirms delivery to the SMTP server even if QUIT fails.
	_ = client.Quit()
	return nil
}

func writeMessage(out io.Writer, from *mail.Address, recipients []*mail.Address, message Message) error {
	body, mediaType := message.Text, "text/plain"
	if message.HTML != "" {
		body, mediaType = message.HTML, "text/html"
	}
	addresses := make([]string, 0, len(recipients))
	for _, recipient := range recipients {
		addresses = append(addresses, recipient.String())
	}
	subject := strings.NewReplacer("\r", " ", "\n", " ").Replace(message.Subject)
	writer := bufio.NewWriter(out)
	_, err := fmt.Fprintf(writer, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\n"+
		"MIME-Version: 1.0\r\nContent-Type: %s; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n",
		from, strings.Join(addresses, ", "), mime.QEncoding.Encode("UTF-8", subject), time.Now().Format(time.RFC1123Z), mediaType)
	if err != nil {
		return err
	}
	encoded := quotedprintable.NewWriter(writer)
	if _, err := io.WriteString(encoded, body); err != nil {
		return err
	}
	if err := encoded.Close(); err != nil {
		return err
	}
	return writer.Flush()
}
