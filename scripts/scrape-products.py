"""
Scrape product pages (title, price, image) for the wedding wishlist.

Usage:
    python scrape-products.py urls.json results.json [--headed]

urls.json is a list of {"category": "...", "url": "..."} objects.
results.json will contain the scraped og:title / og:image / price candidates
for each URL, which you then turn into wishlist items by hand (prices on
e-commerce pages are too inconsistent to trust a single auto-picked value).

Some sites (Cloudflare-protected stores, WAF-protected stores like
sportmaster.kz) block headless/datacenter traffic outright; --headed
sometimes gets past a few of these but not all.
"""

import json
import re
import sys
import time
from playwright.sync_api import sync_playwright

PRICE_RE = re.compile(
    r"(?:[\$₸€]\s?[\d\s.,]{3,12}\d)|(?:\d[\d\s.,]{2,12}\d\s?(?:₸|тг\.?|тенге|\$|USD|KZT))",
    re.IGNORECASE,
)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def scrape(urls, headed=False):
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=not headed,
            args=["--disable-blink-features=AutomationControlled"] if headed else [],
        )
        ctx = browser.new_context(
            user_agent=UA,
            viewport={"width": 1366, "height": 900},
            locale="ru-RU",
        )
        for entry in urls:
            url = entry["url"]
            record = {"url": url, "category": entry.get("category", "")}
            page = ctx.new_page()
            try:
                page.goto(url, timeout=45000, wait_until="domcontentloaded")
                try:
                    page.wait_for_load_state("networkidle", timeout=15000)
                except Exception:
                    pass
                page.wait_for_timeout(4000)
                record["final_url"] = page.url

                def meta(name, attr="property"):
                    el = page.query_selector(f'meta[{attr}="{name}"]')
                    return el.get_attribute("content") if el else None

                record["title"] = page.title()
                record["og_title"] = meta("og:title")
                record["og_image"] = meta("og:image")
                record["og_price"] = meta("product:price:amount") or meta("og:price:amount")
                record["og_currency"] = meta("product:price:currency") or meta("og:price:currency")

                body_text = page.inner_text("body")
                seen = []
                for pr in PRICE_RE.findall(body_text):
                    pr = pr.strip()
                    if pr not in seen:
                        seen.append(pr)
                    if len(seen) >= 8:
                        break
                record["price_candidates"] = seen

                if not record["og_image"]:
                    srcs = []
                    for img in page.query_selector_all("img")[:20]:
                        src = img.get_attribute("src") or img.get_attribute("data-src")
                        if src and src.startswith("http"):
                            srcs.append(src)
                    record["img_candidates"] = srcs[:8]

                record["ok"] = True
            except Exception as e:
                record["ok"] = False
                record["error"] = str(e)
            finally:
                page.close()
            print(f"done: {url} -> ok={record.get('ok')}", file=sys.stderr)
            results.append(record)
            time.sleep(1)
        browser.close()
    return results


if __name__ == "__main__":
    urls_path, out_path = sys.argv[1], sys.argv[2]
    headed = "--headed" in sys.argv
    urls = json.load(open(urls_path, encoding="utf-8"))
    results = scrape(urls, headed=headed)
    json.dump(results, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
