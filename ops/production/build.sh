#!/usr/bin/bash
set -euo pipefail

revision=$1
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

export HOME="$work"
export GOCACHE="$CACHE_DIRECTORY/build" GOMODCACHE="$CACHE_DIRECTORY/modules"
export GOPROXY=https://mirrors.aliyun.com/goproxy GOTOOLCHAIN=local
export CGO_ENABLED=0 GOOS=linux GOARCH=amd64

git init --quiet "$work/source"
cd "$work/source"
git fetch --quiet --no-tags --depth=1 https://github.com/HonmaMeikodesu/goods_hunter.git "$revision"
git checkout --quiet --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "$revision"
/opt/goods-hunter/go/bin/go build -mod=readonly -trimpath -ldflags='-s -w' -o "$work/goods-hunter" ./cmd/goods-hunter
cat "$work/goods-hunter"
