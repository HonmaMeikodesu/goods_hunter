# Goods Hunter

Goods Hunter schedules marketplace searches and individual listing watches, deduplicates results in MySQL, and sends email notifications. It monitors Mercari, Yahoo Auctions, Surugaya, Mandarake, Yahoo! Flea Market, and Xianyu through the companion collection service.

Build with Go 1.25 or later.

```bash
mkdir -p bin
go build -trimpath -o bin/goods-hunter ./cmd/goods-hunter
export GOODS_HUNTER_MYSQL_DSN='<user>:<password>@tcp(127.0.0.1:3306)/goods_hunter'
export GOODS_HUNTER_REDIS_URL='redis://127.0.0.1:6379/0'
bin/goods-hunter -check
bin/goods-hunter
```

The service reads existing private JSON files from `src/private/` or `GOODS_HUNTER_CONFIG_DIR` and listens on port 7001 by default. It can use the existing Midway MySQL and Redis data directly. For a fresh installation, create a MySQL database with `utf8mb4` and run `bin/goods-hunter -init-db` before starting the service.

Run `go test ./...` for the offline tests and `./scripts/test-integration.sh` for the local MySQL and Redis tests. Set `GOODS_HUNTER_TEST_COLLECTOR=../bypass-cloudflare` to include the companion FC fixture tests.

See the [Chinese guide](README.zh-CN.md) for configuration and cutover steps.
