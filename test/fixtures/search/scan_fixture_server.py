"""Serve the real FC handlers with browser requests fulfilled from local fixtures."""

import importlib.util
import json
import logging
from http.server import HTTPServer
from pathlib import Path
import sys
from threading import Thread
from urllib.parse import parse_qs, unquote, urlsplit

FC_SOURCE = Path("/collector")
sys.path.insert(0, str(FC_SOURCE))

import bypass_cloudflare
from playwright.async_api import async_playwright
import search_page

MERCARI_ITEM = """
<ul id="item-grid"><li data-testid="item-cell">
<a data-testid="thumbnail-link" href="/item/m90001"><img alt="测试徽章"></a>
</li></ul>
"""
SURUGAYA_ITEM = """
<div id="search_result"><div class="item_box"><div class="item">
<div class="item_detail"><div class="title"><a href="/product/detail/90001">商品</a></div>
<div class="product-name">测试挂件</div></div>
<div class="item_price"><div class="price_teika"><strong>850円</strong></div></div>
</div></div></div>
"""
MANDARAKE_SOLD = """
<div class="entry"><div class="thumlarge"><div class="block" data-itemidx="90001">
<div class="title"><a href="?itemCode=90001">测试卡片</a></div><span class="soldout">Sold</span>
</div></div></div>
"""
YAHOO_ITEMS = (Path(__file__).parent / "yahoo-old.html").read_text()
XIANYU_HOME = """
<!doctype html><meta charset="utf-8"><input id="keyword">
<button>新发布</button><button id="newest">最新</button>
<script>
const input = document.querySelector('#keyword');
function search(newest) {
  const data = {keyword: input.value, pageNumber: 1};
  if (newest) Object.assign(data, {sortField: 'create', sortValue: 'desc'});
  const query = new URLSearchParams({data: JSON.stringify(data)});
  fetch('/fixtures/mtop.taobao.idlemtopsearch.pc.search/?' + query).then(r => r.json());
}
input.addEventListener('keydown', event => { if (event.key === 'Enter') search(false); });
document.querySelector('#newest').addEventListener('click', () => search(true));
</script>
"""


def yahoo_fleamarket_html(keyword, page):
    zero_match = keyword == "mock-empty"
    snapshot = {
        "page": "/search/[query]",
        "props": {
            "pageProps": {"query": keyword, "currentPage": 1 if keyword == "mock-stale" else page},
            "initialState": {"searchState": {"search": {
                "isZeroMatch": zero_match,
                "searchParams": {"query": keyword, "sort": "openTime", "order": "DESC", "itemStatus": "open"},
                "result": {"offset": (page - 1) * 100, "totalResultsAvailable": 101, "totalResultsReturned": 1,
                           "items": [{"id": "mock90001", "title": "测试徽章", "price": 900, "itemStatus": "OPEN"}]},
            }}},
        },
    }
    return '<script type="application/json" id="__NEXT_DATA__">' + json.dumps(snapshot) + "</script>"


def xianyu_snapshot(fields):
    keyword = fields["keyword"]
    if keyword == "mock-challenge" and fields.get("sortField") == "create":
        return {"ret": ["RGV587_ERROR::Synthetic verification page"]}
    items = [] if keyword in ("mock-empty", "mock-empty-with-more") else [{
        "data": {"item": {"main": {"exContent": {
            "itemId": "90001", "title": "测试徽章", "price": [{"text": "¥14.90"}],
        }}}},
    }]
    return {"ret": ["SUCCESS::Fixture"], "data": {
        "resultInfo": {
            "hasNextPage": keyword == "mock-empty-with-more",
            "searchResControlFields": {"numFound": len(items), "hasItems": bool(items)},
        },
        "resultList": items,
    }}


