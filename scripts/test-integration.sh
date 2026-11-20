#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

scratch="$(mktemp -d)"
mysql_test=""
redis_test=""
fc_test=""
cleanup() {
  for container in "$fc_test" "$redis_test" "$mysql_test"; do
    if [[ -n "$container" ]]; then
      docker rm -f "$container" >/dev/null 2>&1 || true
    fi
  done
  rm -f "$scratch/goods-hunter"
  rmdir "$scratch"
}
trap cleanup EXIT

mysql_test="$(docker run --rm --pull=never --detach --memory=768m \
  --env MYSQL_ROOT_PASSWORD=local-go-fixture-only --env MYSQL_DATABASE=goods_hunter_test \
  --publish 127.0.0.1::3306 --tmpfs /var/lib/mysql:rw,size=512m "${MYSQL_TEST_IMAGE:-mysql:latest}")"
redis_test="$(docker run --rm --pull=never --detach --memory=96m \
  --publish 127.0.0.1::6379 --tmpfs /data:rw,size=8m \
  "${REDIS_TEST_IMAGE:-redis:latest}" redis-server --save '' --appendonly no)"

for ((attempt=1; attempt<=60; attempt++)); do
  if docker exec -e MYSQL_PWD=local-go-fixture-only "$mysql_test" \
    mysql --connect-timeout=1 -h127.0.0.1 -uroot goods_hunter_test -e 'SELECT 1' >/dev/null 2>&1; then
    break
  fi
  if (( attempt == 60 )); then
    docker logs --tail 40 "$mysql_test" >&2
    exit 1
  fi
  sleep 1
done

mysql_addr="$(docker port "$mysql_test" 3306/tcp)"
redis_addr="$(docker port "$redis_test" 6379/tcp)"
export GOODS_HUNTER_TEST_MYSQL_DSN="root:local-go-fixture-only@tcp($mysql_addr)/goods_hunter_test"
export GOODS_HUNTER_TEST_REDIS_URL="redis://$redis_addr/0"

if [[ -n "${GOODS_HUNTER_TEST_COLLECTOR:-}" ]]; then
  collector_dir="$(cd "$GOODS_HUNTER_TEST_COLLECTOR" && pwd)"
  fc_test="$(docker run --rm --pull=never --detach --memory=1024m --shm-size=256m \
    --publish 127.0.0.1::9000 --publish 127.0.0.1::9001 --publish 127.0.0.1::9002 \
    --mount "type=bind,source=$collector_dir,target=/collector,readonly" \
    --mount "type=bind,source=$PWD/test/fixtures/search,target=/fixtures,readonly" \
    --entrypoint python "${SEARCH_SCAN_FC_TEST_IMAGE:-bypass-cloudflare:latest}" \
    -B -u /fixtures/scan_fixture_server.py)"
  export GOODS_HUNTER_TEST_FC_URL="http://$(docker port "$fc_test" 9000/tcp)"
  export GOODS_HUNTER_TEST_FLEA_URL="http://$(docker port "$fc_test" 9001/tcp)/search"
  export GOODS_HUNTER_TEST_XIANYU_URL="http://$(docker port "$fc_test" 9002/tcp)/search"
fi

go build -o "$scratch/goods-hunter" ./cmd/goods-hunter
GOODS_HUNTER_MYSQL_DSN="$GOODS_HUNTER_TEST_MYSQL_DSN" \
  GOODS_HUNTER_CONFIG_DIR="$scratch" "$scratch/goods-hunter" -init-db
GOODS_HUNTER_MYSQL_DSN="$GOODS_HUNTER_TEST_MYSQL_DSN" GOODS_HUNTER_REDIS_URL="$GOODS_HUNTER_TEST_REDIS_URL" \
  GOODS_HUNTER_CONFIG_DIR="$scratch" "$scratch/goods-hunter" -check
go test -count=1 ./...
