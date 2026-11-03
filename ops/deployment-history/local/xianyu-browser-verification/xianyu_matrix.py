import argparse
import asyncio
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, quote, urlsplit

sys.path.insert(0, '/app')
import bypass_cloudflare as runtime
from playwright.async_api import async_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--external-cdp')
parser.add_argument('--ui-only', action='store_true')
parser.add_argument('--keywords', nargs='+', default=['手机', '面码', '手办'])
parser.add_argument('--label')
parser.add_argument('--newest', action='store_true')
args = parser.parse_args()
OUT = Path('/artifacts')
KEYWORD = '未闻花名'
API = 'mtop.taobao.idlemtopsearch.pc.search'
PREFIX = args.label or ('native' if args.external_cdp else 'container')
if args.ui_only and not args.label:
    PREFIX += '-ui'
ALLOWED_KEYWORDS = set(args.keywords) | {'未闻花名', '手机'}
report = {'testedAt': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(), 'environment': PREFIX, 'keyword': KEYWORD, 'cases': []}
phase = 'startup'
requests = {}
responses = []
response_tasks = set()


def request_fields(request):
    fields = {}
    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ('keyword', 'pageNumber', 'pageSize', 'sort', 'sortField', 'sortValue', 'sortType', 'searchType') and isinstance(item, (str, int, bool)):
                    fields[key] = str(item)[:100]
                elif isinstance(item, (dict, list)):
                    visit(item)
                elif isinstance(item, str) and item.startswith('{'):
                    try:
                        visit(json.loads(item))
                    except ValueError:
                        pass
        elif isinstance(value, list):
            for item in value:
                visit(item)
    candidates = parse_qs(urlsplit(request.url).query).get('data', [])
    try:
        body = request.post_data
        if body:
            candidates.extend([body] if body.lstrip().startswith('{') else parse_qs(body).get('data', []))
    except Exception:
        pass
    for candidate in candidates:
        try:
            visit(json.loads(candidate))
        except ValueError:
            pass
    return fields


def on_request(request):
    if API in urlsplit(request.url).path.lower().split('/'):
        requests[id(request)] = (phase, request_fields(request))


async def capture(response):
    if API not in urlsplit(response.url).path.lower().split('/'):
        return
    request_phase, fields = requests.get(id(response.request), (phase, request_fields(response.request)))
    if fields.get('keyword') not in ALLOWED_KEYWORDS:
        return
    record = {'phase': request_phase, 'httpStatus': response.status, 'requestFields': fields}
    try:
        body = await response.text()
        try:
            payload = json.loads(body)
        except ValueError:
            payload = json.loads(body[body.index('{'):body.rindex('}') + 1])
        ret = payload.get('ret', [])
        record['ret'] = [str(x)[:300] for x in ret] if isinstance(ret, list) else [str(ret)[:300]]
        record['businessSuccess'] = any(x.startswith('SUCCESS') for x in record['ret'])
        data = payload.get('data', {})
        record['dataKeys'] = list(data) if isinstance(data, dict) else []
        record['arrayLengths'] = {k: len(v) for k, v in data.items() if isinstance(v, list)} if isinstance(data, dict) else {}
        # Public result samples only, if a successful merchandise response exists.
        if record['businessSuccess'] and isinstance(data, dict):
            def redact(value, depth=0):
                if depth > 6:
                    return '<depth limit>'
                if isinstance(value, dict):
                    return {key: '<REDACTED>' if any(word in key.lower() for word in ('token','sign','cookie','auth','track','trace','device','session','userid','openid')) else redact(item, depth + 1) for key, item in list(value.items())[:40]}
                if isinstance(value, list):
                    return [redact(item, depth + 1) for item in value[:8]]
                if isinstance(value, str):
                    if value.startswith(('https://','http://','//')):
                        parsed = urlsplit(value)
                        return parsed.netloc + parsed.path
                    return value[:300]
                return value
            record['resultInfo'] = redact(data.get('resultInfo'))
            record['resultPrefixBar'] = redact(data.get('resultPrefixBar'))
            records = data.get('resultList') or data.get('items') or []
            record['resultCount'] = len(records) if isinstance(records, list) else 0
            if records:
                samples = []
                for item in records:
                    main = item.get('data', {}).get('item', {}).get('main', {})
                    content = main.get('exContent', {})
                    item_id, title = str(content.get('itemId', '')), content.get('title')
                    if item_id.isdigit() and isinstance(title, str) and title.strip():
                        price = content.get('price', [])
                        price_parts = [p.get('text', '') for p in price if isinstance(p, dict)] if isinstance(price, list) else []
                        public_item = {'id': item_id, 'title': title[:250], 'priceText': ''.join(str(p) for p in price_parts), 'url': 'https://www.goofish.com/item?id=' + item_id}
                        publish_time = main.get('clickParam', {}).get('args', {}).get('publishTime')
                        if isinstance(publish_time, (str, int, float)):
                            public_item['publishTimeRaw'] = str(publish_time)[:40]
                        samples.append(public_item)
                record['validItemCount'] = len(samples)
                record['literalTitleMatches'] = sum(fields.get('keyword', '') in s['title'] for s in samples)
                record['publicItems'] = samples
                def shape(value, depth=0):
                    if depth > 5:
                        return type(value).__name__
                    if isinstance(value, dict):
                        return {k: shape(v, depth + 1) for k, v in list(value.items())[:30]}
                    if isinstance(value, list):
                        return [shape(value[0], depth + 1)] if value else []
                    return type(value).__name__
                record['firstResultShape'] = shape(records[0])
    except Exception as error:
        record['errorType'] = type(error).__name__
    responses.append(record)
    print('[XIANYU-MATRIX] RESPONSE ' + json.dumps({k: record.get(k) for k in ('phase', 'requestFields', 'httpStatus', 'ret', 'resultCount', 'validItemCount')}, ensure_ascii=False), flush=True)