async def serve_fixture(route):
    url = urlsplit(route.request.url)
    query = {key: values[0] for key, values in parse_qs(url.query).items()}
    pages = {
        "jp.mercari.com": {
            "mock-items": MERCARI_ITEM,
            "mock-empty": "<main><p>該当する商品が見つかりませんでした。</p></main>",
            "mock-parse-error": MERCARI_ITEM.replace('alt="测试徽章"', 'alt=""'),
        },
        "www.suruga-ya.jp": {
            "mock-items": SURUGAYA_ITEM,
            "mock-empty": '<div id="search_header"><div class="hit">該当件数：０件</div></div>',
            "mock-shell": '<title>駿河屋 検索結果</title><div id="search_result">Loading…</div>',
            "mock-challenge": '<title>Attention Required!</title><form id="challenge-form">Verify</form>',
        },
        "order.mandarake.co.jp": {
            "mock-sold": MANDARAKE_SOLD,
            "mock-shell": '<div class="entry"></div>',
        },
        "auctions.yahoo.co.jp": {
            "mock-items": YAHOO_ITEMS,
            "mock-empty": "<main><p>条件に一致する商品は<br>見つかりませんでした</p></main>",
            "mock-stale": YAHOO_ITEMS,
        },
    }
    keyword = query.get("keyword") or query.get("search_word") or query.get("p")
    if url.hostname == "www.suruga-ya.jp" and keyword == "mock-disconnect":
        await route.abort("connectionclosed")
        return
    if url.hostname == "paypayfleamarket.yahoo.co.jp" and url.path.startswith("/search/"):
        body = yahoo_fleamarket_html(unquote(url.path.split("/")[-1]), int(query["page"]))
    elif url.hostname == "www.goofish.com" and url.path == "/":
        body = XIANYU_HOME
    elif url.hostname == "www.goofish.com" and url.path.startswith("/fixtures/") and "data" in query:
        await route.fulfill(json=xianyu_snapshot(json.loads(query["data"])))
        return
    else:
        body = pages.get(url.hostname, {}).get(keyword)
        if url.hostname == "auctions.yahoo.co.jp" and keyword == "mock-stale" and query.get("b") == "51":
            body = """<script>
            const previousPage = new URL(location.href);
            previousPage.searchParams.set('b', '1');
            history.replaceState(null, '', previousPage);
            </script>""" + body

    if body is None:
        await route.abort()
    else:
        await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)


class FixtureBrowser:
    def __init__(self, browser):
        self.browser = browser

    async def new_context(self, **options):
        context = await self.browser.new_context(service_workers="block", **options)
        await context.route("**/*", serve_fixture)
        return context

    async def close(self):
        await self.browser.close()


async def connect_fixture_browser():
    playwright = await async_playwright().start()
    try:
        browser = await playwright.chromium.launch(
            executable_path=bypass_cloudflare.CHROME_PATH, headless=True,
            args=["--no-sandbox", "--disable-background-networking", "--host-resolver-rules=MAP * ~NOTFOUND"],
        )
        return playwright, FixtureBrowser(browser)
    except Exception:
        await playwright.stop()
        raise


def handler(name):
    spec = importlib.util.spec_from_file_location(name, FC_SOURCE / "code" / f"{name}.py")
    entry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(entry)
    return entry.RequestHandler


async def capture_fixture_search(page, target_url, rules, _wait_seconds):
    # Synthetic pages are ready when navigation completes.
    return await capture_search(page, target_url, rules, 0)


if __name__ == "__main__":
    logging.getLogger().setLevel(logging.WARNING)
    capture_search = search_page.capture_search
    search_page.capture_search = capture_fixture_search
    bypass_cloudflare.connect_to_chrome = connect_fixture_browser
    servers = [
        HTTPServer(("0.0.0.0", port), handler(name))
        for port, name in [(9000, "index"), (9001, "yahoo_fleamarket_index"), (9002, "xianyu_index")]
    ]
    for server in servers[1:]:
        Thread(target=server.serve_forever, daemon=True).start()
    print("Fixture FC handlers ready", flush=True)
    servers[0].serve_forever()
