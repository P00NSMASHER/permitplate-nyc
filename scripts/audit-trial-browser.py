#!/usr/bin/env python3
"""Real local-browser trial UX audit; no mailto clicks, external requests or payments."""
import functools
import http.server
import json
import mimetypes
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
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
    # Match production HTTPS: WebKit correctly upgrades all HTTP subresources
    # under the site's strict upgrade-insecure-requests CSP. A local plain
    # HTTP test server would falsely report that scripts and navigation fail.
    cert_dir = tempfile.TemporaryDirectory(prefix="permitplate-trial-browser-")
    cert = str(Path(cert_dir.name) / "cert.pem")
    key = str(Path(cert_dir.name) / "key.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                    "-keyout", key, "-out", cert, "-days", "1",
                    "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(certfile=cert, keyfile=key)
    server.socket = tls.wrap_socket(server.socket, server_side=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    browser_name = os.environ.get("QA_BROWSER", "chromium")
    checked = 0
    with sync_playwright() as api:
        browser = getattr(api, browser_name).launch(headless=True)
        try:
            for width, height in [(375, 812), (768, 1024), (1440, 900)]:
                context = browser.new_context(ignore_https_errors=True, viewport={"width": width, "height": height},
                                              reduced_motion="reduce")
                page = context.new_page()
                page.on('console', lambda msg: print('BROWSER_CONSOLE',browser_name,msg.type,msg.text))
                page.on('pageerror', lambda err: print('BROWSER_PAGEERROR',browser_name,str(err)))
                page.on('requestfailed', lambda req: print('BROWSER_REQUEST_FAILED',browser_name,req.url,req.failure))
                page.goto("https://127.0.0.1:%d/trial.html" % server.server_address[1],
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
                    if toggle.get_attribute("aria-expanded") != "true":
                        print("MENU_DIAGNOSTIC",browser_name,width,page.evaluate("""() => ({
                          state: document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded'),
                          menuClass: document.querySelector('[data-menu]').className,
                          scripts: [...document.scripts].map(s=>({src:s.src,loaded:s.readyState})),
                          csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]').content
                        })"""))
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
                    page.get_by_label("Work email for our reply").fill("buyer@vendor.example.com")
                    page.get_by_label("Vendor category").select_option(category)
                    page.get_by_label("NYC territory").select_option(territory)
                    scope = page.locator("[data-trial-scope]")
                    assert scope.is_visible(), "Scope preview should appear once the two choices are selected"
                    assert page.locator("[data-trial-scope-summary]").inner_text().startswith("Selected:")
                    assert "not a guarantee" in page.locator("[data-trial-scope-focus]").inner_text()
                    assert "No-match updates" in scope.inner_text()
                    assert page.locator("[data-trial-scope-copy]").is_visible()
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

            # Exercise the actual one-step Cloudflare-origin mode with ALL
            # requests intercepted locally. No private production API calls,
            # customer records, provider sends or payments are created.
            direct_context = browser.new_context(viewport={"width": 375, "height": 812},
                                                  reduced_motion="reduce")
            direct_state = {"mode": "accepted", "posts": []}
            def direct_route(route):
                uri = urlsplit(route.request.url)
                if uri.path == "/api/trial-request":
                    assert route.request.method == "POST"
                    payload = route.request.post_data_json
                    assert payload["consent"] is True
                    assert payload["email"] == "test-buyer@vendor-customer.com"
                    assert payload["category"] == "equipment"
                    direct_state["posts"].append(payload)
                    if direct_state["mode"] == "accepted":
                        route.fulfill(status=202, content_type="application/json",
                                      body=json.dumps({"status":"RECEIVED_FOR_REVIEW"}))
                    else:
                        route.fulfill(status=503, content_type="application/json",
                                      body=json.dumps({"status":"NOT_RECEIVED"}))
                    return
                route_path = uri.path.lstrip("/") or "index.html"
                if route_path == "trial":
                    route_path = "trial.html"
                file_path = (DIST / route_path).resolve()
                if not file_path.is_relative_to(DIST.resolve()) or not file_path.is_file():
                    route.fulfill(status=404, body="not found")
                    return
                mime = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
                route.fulfill(status=200, path=str(file_path), content_type=mime)
            direct_context.route("https://permitplate.retallyrecovery.com/**",direct_route)
            for accepted in [True, False]:
                direct_state["mode"] = "accepted" if accepted else "failure"
                page = direct_context.new_page()
                page.goto("https://permitplate.retallyrecovery.com/trial",wait_until="load")
                page.get_by_label("Business name").fill("FICTIONAL Vendor Test")
                page.get_by_label("Business website").fill("https://vendor-customer.com/nyc")
                page.get_by_label("Work email for our reply").fill("test-buyer@vendor-customer.com")
                page.get_by_label("Vendor category").select_option("equipment")
                page.get_by_label("NYC territory").select_option("Brooklyn")
                assert page.locator("[data-trial-scope]").is_visible()
                assert "Brooklyn" in page.locator("[data-trial-scope-summary]").inner_text()
                assert "Kitchen equipment" in page.locator("[data-trial-scope-summary]").inner_text()
                page.get_by_role("button",name="Send my free-trial request").click()
                if accepted:
                    page.locator("[data-trial-success]").wait_for(state="visible",timeout=7000)
                    assert page.get_by_role("heading",name="Request received").is_visible()
                    assert "does not reserve" in page.locator("[data-trial-success]").inner_text()
                    assert page.locator("[data-trial-request]").is_hidden()
                    assert page.locator("[data-trial-email]").is_hidden()
                else:
                    page.locator("[data-trial-fallback]").wait_for(state="visible",timeout=7000)
                    assert page.locator("[data-trial-email]").is_visible()
                    assert page.locator("[data-trial-success]").is_hidden()
                    assert "could not confirm" in page.locator("[data-trial-status]").inner_text().lower()
                    assert page.locator("[data-trial-request]").is_visible()
                page.close()
            assert len(direct_state["posts"]) == 2
            direct_context.close()
            print({"status":"PASS","browser":browser_name,
                   "direct_online_success_and_failure_mocked":2,
                   "realOnlineSubmissions":0,"realEmails":0,"realPayments":0})
        finally:
            browser.close()
    server.shutdown()
    cert_dir.cleanup()
    print({"status": "PASS", "browser": browser_name, "viewports": 3,
           "valid_and_rejection_pairs": checked, "realMailtoClicks": 0,
           "productionHTTPRequests": 0, "payments": 0})

if __name__ == "__main__":
    main()
