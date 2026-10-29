import asyncio
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import session_manager as manager


class StateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        manager.private_directory(self.directory)

    def tearDown(self):
        self.temp.cleanup()

    def test_failure_preserves_last_good_and_private_permissions(self):
        original = {"version": 1, "status": "ready", "validatedAt": "original-time",
                    "cookies": [{"name": "fake", "value": "synthetic-secret"}]}
        manager.atomic_json(self.directory / "session.json", original)
        manager.record_failure(self.directory, manager.SessionFailure("UPSTREAM_ERROR"))
        failed = manager.read_json(self.directory / "session.json")
        self.assertEqual(failed["cookies"], original["cookies"])
        self.assertEqual(failed["validatedAt"], "original-time")
        self.assertEqual(failed["status"], "error")
        manager.record_failure(self.directory, manager.SessionFailure("NEEDS_LOGIN", True))
        self.assertEqual(manager.status_summary(self.directory)["status"], "needs_login")
        manager.record_failure(self.directory, manager.SessionFailure("DISPLAY_REQUIRED"))
        self.assertEqual(manager.status_summary(self.directory)["status"], "needs_login")
        self.assertNotIn("synthetic-secret", json.dumps(manager.status_summary(self.directory)))
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.directory / "session.json").stat().st_mode & 0o777, 0o600)

    def test_atomic_replace_failure_keeps_previous_snapshot(self):
        path = self.directory / "session.json"
        manager.atomic_json(path, {"generation": 1})
        with patch.object(manager.os, "replace", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                manager.atomic_json(path, {"generation": 2})
        self.assertEqual(manager.read_json(path), {"generation": 1})
        self.assertEqual(list(self.directory.glob(".state-*")), [])

    def test_exclusive_profile_lock_released_after_failure(self):
        with self.assertRaisesRegex(ValueError, "test"):
            with manager.profile_lock(self.directory):
                with self.assertRaisesRegex(manager.SessionFailure, "PROFILE_BUSY"):
                    with manager.profile_lock(self.directory):
                        self.fail("overlapping owner")
                raise ValueError("test")
        with manager.profile_lock(self.directory):
            pass

    def test_export_filters_domains_without_widening_cookie_scope(self):
        cookie = {"name": "test", "value": "fake", "domain": "auctions.yahoo.co.jp", "path": "/my",
                  "expires": -1, "httpOnly": True, "secure": True, "sameSite": "Lax"}
        variants = [cookie, {**cookie, "domain": ".yahoo.co.jp"},
                    {**cookie, "domain": "yahoo.co.jp"},  # Host-only: not sent to auctions.
                    {**cookie, "domain": "mail.yahoo.co.jp"},
                    {**cookie, "domain": ".yahoo.co.jp.evil.example"}, {**cookie, "expires": 1}]
        self.assertEqual(manager.auction_cookies(variants, now=100), variants[:2])


@unittest.skipUnless(os.environ.get("YAHOO_TEST_BROWSER") == "1", "Enable explicitly for installed Chrome + Xvfb")
class BrowserTests(unittest.IsolatedAsyncioTestCase):
    async def test_headed_to_headless_rotation_and_invalid_login(self):
        from playwright.async_api import async_playwright
        with tempfile.TemporaryDirectory() as directory_name:
            directory = Path(directory_name)
            manager.private_directory(directory)
            async with async_playwright() as playwright:
                options = {"channel": "chrome", "chromium_sandbox": True, "args": ["--disable-http2"]}
                seen = []
                aborted = []
                async def authenticated(route):
                    if not aborted:
                        aborted.append(True)
                        await route.abort("connectionclosed")
                        return
                    seen.append(await route.request.header_value("cookie") or "")
                    value = "rotated" if len(seen) == 1 else "rotated-again"
                    await route.fulfill(status=200, content_type="text/html",
                        headers={"set-cookie": f"fake-session={value}; Domain=.yahoo.co.jp; Path=/; HttpOnly; Secure; SameSite=Lax"},
                        body='<html><a href="/my/bidding">入札中</a></html>')

                # All requests are intercepted; no Yahoo account or external service is used.
                context = await playwright.chromium.launch_persistent_context(str(directory / "profile"), headless=False, **options)
                try:
                    await context.route("**/*", authenticated)
                    await context.add_cookies([{"name": "fake-session", "value": "initial", "domain": ".yahoo.co.jp", "path": "/", "secure": True, "httpOnly": True}])
                    await manager.refresh_context(context, directory, manager.AUTH_SELECTOR, 2, interactive=True)
                finally:
                    await context.close()
                first = manager.read_json(directory / "session.json")
                self.assertEqual(first["cookies"][0]["value"], "rotated")
                self.assertIn("fake-session=initial", seen[0])

                context = await playwright.chromium.launch_persistent_context(str(directory / "profile"), headless=True, **options)
                try:
                    await context.route("**/*", authenticated)
                    # Simulate Chrome discarding session cookies when it exits.
                    await context.clear_cookies()
                    await manager.restore_missing_session_cookies(context, directory)
                    await manager.refresh_context(context, directory, manager.AUTH_SELECTOR, 2)
                    self.assertIn("fake-session=rotated", seen[-1])
                    good = manager.read_json(directory / "session.json")
                    self.assertTrue(good["cookies"][0]["httpOnly"])
                    self.assertTrue(good["cookies"][0]["secure"])
                    self.assertEqual(good["cookies"][0]["domain"], ".yahoo.co.jp")
                    self.assertEqual(good["cookies"][0]["value"], "rotated-again")

                    await context.unroute("**/*")
                    async def unverified(route):
                        await route.fulfill(status=200, content_type="text/html", body="Personal page unavailable")
                    await context.route("**/*", unverified)
                    with self.assertRaises(manager.SessionFailure) as missing_marker:
                        await manager.refresh_context(context, directory, manager.AUTH_SELECTOR, 1)
                    self.assertEqual(missing_marker.exception.code, "AUTH_UNVERIFIED")
                    self.assertEqual(manager.read_json(directory / "session.json"), good)

                    await context.unroute("**/*")
                    async def disconnected(route):
                        await route.abort("connectionclosed")
                    await context.route("**/*", disconnected)
                    with self.assertRaises(manager.SessionFailure) as disconnected_error:
                        await manager.refresh_context(context, directory, manager.AUTH_SELECTOR, 2)
                    self.assertEqual(disconnected_error.exception.code, "NETWORK_ERROR")
                    self.assertFalse(disconnected_error.exception.needs_login)
                    self.assertEqual(manager.read_json(directory / "session.json"), good)

                    await context.unroute("**/*")
                    async def unavailable(route):
                        await route.fulfill(status=503, body="Temporarily unavailable")
                    await context.route("**/*", unavailable)
                    with self.assertRaises(manager.SessionFailure) as transient:
                        await manager.refresh_context(context, directory, manager.AUTH_SELECTOR, 2)
                    self.assertFalse(transient.exception.needs_login)
                    manager.record_failure(directory, transient.exception)
                    self.assertEqual(manager.read_json(directory / "session.json")["validatedAt"], good["validatedAt"])

                    await context.unroute("**/*")
                    async def login_redirect(route):
                        if route.request.url.startswith(manager.MY_URL):
                            await route.fulfill(status=302, headers={"location": "https://login.yahoo.co.jp/config/login"}, body="")
                        else:
                            await route.fulfill(status=200, content_type="text/html", body='<a href="/my/bidding">Login required</a>')
                    await context.route("**/*", login_redirect)
                    with self.assertRaises(manager.SessionFailure) as failed:
                        await manager.refresh_context(context, directory, manager.AUTH_SELECTOR, 2)
                    self.assertTrue(failed.exception.needs_login)
                    self.assertEqual(manager.read_json(directory / "session.json")["cookies"], good["cookies"])
                    manager.record_failure(directory, failed.exception)
                    invalid = manager.read_json(directory / "session.json")
                    self.assertEqual(invalid["status"], "needs_login")
                    self.assertEqual(invalid["validatedAt"], good["validatedAt"])
                    self.assertEqual(invalid["cookies"], good["cookies"])
                finally:
                    await context.close()


if __name__ == "__main__":
    unittest.main()