def on_response(response):
    task = asyncio.create_task(capture(response))
    response_tasks.add(task)
    task.add_done_callback(response_tasks.discard)


def instrument(context):
    context.on('request', on_request)
    context.on('response', on_response)


async def dismiss_optional_login(page):
    # Use only an actual visible close control; do not remove overlays or alter page state.
    candidates = page.locator('[aria-label="关闭"], [aria-label="Close"], [class*="close"], [class*="Close"]')
    for index in range(min(await candidates.count(), 25)):
        candidate = candidates.nth(index)
        if await candidate.is_visible():
            metadata = await candidate.evaluate('(e) => ({tag:e.tagName, cls:e.className, text:e.innerText?.slice(0,40), role:e.getAttribute("role")})')
            cls = str(metadata.get('cls', '')).lower()
            box = await candidate.bounding_box()
            # The inspected 1365x900 screenshot places the login dialog close
            # icon at (1075,289). Click only a real visible close control there.
            at_login_close = box and 1055 <= box['x'] <= 1085 and 270 <= box['y'] <= 300
            if at_login_close or ('close' in cls and ('login' in cls or 'modal' in cls)):
                await candidate.click(timeout=2000)
                print('[XIANYU-MATRIX] OPTIONAL_LOGIN_CLOSED ' + json.dumps(metadata, ensure_ascii=False), flush=True)
                return True
    return False


async def case(page, name, action):
    global phase
    phase = name
    start = asyncio.get_running_loop().time()
    observation = {'name': name, 'requestedKeyword': KEYWORD}
    try:
        await action()
        for _ in range(30):
            if any(r['phase'] == name for r in responses):
                break
            await asyncio.sleep(1)
        # Let ordinary page retries finish before changing the active keyword.
        await asyncio.sleep(6)
        try:
            await page.get_by_text('加载中...', exact=True).wait_for(state='hidden', timeout=6000)
        except Exception:
            pass
        visible_text = await page.locator('body').inner_text(timeout=8000)
        observation.update({
            'title': await page.title(),
            'url': page.url,
            'itemLinksOnEntirePage': await page.locator('a[href*="/item"]').count(),
            'pageMarkers': [marker for marker in ('加载中...', '猜你喜欢', '没有找到', '立即登录', '新发布') if marker in visible_text],
            'headerText': visible_text[:800],
            'inputs': await page.locator('input:visible').evaluate_all('(els) => els.map(e => ({type:e.type, placeholder:e.placeholder}))'),
            'visibleCloseControls': await page.locator('[class*="close"]:visible, [class*="Close"]:visible').evaluate_all('(els) => els.slice(0,15).map(e => ({tag:e.tagName, cls:e.className, text:e.innerText?.slice(0,40)}))'),
        })
        frames = []
        for frame in page.frames:
            if frame == page.main_frame or 'passport.goofish.com' not in frame.url:
                continue
            try:
                text = await frame.locator('body').inner_text(timeout=1000)
                frames.append([marker for marker in ('短信登录','密码登录','手机扫码安全登录','滑块','请按住滑块','向右滑动') if marker in text])
            except Exception:
                pass
        observation['loginFrameMarkers'] = frames
        await page.screenshot(path=str(OUT / f'xianyu-{PREFIX}-{name}.png'), full_page=False, timeout=8000)
    except Exception as error:
        observation['actionError'] = type(error).__name__
        observation['actionErrorSummary'] = str(error)[:1500]
    observation['responses'] = [r for r in responses if r['phase'] == name]
    observation['elapsedSeconds'] = round(asyncio.get_running_loop().time() - start, 1)
    observation['verdict'] = 'candidate_success' if any(r.get('businessSuccess') and r.get('resultCount', 0) > 0 for r in observation['responses']) else 'business_error' if any(r.get('ret') and not r.get('businessSuccess') for r in observation['responses']) else 'unverified'
    report['cases'].append(observation)
    save()
    print('[XIANYU-MATRIX] CASE ' + json.dumps({k: observation.get(k) for k in ('name', 'requestedKeyword', 'itemLinksOnEntirePage', 'pageMarkers', 'elapsedSeconds', 'verdict', 'actionError')}, ensure_ascii=False), flush=True)
    return observation


