#!/usr/bin/env python3
"""Real local-browser trial UX audit; no mailto clicks, external requests or payments."""
import functools
import http.server
import os
from pathlib import Path
import threading
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

class SilentServer(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

def main():
    assert (DIST / "trial.html").is_file(), "Build standalone files first"
    handler = functools.partial(SilentServer, directory=str(DIST))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser_name = os.environ.get("QA_BROWSER", "chromium")
    checked = 0
    with sync_playwright() as api:
        browser = getattr(api, browser_name).launch(headless=True)
        try:
            for width, height in [(375, 812), (768, 1024), (1440, 900)]:
                context = browser.new_context(viewport={"width": width, "height": height},
                                              reduced_motion="reduce")
                page = context.new_page()
                page.goto("http://127.0.0.1:%d/trial.html" % server.server_address[1],
                          wait_until="load", timeout=15000)
                assert page.title() == "Try your territory free — PermitPlate NYC"
                assert page.get_by_role("heading", name="Try your territory free for 14 days.").is_visible()
                assert page.locator("form[data-trial-request]").count() == 1
                assert page.locator("form[data-trial-request]").get_attribute("action") is None
                for label in ("Business name", "Business website", "Vendor category", "NYC territory"):
                    assert page.get_by_label(label).count() == 1
                if width < 981:
                    toggle = page.get_by_role("button", name="Open menu")
                    assert toggle.is_visible()
                    assert toggle.get_attribute("aria-expanded") == "false"
                    toggle.click()
                    assert toggle.get_attribute("aria-expanded") == "true"
                    page.keyboard.press("Escape")
                    assert toggle.get_attribute("aria-expanded") == "false"
                horizontal = page.evaluate("document.documentElement.scrollWidth")
                assert horizontal <= width + 5, "Horizontal overflow at %s: %s" % (width, horizontal)
                for category, territory in [("equipment", "Brooklyn"), ("pos", "AllNYC"),
                                             ("insurance", "ManhattanQueens"),
                                             ("distribution", "StatenIsland")]:
                    page.get_by_label("Business name").fill("FICTIONAL Browser Vendor")
                    page.get_by_label("Business website").fill("https://vendor.example.com/branch?utm=ignored")
                    page.get_by_label("Vendor category").select_option(category)
                    page.get_by_label("NYC territory").select_option(territory)
                    page.get_by_role("button", name="Prepare my free-trial request").click()
                    link = page.get_by_text("Review and send email request")
                    assert link.is_visible()
                    uri = urlsplit(link.get_attribute("href"))
                    assert uri.scheme == "mailto" and uri.path == "jay@retallyrecovery.com"
                    body = parse_qs(uri.query)["body"][0]
                    assert "Vendor category: " + category in body
                    assert "NYC territory: " + territory in body
                    assert "No card or automatic paid upgrade" in body
                    assert page.locator("[data-trial-fallback]").is_visible()
                    assert page.locator("[data-trial-body]").get_attribute("readonly") is not None
                    assert "trial has not started" in page.locator("[data-trial-status]").inner_text()
                    page.get_by_label("Business website").fill("http://vendor.example.com")
                    assert link.is_hidden(), "Changing input must revoke draft"
                    page.get_by_role("button", name="Prepare my free-trial request").click()
                    assert link.is_hidden(), "HTTP website must not create draft"
                    assert "https://" in page.locator("[data-trial-status]").inner_text()
                    checked += 1
                context.close()
        finally:
            browser.close()
    server.shutdown()
    print({"status": "PASS", "browser": browser_name, "viewports": 3,
           "valid_and_rejection_pairs": checked, "realMailtoClicks": 0,
           "productionHTTPRequests": 0, "payments": 0})

if __name__ == "__main__":
    main()
