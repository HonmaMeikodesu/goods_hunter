import asyncio
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlsplit, quote, parse_qs

sys.path.insert(0, '/app')
import bypass_cloudflare as runtime

OUT = Path('/artifacts')
KEYWORD = '未闻花名'
PROXY_KEYS = ('http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY')
report = {
    'testedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(),
    'environment': 'local FC base container; modified entrypoint and Chrome launcher mounted read-only',
    'keyword': KEYWORD,
    'proxyEnabled': os.environ.get('PROXY_ENABLED'),
    'remainingProxyVariables': [key for key in PROXY_KEYS if key in os.environ],
    'proxyConfigurationCredentialsPresent': any(os.environ.get(key) for key in ('SECRET_KEY_K', 'GOODS_HUNTER_SERVER_URL')),
    'chromeVersion': subprocess.check_output([runtime.CHROME_PATH, '--version'], text=True).strip(),
    'playwrightVersion': importlib.metadata.version('playwright'),
    'searchResponses': [],
    'failedRequests': [],
}
assert report['proxyEnabled'] == 'false'
assert not report['remainingProxyVariables']
assert not report['proxyConfigurationCredentialsPresent']

async def summarize_page(page, label):
    text = await page.locator('body').inner_text(timeout=10000)
    return {
        'label': label,
        'url': page.url,
        'title': await page.title(),
        'visibleText': text[:5000],
        'itemLinksOnEntirePage': await page.locator('a[href*="/item"]').count(),
        'iframeSources': [urlsplit(src).netloc + urlsplit(src).path for src in await page.locator('iframe').evaluate_all('(els) => els.map(e => e.src)')],
    }