def save():
    (OUT / f'xianyu-{PREFIX}-matrix.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


async def main():
    global KEYWORD
    playwright = browser = context = None
    target = 'https://www.goofish.com/search?q=' + quote(KEYWORD)
    try:
        if args.external_cdp:
            playwright = await async_playwright().start()
            browser = await playwright.chromium.connect_over_cdp(args.external_cdp)
            context = browser.contexts[0]
        else:
            playwright, browser = await runtime.connect_to_chrome()
            context = await browser.new_context(viewport={'width':1365,'height':900}, locale='zh-CN')
        report['initialCookieCount'] = len(await context.cookies())
        report['browserVersion'] = browser.version
        if not args.external_cdp:
            for proc in Path('/proc').glob('[0-9]*'):
                try:
                    argv = (proc / 'cmdline').read_bytes().decode().split('\0')
                    if argv and Path(argv[0]).name == 'chrome' and '--remote-debugging-port=9222' in argv and not any(a.startswith('--type=') for a in argv):
                        report['runtime'] = {'headless': any(a.startswith('--headless') for a in argv), 'directNetwork': '--no-proxy-server' in argv, 'display': os.environ.get('DISPLAY'), 'proxyEnabled': os.environ.get('PROXY_ENABLED')}
                except (OSError, UnicodeDecodeError):
                    pass
        instrument(context)
        page = await context.new_page()
        await page.set_viewport_size({'width':1365,'height':900})
        result = None
        if not args.ui_only:
            result = await case(page, 'direct_search', lambda: page.goto(target, wait_until='domcontentloaded', timeout=35000))
        if result and result['verdict'] != 'candidate_success':
            print('[XIANYU-MATRIX] Retaining context and waiting 30 seconds before a single reload.', flush=True)
            await asyncio.sleep(30)
            await case(page, 'same_session_reload', lambda: page.reload(wait_until='domcontentloaded', timeout=35000))
        global phase
        phase = 'homepage_navigation'
        await page.goto('https://www.goofish.com/', wait_until='domcontentloaded', timeout=35000)
        await page.locator('input:visible').first.wait_for(state='visible', timeout=12000)
        await asyncio.sleep(5)
        await dismiss_optional_login(page)
        async def submit_search():
            search_box = page.locator('input:visible').first
            await search_box.fill(KEYWORD, timeout=8000)
            await search_box.press('Enter', timeout=8000)
        if args.ui_only:
            report['keywordSequence'] = args.keywords
            for index, keyword in enumerate(args.keywords):
                KEYWORD = keyword
                await dismiss_optional_login(page)
                await case(page, f'ui_search_{index + 1}', submit_search)
                await asyncio.sleep(4)
                if args.newest and index == 0:
                    await dismiss_optional_login(page)
                    async def select_newest():
                        await page.get_by_text('新发布', exact=True).click(timeout=8000)
                        await page.get_by_text('最新', exact=True).click(timeout=8000)
                    await case(page, 'newest_sort', select_newest)
                    await asyncio.sleep(4)
        else:
            await case(page, 'homepage_enter', submit_search)
        if args.external_cdp and not args.ui_only:
            KEYWORD = '手机'
            await dismiss_optional_login(page)
            await case(page, 'common_keyword_control', submit_search)
        if not args.external_cdp and not args.ui_only:
            await context.close()
            context = browser.contexts[0]
            instrument(context)
            report['persistentInitialCookieCount'] = len(await context.cookies())
            page = await context.new_page()
            await page.set_viewport_size({'width':1365,'height':900})
            await case(page, 'persistent_default_context', lambda: page.goto(target, wait_until='domcontentloaded', timeout=35000))
    except Exception as error:
        report['fatalError'] = type(error).__name__
        report['fatalErrorSummary'] = str(error).split('Call log:')[0][:500]
        print('[XIANYU-MATRIX] ERROR ' + report['fatalErrorSummary'], flush=True)
    finally:
        if response_tasks:
            await asyncio.gather(*list(response_tasks), return_exceptions=True)
        save()
        if context and not args.external_cdp:
            try:
                await context.close()
            except Exception:
                pass
        if playwright:
            await playwright.stop()
        if not args.external_cdp:
            runtime.shutdown_chrome()
            runtime.shutdown_xvfb()
        passed = any(c['verdict'] == 'candidate_success' for c in report['cases'])
        print('[XIANYU-MATRIX] FINAL ' + json.dumps({'candidateSuccess':passed, 'cases':[(c['name'],c['verdict']) for c in report['cases']]},ensure_ascii=False), flush=True)
    return 0 if passed else 2

sys.exit(asyncio.run(main()))
