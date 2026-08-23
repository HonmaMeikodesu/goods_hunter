GO_CACHE := /tmp/goods-hunter-go-cache
GO_MOD_CACHE := /tmp/goods-hunter-mod-cache
GO_ENV := GOTOOLCHAIN=local GOCACHE=$(GO_CACHE) GOMODCACHE=$(GO_MOD_CACHE)

.PHONY: test vet verify build run clean-cache

test:
	$(GO_ENV) go test ./...

vet:
	$(GO_ENV) go vet ./...

verify: test vet

build:
	$(GO_ENV) go build -trimpath -ldflags='-s -w' -o /tmp/goods-hunter ./cmd/goods-hunter

run:
	$(GO_ENV) go run ./cmd/goods-hunter

clean-cache:
	GOTOOLCHAIN=local GOCACHE=$(GO_CACHE) go clean -cache
	GOTOOLCHAIN=local GOMODCACHE=$(GO_MOD_CACHE) go clean -modcache
	rm -f /tmp/goods-hunter
