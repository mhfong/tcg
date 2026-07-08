"""
Scrape SNKRDUNK sales history for a single apparel / trading card.

What it produces
----------------
A CSV with one row per historical sale:

    source, condition, date, price_jpy, price_hkd, listed_hkd, status, listing_id, url

Source legend
-------------
- "jp"   — pulled from the JP sales-history page (has JPY price + date, all conditions)
- "en"   — pulled from the EN listings page     (has HKD price + sold/list status, no date)

Why two sources
---------------
The JP sales-history page is the only place that exposes a date + JPY price for the
same row, so it's the primary source. The EN listings pages expose HKD prices but
do NOT show when a listing was posted — so we record today's date as the scrape
date and tag the row with source="en" so it's never confused with a true historical
sale.

Conditions scraped
------------------
JP page (all that have data, max 20 per condition):
    A, B, C, D, PSA9, PSA10, PSA8-or-below, ARS10, ARS9, ARS8-or-below
EN pages (only these two conditionIds are exposed on the EN site):
    A   (conditionId=18)
    PSA 10 (conditionId=22)

Output
------
Default: snkrdunk_history.csv next to the script.
Pass --output / -o to override.

Examples
--------
    python scripts/scrape_snkrdunk.py
    python scripts/scrape_snkrdunk.py --apparel-id 515454 --output op05-119.csv
    python scripts/scrape_snkrdunk.py --no-headless  # see the browser
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

try:
    from playwright.async_api import async_playwright
except ImportError:
    print("playwright is required. Install with: pip install playwright && playwright install chromium",
          file=sys.stderr)
    sys.exit(2)

JP_BASE = "https://snkrdunk.com"
EN_BASE = "https://snkrdunk.com/en"

# conditionId used by the EN listings pages
EN_CONDITION_IDS = {
    "A": "18",
    "PSA 10": "22",
}

# Japanese condition labels on the JP sales-history page, mapped to canonical
JP_CONDITION_LABELS = {
    "A": "A",
    "B": "B",
    "C": "C",
    "D": "D",
    "PSA10": "PSA 10",
    "PSA9": "PSA 9",
    "PSA8以下": "PSA 8 or below",
    "ARS10+": "ARS 10+",
    "ARS10": "ARS 10",
    "ARS9": "ARS 9",
    "ARS8以下": "ARS 8 or below",
    "BGS10 BL": "BGS 10 Black Label",
    "BGS10 GL": "BGS 10 Gold Label",
    "BGS9.5": "BGS 9.5",
    "BGS9以下": "BGS 9 or below",
    "他鑑定品": "Other graded",
}

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)


# ─────────────────────────────────────────────────────────────────────────────
# Date parsing
# ─────────────────────────────────────────────────────────────────────────────

JP_DATE_RE = re.compile(r"^(\d{4})/(\d{2})/(\d{2})$")
JP_RELATIVE_HOURS_RE = re.compile(r"^(\d+)\s*時間前$")
JP_RELATIVE_DAYS_RE = re.compile(r"^(\d+)\s*日前$")


def parse_jp_date(text: str, today: date) -> Optional[str]:
    """Parse a JP sales-history date string into ISO YYYY-MM-DD.

    Accepts:
      "YYYY/MM/DD"        → direct
      "N時間前"           → today - N hours (we still call it "today" since
                            history precision is per-day, but a >24h value
                            rolls back to yesterday)
      "N日前"             → today - N days
    Returns None for anything else.
    """
    text = (text or "").strip()
    m = JP_DATE_RE.match(text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = JP_RELATIVE_HOURS_RE.match(text)
    if m:
        hours = int(m.group(1))
        d = today if hours < 24 else today - timedelta(days=1)
        return d.isoformat()
    m = JP_RELATIVE_DAYS_RE.match(text)
    if m:
        return (today - timedelta(days=int(m.group(1)))).isoformat()
    return None


# ─────────────────────────────────────────────────────────────────────────────
# JP sales-history page
# ─────────────────────────────────────────────────────────────────────────────

JP_EXTRACT_JS = """
() => {
  // Each sales-history section is preceded by an h2/h3 like
  // "状態Aの売買履歴" / "状態PSA10の売買履歴". The actual data is in the
  // next sibling <ul.sales-history.item-list> with <li.used> rows.
  const sections = [];
  // Find every header that looks like a sales-history or market chart header
  const headers = Array.from(document.querySelectorAll('h2, h3')).filter(h => {
    const t = h.textContent || '';
    return /売買履歴$/.test(t.trim());
  });
  for (const h of headers) {
    // Extract the condition label (e.g. "状態PSA10の売買履歴" -> "PSA10")
    const text = h.textContent.trim();
    const match = text.match(/状態(.+?)の/);
    if (!match) continue;
    const condition = match[1];
    // Walk forward to find the <ul.sales-history.item-list> sibling
    let node = h.nextElementSibling;
    let ul = null;
    let steps = 0;
    while (node && steps < 5) {
      ul = node.matches && node.matches('ul.sales-history.item-list')
        ? node
        : (node.querySelector ? node.querySelector('ul.sales-history.item-list') : null);
      if (ul) break;
      node = node.nextElementSibling;
      steps++;
    }
    if (!ul) continue;
    const rows = Array.from(ul.querySelectorAll('li.used')).map(li => ({
      date: (li.querySelector('p.date') && li.querySelector('p.date').textContent || '').trim(),
      condition: (li.querySelector('p.size') && li.querySelector('p.size').textContent || '').trim(),
      price_jpy: (li.querySelector('p.price') && li.querySelector('p.price').textContent || '').trim(),
    }));
    sections.push({ condition, rows });
  }
  return sections;
}
"""


async def scrape_jp_sales_history(page, apparel_id: str) -> list[dict]:
    """Return [{condition, date_iso, price_jpy}, ...] for every populated section."""
    url = f"{JP_BASE}/apparels/{apparel_id}/sales-histories"
    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    # The sales-history sections are hydrated by client-side JS after the
    # initial paint. Wait until the first section's <ul> has actual <li.used>
    # rows (not the "no transactions" placeholder).
    await page.wait_for_function(
        "() => { const ul = document.querySelector('ul.sales-history.item-list');"
        " return ul && ul.querySelector('li.used'); }",
        timeout=30_000,
    )
    # Give the other 15 sections a moment to hydrate too.
    await page.wait_for_timeout(2000)
    sections = await page.evaluate(JP_EXTRACT_JS)
    today = date.today()
    out: list[dict] = []
    for sec in sections:
        canon = JP_CONDITION_LABELS.get(sec["condition"], sec["condition"])
        # Only emit rows for conditions we keep (PSA 10 and A)
        app_enum = CONDITION_MAP.get(sec["condition"])
        if not app_enum:
            continue
        for row in sec["rows"]:
            date_iso = parse_jp_date(row["date"], today)
            price_txt = (row["price_jpy"] or "").replace(",", "").strip()
            if not price_txt.isdigit() or not date_iso:
                continue
            out.append({
                "source": "jp",
                "condition": app_enum,
                "date": date_iso,
                "price_jpy": int(price_txt),
                "price_hkd": "",
                "listed_hkd": "",
                "status": "sold",
                "listing_id": "",
                "url": url,
            })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# EN listings page
# ─────────────────────────────────────────────────────────────────────────────

EN_EXTRACT_JS = """
() => {
  const links = document.querySelectorAll('a[href*="/trading-cards/used/listings/"]');
  return Array.from(links).map(a => {
    const id = (a.getAttribute('href') || '').split('/listings/')[1]?.split('?')[0] || '';
    const chip = a.querySelector('.condition-chip')?.textContent.trim() || '';
    const price = a.querySelector('.price')?.textContent.trim() || '';
    const sold = !!a.querySelector('.sold-indicator-text');
    return { id, chip, price, sold };
  });
}
"""


async def _scroll_until_stable(page, *, max_rounds: int = 30, pause_ms: int = 600) -> None:
    """Scroll the page in chunks until no new listing links appear."""
    last = 0
    for _ in range(max_rounds):
        await page.mouse.wheel(0, 4000)
        await page.wait_for_timeout(pause_ms)
        n = await page.evaluate(
            "() => document.querySelectorAll('a[href*=\"/trading-cards/used/listings/\"]').length"
        )
        if n == last:
            # Wait a bit longer once more to be sure
            await page.wait_for_timeout(800)
            n2 = await page.evaluate(
                "() => document.querySelectorAll('a[href*=\"/trading-cards/used/listings/\"]').length"
            )
            if n2 == last:
                return
            last = n2
        else:
            last = n


def parse_hkd(price_text: str) -> Optional[int]:
    m = re.search(r"([\d,]+)", price_text or "")
    if not m:
        return None
    return int(m.group(1).replace(",", ""))


async def scrape_en_listings(page, apparel_id: str, condition_label: str) -> list[dict]:
    """Return [{condition, date, listed_hkd, status, listing_id, url}, ...] from the EN listings page.

    condition_label is the chip text from the EN site (e.g. 'A' or 'PSA 10').
    The output rows use the app enum ('RAW_A' or 'PSA10').
    """
    condition_id = EN_CONDITION_IDS[condition_label]
    app_enum = {"A": "RAW_A", "PSA 10": "PSA10"}[condition_label]
    url = (
        f"{EN_BASE}/trading-cards/{apparel_id}/used"
        f"?sort=latest&isOnlyOnSale=false&conditionId={condition_id}"
    )
    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    await page.wait_for_selector('a[href*="/trading-cards/used/listings/"]', timeout=30_000)
    await _scroll_until_stable(page)
    listings = await page.evaluate(EN_EXTRACT_JS)
    today_iso = date.today().isoformat()
    out: list[dict] = []
    for l in listings:
        if l["chip"] != condition_label:
            continue
        price = parse_hkd(l["price"])
        if price is None:
            continue
        out.append({
            "source": "en",
            "condition": app_enum,
            "date": today_iso,
            "price_jpy": "",
            "price_hkd": price,         # HKD price stored here (not in `price`)
            "listed_hkd": price,         # kept for CSV readability
            "status": "sold" if l["sold"] else "listed",
            "listing_id": l["id"],
            "url": f"{EN_BASE}/trading-cards/used/listings/{l['id']}",
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Driver
# ─────────────────────────────────────────────────────────────────────────────

CSV_FIELDS = ["source", "condition", "date", "price_jpy", "price_hkd", "listed_hkd",
              "status", "listing_id", "url"]

# Only scrape these two conditions. Other conditions (B/C/D/PSA9/ARS/...) are
# ignored because the downstream price_history table only stores PSA 10 and A.
# Mapped to the canonical app enum values used in src/lib/types.ts.
CONDITION_MAP = {
    # JP page label  ->  app enum
    "A":             "RAW_A",
    "PSA10":         "PSA10",
}


async def run(args: argparse.Namespace) -> int:
    apparel_id = args.apparel_id
    rows: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not args.no_headless)
        try:
            ctx = await browser.new_context(
                user_agent=USER_AGENT,
                locale="en-US",
            )
            page = await ctx.new_page()

            # 1) JP sales history (JPY + dates, all conditions)
            print(f"[jp] scraping {JP_BASE}/apparels/{apparel_id}/sales-histories ...", file=sys.stderr)
            jp_rows = await scrape_jp_sales_history(page, apparel_id)
            print(f"[jp] {len(jp_rows)} historical sales", file=sys.stderr)
            rows.extend(jp_rows)

            # 2) EN listings for A and PSA 10 (HKD)
            for cond in ("A", "PSA 10"):
                print(f"[en] scraping {cond} listings ...", file=sys.stderr)
                en_rows = await scrape_en_listings(page, apparel_id, cond)
                print(f"[en] {cond}: {len(en_rows)} listings", file=sys.stderr)
                rows.extend(en_rows)
        finally:
            await browser.close()

    # Sort: jp rows by condition then date desc; en rows keep their listing order
    jp_rows = [r for r in rows if r["source"] == "jp"]
    en_rows = [r for r in rows if r["source"] == "en"]
    jp_rows.sort(key=lambda r: (r["condition"], r["date"]), reverse=True)
    rows = jp_rows + en_rows

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(r)
    print(f"wrote {len(rows)} rows to {out_path}", file=sys.stderr)

    # Short console summary
    print()
    print(f"Condition        JP rows   EN listings")
    print(f"────────────── ──────── ────────────")
    by_cond: dict[str, dict[str, int]] = {}
    for r in rows:
        c = by_cond.setdefault(r["condition"], {"jp": 0, "en": 0})
        if r["source"] == "jp":
            c["jp"] += 1
        else:
            c["en"] += 1
    for cond in sorted(by_cond):
        c = by_cond[cond]
        print(f"{cond:<14} {c['jp']:>8} {c['en']:>11}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apparel-id", default="515454",
                    help="SNKRDUNK apparel id (default: 515454 — OP05-119 Luffy SEC-SPC Silver)")
    ap.add_argument("-o", "--output", default="snkrdunk_history.csv",
                    help="Output CSV path (default: snkrdunk_history.csv)")
    ap.add_argument("--no-headless", action="store_true",
                    help="Run the browser in headed mode (useful for debugging)")
    args = ap.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(main())
