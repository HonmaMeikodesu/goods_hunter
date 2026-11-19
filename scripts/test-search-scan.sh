#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project_dir="$PWD"
collector_dir="$(cd "${BYPASS_CLOUDFLARE_DIR:-../bypass-cloudflare}" && pwd)"

fc_container=""
db_container=""
cleanup() {
  local result=$?
  if [[ -n "$fc_container" ]]; then
    if (( result != 0 )); then docker logs --tail 100 "$fc_container" >&2 || true; fi
    docker rm -f "$fc_container" >/dev/null 2>&1 || true
  fi
  if [[ -n "$db_container" ]]; then docker rm -f "$db_container" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

fc_container="$(docker run --rm --pull=never --detach --memory=1024m --shm-size=256m \
  --publish 127.0.0.1::9000 --publish 127.0.0.1::9001 --publish 127.0.0.1::9002 \
  --mount "type=bind,source=$collector_dir,target=/collector,readonly" \
  --mount "type=bind,source=$project_dir/test/fixtures/search,target=/fixtures,readonly" \
  --entrypoint python "${SEARCH_SCAN_FC_TEST_IMAGE:-bypass-cloudflare:latest}" \
  -B -u /fixtures/scan_fixture_server.py)"
db_container="$(docker run --rm --pull=never --detach --memory=768m \
  --env MYSQL_ROOT_PASSWORD=search-scan-local-test-only --env MYSQL_DATABASE=search_scan_fixture \
  --publish 127.0.0.1::3306 --tmpfs /var/lib/mysql:rw,size=512m \
  "${MYSQL_TEST_IMAGE:-mysql:latest}")"

SEARCH_SCAN_TEST_HTML_FC_URL="http://$(docker port "$fc_container" 9000/tcp)"
SEARCH_SCAN_TEST_YAHOO_FC_URL="http://$(docker port "$fc_container" 9001/tcp)/search"
SEARCH_SCAN_TEST_XIANYU_FC_URL="http://$(docker port "$fc_container" 9002/tcp)/search"
SEARCH_SCAN_TEST_MYSQL_PORT="$(docker port "$db_container" 3306/tcp | cut -d: -f2)"
export SEARCH_SCAN_TEST_HTML_FC_URL SEARCH_SCAN_TEST_YAHOO_FC_URL SEARCH_SCAN_TEST_XIANYU_FC_URL SEARCH_SCAN_TEST_MYSQL_PORT

node <<'JS'
const mysql = require("mysql2/promise");
const http = require("node:http");
const healthUrl = new URL("/health", process.env.SEARCH_SCAN_TEST_YAHOO_FC_URL);
function fcReady() {
  return new Promise((resolve, reject) => {
    const request = http.get(healthUrl, response => {
      response.resume();
      if (response.statusCode === 200) resolve();
      else reject(new Error("Fixture FC health returned " + response.statusCode));
    });
    request.on("error", reject);
    request.setTimeout(1000, () => request.destroy(new Error("Fixture FC health timed out")));
  });
}
(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await fcReady();
      const connection = await mysql.createConnection({
        host: "127.0.0.1", port: Number(process.env.SEARCH_SCAN_TEST_MYSQL_PORT),
        user: "root", password: "search-scan-local-test-only", database: "search_scan_fixture",
        connectTimeout: 1000,
      });
      await connection.end();
      return;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
JS

NODE_ENV=unittest node_modules/.bin/jest --runInBand test/service/searchScan.integration.test.ts
