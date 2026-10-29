#!/usr/bin/env python3
"""Own one Yahoo browser profile; publish validated cookies without logging them."""
import argparse
import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import tempfile
import time
from urllib.parse import urlsplit

MY_URL = "https://auctions.yahoo.co.jp/my"
# Current /my uses a bidding navigation link; older pages exposed logout.
# Both are only accepted together with an exact Yahoo personal-page URL.
AUTH_SELECTOR = 'a[href*="login.yahoo.co.jp"][href*="logout"], a[href="/my/bidding"], a[href="https://auctions.yahoo.co.jp/my/bidding"]'
COOKIE_KEYS = ("name", "value", "domain", "path", "expires", "httpOnly", "secure", "sameSite", "partitionKey")


class SessionFailure(Exception):
    def __init__(self, code, needs_login=False):
        super().__init__(code)
        self.code = code
        self.needs_login = needs_login


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.chmod(0o700)


def read_json(path):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except (ValueError, OSError):
        raise SessionFailure("STATE_UNREADABLE") from None


def atomic_json(path, data):
    # Same-directory rename prevents readers from seeing a partial credential file.
    fd, temporary = tempfile.mkstemp(prefix=".state-", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(data, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@contextmanager
def profile_lock(directory):
    private_directory(directory)
    with (directory / "profile.lock").open("a+") as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SessionFailure("PROFILE_BUSY") from None
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def is_my_page(url):
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.hostname == "auctions.yahoo.co.jp" and parsed.path in (
        "/my", "/my/", "/user/jp/show/mystatus")


def is_login_page(url):
    host = urlsplit(url).hostname or ""
    return host == "login.yahoo.co.jp" or host.endswith(".login.yahoo.co.jp")


def auction_cookies(cookies, now=None):
    now = time.time() if now is None else now
    result = []
    for cookie in cookies:
        domain = cookie.get("domain", "")
        bare = domain.lstrip(".")
        matches = any(host == bare or (domain.startswith(".") and host.endswith("." + bare))
                      for host in ("auctions.yahoo.co.jp", "page.auctions.yahoo.co.jp"))
        if not (bare == "yahoo.co.jp" or bare.endswith(".yahoo.co.jp")) or not matches:
            continue
        expiry = cookie.get("expires", -1)
        if expiry != -1 and expiry <= now:
            continue
        result.append({key: cookie[key] for key in COOKIE_KEYS if key in cookie})
    return result


def record_failure(directory, failure):
    previous = read_json(directory / "session.json") or {"version": 1, "cookies": [], "validatedAt": None}
    # Once invalidated, only a successful interactive login may restore readiness.
    previous.update(status="needs_login" if failure.needs_login or previous.get("status") == "needs_login" else "error",
                    attemptedAt=utc_now(), lastError=failure.code)
    # Retain last good cookies/timestamp. Consumers reject needs_login and stale data.
    atomic_json(directory / "session.json", previous)


def status_summary(directory):
    state = read_json(directory / "session.json") or {}
    return {"status": state.get("status", "not_initialized"),
            "validatedAt": state.get("validatedAt"), "attemptedAt": state.get("attemptedAt"),
            "lastError": state.get("lastError"), "cookieCount": len(state.get("cookies", []))}


def browser_options(args, headed):
    options = {"headless": not headed, "channel": args.channel,
               "chromium_sandbox": not args.no_sandbox,
               "accept_downloads": False, "viewport": {"width": 1280, "height": 900}}
    if args.disable_http2:
        options["args"] = ["--disable-http2"]
    if args.proxy:
        parsed = urlsplit(args.proxy)
        if parsed.scheme not in ("http", "https", "socks5") or not parsed.hostname or parsed.username or parsed.password:
            raise SessionFailure("PROXY_CONFIG_INVALID")
        options["proxy"] = {"server": args.proxy}
        # Keep proxy credentials out of command arguments and logs.
        if os.environ.get("YAHOO_PROXY_USERNAME"):
            options["proxy"].update(username=os.environ["YAHOO_PROXY_USERNAME"],
                                    password=os.environ.get("YAHOO_PROXY_PASSWORD", ""))
    return options


async def restore_missing_session_cookies(context, directory):
    # Chrome may discard session cookies on process exit. Restore only missing,
    # unexpired cookies from the last successful browser snapshot; the profile wins.
    backup = read_json(directory / "browser-state.json")
    if not backup:
        return
    current = await context.cookies()
    key = lambda c: (c["name"], c["domain"], c["path"], c.get("partitionKey"))
    present = {key(c) for c in current}
    missing = [c for c in backup.get("cookies", []) if key(c) not in present and
               (c.get("expires", -1) == -1 or c["expires"] > time.time())]
    if missing:
        await context.add_cookies(missing)


async def wait_authenticated(page, selector, timeout, interactive=False, target=MY_URL):
    from playwright.async_api import Error as BrowserError
    # Yahoo/proxy connections occasionally close before navigation completes.
    # Bound navigation to 3 x 30s + backoff, leaving time for auth within the
    # service's 150s timeout. Never retry login or markup failures here.
    transient_errors = ("net::ERR_CONNECTION_CLOSED", "net::ERR_CONNECTION_RESET",
                        "net::ERR_TIMED_OUT", "net::ERR_PROXY_CONNECTION_FAILED",
                        "net::ERR_TUNNEL_CONNECTION_FAILED")
    for attempt in range(3):
        try:
            response = await page.goto(target, wait_until="domcontentloaded", timeout=30000)
            break
        except BrowserError as error:
            if not any(code in str(error) for code in transient_errors):
                raise
            if attempt == 2:
                raise SessionFailure("NETWORK_ERROR") from None
            await asyncio.sleep(2 * (attempt + 1))
    if response is None or response.status >= 400:
        raise SessionFailure("UPSTREAM_ERROR")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not interactive and is_login_page(page.url):
            raise SessionFailure("NEEDS_LOGIN", needs_login=True)
        if is_my_page(page.url):
            for element in await page.locator(selector).all():
                if await element.is_visible():
                    return
        await asyncio.sleep(0.5)
    if is_login_page(page.url):
        raise SessionFailure("NEEDS_LOGIN", needs_login=True)
    raise SessionFailure("AUTH_UNVERIFIED")


async def refresh_context(context, directory, selector, timeout, interactive=False):
    page = context.pages[0] if context.pages else await context.new_page()
    await wait_authenticated(page, selector, timeout, interactive)
    # Give redirects/Set-Cookie handlers a chance to finish before taking a snapshot.
    await page.wait_for_timeout(1000)
    if not is_my_page(page.url) or not any([await element.is_visible() for element in await page.locator(selector).all()]):
        raise SessionFailure("AUTH_UNVERIFIED")
    state = await context.storage_state(indexed_db=True)
    cookies = auction_cookies(state["cookies"])
    if not cookies:
        raise SessionFailure("COOKIES_MISSING")
    atomic_json(directory / "browser-state.json", state)
    now = utc_now()
    atomic_json(directory / "session.json", {"version": 1, "status": "ready", "validatedAt": now,
                "attemptedAt": now, "lastError": None, "cookies": cookies})


async def run_browser(args):
    directory = args.state_dir
    with profile_lock(directory):
        try:
            state = read_json(directory / "session.json")
            if args.command == "refresh" and (not state or state.get("status") == "needs_login"):
                raise SessionFailure("NEEDS_LOGIN", needs_login=True)
            if args.command == "login" and not os.environ.get("DISPLAY"):
                raise SessionFailure("DISPLAY_REQUIRED")
            from playwright.async_api import async_playwright
            async with async_playwright() as playwright:
                context = await playwright.chromium.launch_persistent_context(
                    str(directory / "profile"), **browser_options(args, args.command == "login"))
                try:
                    await restore_missing_session_cookies(context, directory)
                    await refresh_context(context, directory, args.auth_selector,
                                          args.login_timeout if args.command == "login" else 25,
                                          interactive=args.command == "login")
                finally:
                    await context.close()
        except SessionFailure as failure:
            record_failure(directory, failure)
            raise
        except Exception:
            # Browser errors can contain URLs, headers or proxy passwords.
            failure = SessionFailure("BROWSER_ERROR")
            record_failure(directory, failure)
            raise failure from None


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("login", "refresh", "status"))
    parser.add_argument("--state-dir", type=Path, default=Path(os.environ.get("YAHOO_SESSION_DIR", ".yahoo-session")))
    parser.add_argument("--auth-selector", default=os.environ.get("YAHOO_AUTH_SELECTOR", AUTH_SELECTOR))
    parser.add_argument("--channel", choices=("chrome", "chromium"), default=os.environ.get("YAHOO_BROWSER_CHANNEL", "chrome"))
    parser.add_argument("--proxy", default=os.environ.get("YAHOO_BROWSER_PROXY"))
    parser.add_argument("--disable-http2", action="store_true",
                        default=os.environ.get("YAHOO_BROWSER_DISABLE_HTTP2") == "1",
                        help="Use HTTP/1.1 for proxies with unreliable HTTP/2 connections")
    parser.add_argument("--login-timeout", type=int, default=900)
    parser.add_argument("--no-sandbox", action="store_true", help="Only for an already isolated container that cannot use Chrome sandboxing")
    args = parser.parse_args()
    args.state_dir = args.state_dir.expanduser().resolve()
    try:
        if args.command != "status":
            if args.command == "login":
                print("Complete Yahoo login in the remote browser; waiting for the configured signed-in marker.", flush=True)
            asyncio.run(run_browser(args))
        print(json.dumps(status_summary(args.state_dir), ensure_ascii=False))
        return 0
    except SessionFailure as failure:
        print(json.dumps({"error": failure.code}))
        return 2 if failure.needs_login else 1
    except KeyboardInterrupt:
        print(json.dumps({"error": "INTERRUPTED"}))
        return 130
    except Exception:
        print(json.dumps({"error": "LOCAL_ERROR"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
