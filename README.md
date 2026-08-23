# Goods Hunter — Go experiment

This branch is a Go rewrite of Goods Hunter. It preserves account/login flows, scheduled marketplace watchers, notification de-duplication, freezing windows, item surveillance, and encrypted proxy-config delivery without requiring Node, Midway, MySQL, or Redis at runtime.

Requirements: Go 1.25+. Then run:

```bash
make test
make build
GH_MAIL_MODE=log /tmp/goods-hunter
```

The low-disk build targets keep Go caches under `/tmp`; `make clean-cache` removes them. Runtime state is stored atomically in `var/goods-hunter.json` and is intended for a single process. Existing MySQL/Redis data is not imported automatically.

See [README.zh-CN.md](README.zh-CN.md) for configuration, routes, migration notes, and operational details.
