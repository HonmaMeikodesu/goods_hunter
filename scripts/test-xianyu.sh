#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
task_container="goods-hunter-xianyu-test-$$"
trap 'docker rm -f "$task_container" >/dev/null 2>&1 || true' EXIT
docker run --rm --pull=never --detach --memory=768m --name "$task_container" \
  --env MYSQL_ROOT_PASSWORD=xianyu-local-test-only \
  --publish 127.0.0.1::3306 --tmpfs /var/lib/mysql:rw,size=512m \
  "${MYSQL_TEST_IMAGE:-mysql:latest}" >/dev/null
XIANYU_TEST_MYSQL_PORT="$(docker port "$task_container" 3306/tcp | cut -d: -f2)"
export XIANYU_TEST_MYSQL_PORT
node <<'JS'
const mysql = require('mysql2/promise');
(async () => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const connection = await mysql.createConnection({host: '127.0.0.1', port: Number(process.env.XIANYU_TEST_MYSQL_PORT), user: 'root', password: 'xianyu-local-test-only', connectTimeout: 1000});
      await connection.end();
      return;
    } catch (error) {
      if (attempt === 59) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
JS
NODE_ENV=unittest node_modules/.bin/jest --runInBand test/xianyu