async def main():
    playwright = browser = context = page = None
    tasks = set()
    search_seen = asyncio.Event()

    async def capture_response(response):
        api = 'mtop.taobao.idlemtopsearch.pc.search'
        if api not in urlsplit(response.url).path.lower().split('/'):
            return
        fields = {}
        def collect_fields(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key in ('keyword', 'pageNumber', 'pageSize', 'sort', 'searchType') and isinstance(item, (str, int, bool)):
                        fields[key] = str(item)[:100]
                    elif isinstance(item, (dict, list)):
                        collect_fields(item)
                    elif isinstance(item, str) and item.startswith('{'):
                        try:
                            collect_fields(json.loads(item))
                        except ValueError:
                            pass
            elif isinstance(value, list):
                for item in value:
                    collect_fields(item)
        candidates = parse_qs(urlsplit(response.url).query).get('data', [])
        post = response.request.post_data
        if post:
            if post.lstrip().startswith('{'):
                candidates.append(post)
            else:
                candidates.extend(parse_qs(post).get('data', []))
        for candidate in candidates:
            try:
                collect_fields(json.loads(candidate))
            except ValueError:
                pass
        entry = {'api': api, 'httpStatus': response.status, 'requestFields': fields, 'targetQuery': fields.get('keyword') == KEYWORD}
        try:
            body = await response.text()
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = json.loads(body[body.index('{'):body.rindex('}') + 1])
            ret = payload.get('ret', [])
            entry['ret'] = [str(value)[:500] for value in ret] if isinstance(ret, list) else str(ret)[:500]
            data = payload.get('data')
            entry['dataKeys'] = list(data) if isinstance(data, dict) else []
            entry['businessSuccess'] = isinstance(ret, list) and any(str(value).startswith('SUCCESS') for value in ret)
            if isinstance(data, dict):
                entry['topLevelArrayLengths'] = {key: len(value) for key, value in data.items() if isinstance(value, list)}
        except Exception as error:
            entry['parseError'] = type(error).__name__
        report['searchResponses'].append(entry)
        print('SEARCH_RESPONSE ' + json.dumps(entry, ensure_ascii=False), flush=True)
        if entry['targetQuery']:
            search_seen.set()

    def on_response(response):
        task = asyncio.create_task(capture_response(response))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    def on_failed(request):
        url = urlsplit(request.url)
        if len(report['failedRequests']) < 20:
            report['failedRequests'].append({'host': url.netloc, 'path': url.path, 'failure': request.failure})

    try:
        playwright, browser = await runtime.connect_to_chrome()
        args = Path(f'/proc/{runtime._chrome_process.pid}/cmdline').read_bytes().decode().split('\0')
        report['chromeDirectFlag'] = '--no-proxy-server' in args
        report['chromeProxyFlagPresent'] = any(arg.startswith('--proxy-server') for arg in args)
        report['headless'] = any(arg.startswith('--headless') for arg in args)
        assert report['chromeDirectFlag'] and not report['chromeProxyFlagPresent'] and not report['headless']
        report['mihomoRunning'] = any(
            p.read_text().strip() == 'mihomo'
            for p in Path('/proc').glob('[0-9]*/comm') if p.exists()
        )
        assert not report['mihomoRunning']
        print('RUNTIME ' + json.dumps({key: report[key] for key in ('proxyEnabled', 'remainingProxyVariables', 'chromeVersion', 'playwrightVersion', 'chromeDirectFlag', 'headless', 'mihomoRunning')}, ensure_ascii=False), flush=True)
        context = await browser.new_context(viewport={'width': 1365, 'height': 900}, locale='zh-CN')
        report['initialCookieCount'] = len(await context.cookies())
        page = await context.new_page()
        page.on('response', on_response)
        page.on('requestfailed', on_failed)
        home = await page.goto('https://www.goofish.com/', wait_until='domcontentloaded', timeout=35000)
        report['homeHttpStatus'] = home.status if home else None
        await page.locator('input').first.wait_for(state='visible', timeout=15000)
        report['homepage'] = await summarize_page(page, 'homepage')
        print('HOME ' + json.dumps({'httpStatus': report['homeHttpStatus'], 'title': report['homepage']['title']}, ensure_ascii=False), flush=True)
        response = await page.goto('https://www.goofish.com/search?q=' + quote(KEYWORD), wait_until='domcontentloaded', timeout=35000)
        report['searchNavigationHttpStatus'] = response.status if response else None
        try:
            await asyncio.wait_for(search_seen.wait(), timeout=25)
        except asyncio.TimeoutError:
            report['searchResponseTimeout'] = True
        # Capture the settled visible UI after the observed business response.
        try:
            await page.get_by_text('加载中...', exact=True).wait_for(state='hidden', timeout=10000)
        except Exception:
            pass
        await page.screenshot(path=str(OUT / 'xianyu-local-anonymous.png'), full_page=False)
        report['searchPage'] = await summarize_page(page, 'search')
        # Capture only visible verification text; never save form values or request credentials.
        frames = []
        for frame in page.frames:
            if frame == page.main_frame:
                continue
            try:
                frame_text = await frame.locator('body').inner_text(timeout=1500)
                if frame_text.strip():
                    markers = [label for label in ('短信登录', '密码登录', '手机扫码安全登录', '滑块', '向右滑动', '请按住滑块') if label in frame_text]
                    if markers:
                        frames.append({'host': urlsplit(frame.url).netloc, 'markers': markers})
            except Exception:
                pass
        report['frameText'] = frames
        await page.screenshot(path=str(OUT / 'xianyu-local-anonymous.png'), full_page=False)
        responses = [r for r in report['searchResponses'] if r.get('targetQuery')]
        report['matchedSearchResponseCount'] = len(responses)
        report['outcome'] = 'search_business_error' if any(r.get('ret') and not r.get('businessSuccess') for r in responses) else 'search_response_needs_item_validation' if responses else 'no_matching_search_response'
        print('PAGE ' + json.dumps(report['searchPage'], ensure_ascii=False), flush=True)
        print('FRAMES ' + json.dumps(frames, ensure_ascii=False), flush=True)
    except Exception as error:
        report['outcome'] = 'browser_or_network_error'
        # Avoid Playwright call logs that may contain signed response URLs.
        report['errorType'] = type(error).__name__
        report['errorSummary'] = str(error).split('Call log:')[0][:800]
        print('ERROR ' + report['errorType'] + ': ' + report['errorSummary'], flush=True)
        if page:
            try:
                report['failurePage'] = await summarize_page(page, 'failure')
                await page.screenshot(path=str(OUT / 'xianyu-local-anonymous.png'), full_page=False, timeout=5000)
            except Exception:
                pass
    finally:
        if tasks:
            await asyncio.gather(*list(tasks), return_exceptions=True)
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / 'xianyu-local-anonymous-result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
        if context:
            await context.close()
        if playwright:
            await playwright.stop()
        runtime.shutdown_chrome()
        runtime.shutdown_xvfb()
        print('OUTCOME ' + report.get('outcome', 'unknown'), flush=True)

asyncio.run(main())
