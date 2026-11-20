package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/HonmaMeikodesu/goods_hunter/internal/problem"
)

func (s *Store) LoginCredentials(ctx context.Context, email string) (string, string, error) {
	var owner, password string
	err := s.db.QueryRowContext(ctx, "SELECT email,password FROM `user` WHERE email=?", email).Scan(&owner, &password)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", problem.WrongPassword
	}
	return owner, password, err
}

func (s *Store) CreateUser(ctx context.Context, email, digest string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO `user` (email,password) VALUES (?,?)", email, digest)
	var mysqlErr *mysql.MySQLError
	if errors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return problem.UserExists
	}
	return err
}

func (s *Store) SaveSession(ctx context.Context, email, token string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO login_state (userEmail,loginState,expiredAt) VALUES (?,?,?)", email, token, expires)
	return err
}

func (s *Store) Session(ctx context.Context, token string) (string, time.Time, error) {
	var owner string
	var expires time.Time
	err := s.db.QueryRowContext(ctx, "SELECT userEmail,expiredAt FROM login_state WHERE loginState=?", token).Scan(&owner, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", expires, problem.InvalidLogin
	}
	return owner, expires, err
}
