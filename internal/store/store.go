package store

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"

	"github.com/HonmaMeikodesu/goods_hunter/internal/model"
)

type Store struct {
	db *sql.DB
}

func Open(dsn string, location *time.Location) (*Store, error) {
	if dsn == "" {
		return nil, errors.New("GOODS_HUNTER_MYSQL_DSN is required")
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil || cfg.DBName == "" {
		return nil, errors.New("invalid GOODS_HUNTER_MYSQL_DSN")
	}
	cfg.ParseTime, cfg.Loc = true, location
	if cfg.Timeout == 0 {
		cfg.Timeout = 5 * time.Second
	}
	if cfg.Params == nil {
		cfg.Params = make(map[string]string)
	}
	cfg.Params["time_zone"] = "'+08:00'"
	if err := cfg.Apply(mysql.Charset("utf8mb4", cfg.Collation)); err != nil {
		return nil, err
	}
	connector, err := mysql.NewConnector(cfg)
	if err != nil {
		return nil, errors.New("invalid MySQL connection settings")
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(6)
	db.SetConnMaxLifetime(3 * time.Minute)
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

//go:embed schema.sql
var schema string

// InitSchema creates missing tables. Running the application against an
// existing TypeORM database requires no DDL permissions.
func (s *Store) InitSchema(ctx context.Context) error {
	for i, statement := range strings.Split(schema, ";") {
		if statement = strings.TrimSpace(statement); statement == "" {
			continue
		}
		if _, err := s.db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("schema statement %d: %w", i+1, err)
		}
	}
	return nil
}

func (s *Store) Check(ctx context.Context) error {
	if err := s.db.PingContext(ctx); err != nil {
		return fmt.Errorf("connect to MySQL: %w", err)
	}
	queries := []string{
		"SELECT email,password FROM `user` LIMIT 0",
		"SELECT userEmail,loginState,expiredAt FROM login_state LIMIT 0",
		"SELECT site,outcome,completedAt FROM search_scan_record LIMIT 0",
	}
	for _, site := range model.Sites {
		table := tables[site]
		queries = append(queries, table.watcherSelect()+" LIMIT 0")
		if table.records != "" {
			fields := table.foreignKey + "," + table.recordFields + ",createdAt"
			if table.baseline {
				fields += ",notifiedAt"
			}
			queries = append(queries, "SELECT "+fields+" FROM "+table.records+" LIMIT 0")
		}
	}
	for _, query := range queries {
		r, err := s.db.QueryContext(ctx, query)
		if err != nil {
			return fmt.Errorf("read existing MySQL schema: %w", err)
		}
		r.Close()
	}
	return nil
}

func (s *Store) transaction(ctx context.Context, run func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := run(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func placeholders(size int) string {
	return strings.Repeat("?,", size-1) + "?"
}
