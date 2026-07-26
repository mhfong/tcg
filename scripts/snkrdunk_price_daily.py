#!/usr/bin/env python3
"""Daily SNKRDUNK used-listing price scrape for every mapped card.

For each row in `master_table` that has a `snkrdunk_apparel_id`, fetch
the SNKRDUNK used listings page for two conditions:

  - A     (used, raw):       .../apparels/<id>/used?conditionIds=18
  - PSA10 (used, graded):    .../apparels/<id>/used?conditionIds=22

…and write one row per *active* listing into `price_history` with:

  source        = 'en'
  condition     = 'RAW_A'  | 'PSA10'
  status        = 'listed'
  price         = NULL
  price_hkd     = <integer from the page>
  apparel_id    = <snkrdunk apparel id>
  listing_id    = <snkrdunk listing ULID>
  observed_date = today (UTC)
  card_id       = master_table.id

Dedup
-----
We de-duplicate by (card_id, source, condition, observed_date, listing_id)
because SNKRDUNK listings persist for days at a time. The first time a
listing shows up we record a snapshot; subsequent scrapes on the same day
skip the row instead of producing duplicate price_history rows.

Why Playwright (not plain httpx)?
---------------------------------
snkrdunk.com guards its listing pages with basic anti-bot checks. A
plain request with a vanilla User-Agent returns 403 from the CDN. The
existing `scripts/discover_snkrdunk_apparel_ids.py` already uses
Playwright + Chromium for the same reason, so we follow the same
pattern here.

Usage
-----
  # Dry-run (no Supabase writes, print what would be written):
  python scripts/snkrdunk_price_daily.py --dry-run

  # Apply to all mapped rows (writes only NEW rows):
  python scripts/snkrdunk_price_daily.py

  # Restrict to one card (useful for debugging):
  python scripts/snkrdunk_price_daily.py --only-this <card_id>

  # Restrict to one condition (PSA10 only, 'A' only):
  python scripts/snkrdunk_price_daily.py --only-condition PSA10

Environment
-----------
  SUPABASE_URL                       (required)
  SUPABASE_SERVICE_ROLE_KEY          (required for SELECT + INSERT)
  HEADLESS                           (default 1 — set to 0 for local debugging)
  SCRAPE_LIMIT                       (optional — cap number of cards run per
                                      invocation, useful for back-pressure)
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import os
import re
import sys
import time
from typing import Iterable, Optional

import httpx
from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PWTimeout

# ─── Supabase ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
H_JSON = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    # Prefer the resolved values when columns are not present
    "Prefer": "return=representation",
}

if not SUPABASE_URL or not SUPABASE_KEY:
    # Don't sys.exit on import — only on run. Argparse will validate again.
    pass

# ─── SNKRDUNK URLs ───────────────────────────────────────────────────────
SNKRDUNK_BASE = "https://snkrdunk.com"
CONDITION_IDS = {
    "RAW_A": 18,
    "PSA10": 22,
}
# Map our internal condition to the canonical string used in the DB
# CHECK constraint. (Both are identical here, but keeping the mapping
# makes future additions cheap.)
CONDITION_TO_DB = {"RAW_A": "RAW_A", "PSA10": "PSA10"}

# ─── IO helpers ──────────────────────────────────────────────────────────


def fetch_mapped_rows(only_this: str = "") -> list[dict]:
    """Return every master_table row that has a snkrdunk_apparel_id.

    If only_this is set, filter to that single master_table.id.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    out: list[dict] = []
    offset = 0
    while True:
        params = {
            "select": "id,tcg_type,card_series,card_index,card_name,card_rarity,snkrdunk_apparel_id",
            "snkrdunk_apparel_id": "not.is.null",
            "limit": 1000,
            "offset": offset,
            "order": "id.asc",
        }
        if only_this:
            params = {
                "select": "id,tcg_type,card_series,card_index,card_name,card_rarity,snkrdunk_apparel_id",
                "id": f"eq.{only_this}",
                "limit": 1,
            }
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/master_table",
            params=params,
            headers=H_JSON,
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        out.extend(rows)
        if only_this or len(rows) < 1000:
            break
        offset += 1000
    return out


def fetch_existing_observations(
    card_id: str, observed_date: datetime.date
) -> set[tuple[str, str]]:
    """Return the set of (condition, listing_id) pairs already recorded
    for this card on the given observed_date. Used for dedup.
    """
    params = {
        "select": "condition,listing_id",
        "card_id": f"eq.{card_id}",
        "source": "eq.en",
        "observed_date": f"eq.{observed_date.isoformat()}",
        "limit": 1000,
    }
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/price_history",
        params=params,
        headers=H_JSON,
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json() or []
    return {(row["condition"], row["listing_id"] or "") for row in rows}


def insert_observation(row: dict) -> bool:
    """Insert one price_history row. Returns True on success.

    The DB has no UNIQUE constraint on (card_id, source, condition,
    observed_date, listing_id), so we check for duplicates in the
    application layer before inserting.
    """
    r = httpx.post(
        f"{SUPABASE_URL}/rest/v1/price_history",
        json=row,
        headers=H_JSON,
        timeout=30,
    )
    if r.status_code >= 400:
        print(
            f"  [!] insert failed for {row.get('card_id')} / "
            f"{row.get('listing_id')}: HTTP {r.status_code} {r.text[:200]}",
            file=sys.stderr,
        )
        return False
    return True


# ─── Page scraping ───────────────────────────────────────────────────────
# SNKRDUNK's used listing page renders cards in a virtualized list. The
# DOM nodes we want all carry a stable class name or data attribute;
# we extract each listing's ULID, condition, and price.

# The product cards inside /apparels/<id>/used?conditionIds=… look like:
#   <a class="..." href="/apparels/<apparel_id>/used/<listing_ulid>">
#     <div class="...price...">HK$ ...</div>
#   </a>
# We also want the listing ULID so the dedup key is stable across days.
LISTING_PATH_RE = re.compile(r"/apparels/\d+/used/([A-Z0-9]{6,30})")
PRICE_HKD_RE = re.compile(r"([\d,]+)\s*\n\s*/\s*\n\s*(?:A|PSA\s*10)", re.IGNORECASE)
CONDITION_LABEL_RE = re.compile(
    r"(PSA\s*10|PSA10|RAW\s*A|A\s*\(|Condition\s*[:#]?\s*A\b)",
    re.IGNORECASE,
)


async def open_browser(headless: bool = True) -> tuple[Browser, Page]:
    """Launch a single Chromium instance and return (browser, page)."""
    p = await async_playwright().start()
    browser = await p.chromium.launch(headless=headless)
    context = await browser.new_context(
        user_agent=(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="ja-JP",
        timezone_id="Asia/Tokyo",
    )
    page = await context.new_page()
    return browser, page


async def scroll_until_stable(page: Page, selector: str, max_scrolls: int = 8) -> None:
    """Scroll the used-listing page until the listing container stops
    growing, so we capture every virtualized card.
    """
    last_count = -1
    for _ in range(max_scrolls):
        try:
            await page.wait_for_selector(selector, timeout=4000)
        except PWTimeout:
            break
        count = await page.locator(selector).count()
        if count == last_count:
            break
        last_count = count
        await page.evaluate("() => window.scrollBy(0, document.body.scrollHeight)")
        await page.wait_for_timeout(700)
    # Scroll back to top so subsequent navigation is clean
    await page.evaluate("() => window.scrollTo(0, 0)")


async def fetch_used_listings(
    page: Page, apparel_id: str, condition_db: str
) -> list[dict]:
    """Return [{listing_id, price_hkd, condition}] for one used listing
    page. Sorted by listing_id for stable ordering.
    """
    condition_id = CONDITION_IDS[condition_db]
    url = (
        f"{SNKRDUNK_BASE}/apparels/{apparel_id}/used"
        f"?conditionIds={condition_id}"
    )
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
    except PWTimeout:
        print(f"  [!] timeout loading {url}", file=sys.stderr)
        return []

    # Wait for the listing container. The DOM evolves often; we fall back
    # to a generous timeout if the selector isn't found.
    LISTING_SELECTOR = "a[href*='/used/']"
    try:
        await page.wait_for_selector(LISTING_SELECTOR, timeout=8000)
    except PWTimeout:
        # Empty page (no listings) — that's fine.
        return []

    # Virtualized list: scroll until the count stops growing.
    await scroll_until_stable(page, LISTING_SELECTOR)

    # Collect every listing anchor and its price.
    anchors = page.locator(LISTING_SELECTOR)
    n = await anchors.count()
    seen: dict[str, dict] = {}
    for i in range(n):
        href = await anchors.nth(i).get_attribute("href")
        if not href:
            continue
        m = LISTING_PATH_RE.search(href)
        if not m:
            continue
        listing_id = m.group(1)
        if listing_id in seen:
            continue
        # The price text lives on the anchor or a child element.
        text = await anchors.nth(i).inner_text()
        price_match = PRICE_HKD_RE.search(text)
        if not price_match:
            continue
        price_hkd = int(price_match.group(1).replace(",", ""))
        seen[listing_id] = {
            "listing_id": listing_id,
            "price_hkd": price_hkd,
            "condition": condition_db,
        }
    return list(seen.values())


# ─── Main ────────────────────────────────────────────────────────────────


async def run(
    dry_run: bool,
    only_this: str,
    only_condition: Optional[str],
    headless: bool,
) -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    # 1. Snapshot of every mapped card.
    rows = fetch_mapped_rows(only_this=only_this)
    print(
        f"[plan] {len(rows)} mapped card(s)"
        + (f" (only={only_this})" if only_this else "")
    )

    # Optional: respect the SCRAPE_LIMIT env var for back-pressure.
    cap = int(os.environ.get("SCRAPE_LIMIT", "0") or "0")
    if cap > 0:
        rows = rows[:cap]
        print(f"[plan] SCRAPE_LIMIT cap applied → {len(rows)} card(s)")

    today = datetime.datetime.now(datetime.timezone.utc).date()
    conditions = list(CONDITION_IDS.keys())
    if only_condition:
        only_condition_up = only_condition.upper()
        if only_condition_up not in CONDITION_IDS:
            sys.exit(
                f"unknown --only-condition {only_condition!r}; "
                f"valid: {list(CONDITION_IDS.keys())}"
            )
        conditions = [only_condition_up]

    print(f"[plan] conditions: {conditions}")
    print(f"[plan] observed_date: {today.isoformat()}")

    # 2. Open the browser once; reuse across all cards.
    browser, page = await open_browser(headless=headless)
    try:
        for row in rows:
            card_id = row["id"]
            apparel_id = (row.get("snkrdunk_apparel_id") or "").strip()
            if not apparel_id:
                continue

            print(f"\n[{card_id}] apparel_id={apparel_id}")

            # 2a. Pre-fetch today's existing observations so we can
            #     skip duplicate listings without re-querying per condition.
            existing = fetch_existing_observations(card_id, today)
            already = len(existing)
            if already:
                print(f"  existing observations today: {already}")

            for condition in conditions:
                listings = await fetch_used_listings(page, apparel_id, condition)
                print(f"  {condition}: {len(listings)} listing(s)")

                new_rows = 0
                for listing in listings:
                    key = (listing["condition"], listing["listing_id"])
                    if key in existing:
                        # Already recorded for today — skip.
                        continue
                    row_to_insert = {
                        "card_id": card_id,
                        "source": "en",
                        "condition": CONDITION_TO_DB[condition],
                        "observed_date": today.isoformat(),
                        "price": None,
                        "price_hkd": listing["price_hkd"],
                        "status": "listed",
                        "listing_id": listing["listing_id"],
                        "apparel_id": apparel_id,
                    }
                    if dry_run:
                        print(f"    [dry-run] {row_to_insert}")
                        new_rows += 1
                        continue
                    if insert_observation(row_to_insert):
                        existing.add(key)
                        new_rows += 1
                print(f"  {condition}: {new_rows} new row(s)")
                # Polite throttle between conditions.
                await page.wait_for_timeout(400)
    finally:
        await browser.close()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--dry-run", action="store_true", help="print would-be rows")
    p.add_argument("--only-this", default="", help="restrict to one master_table.id")
    p.add_argument(
        "--only-condition",
        default=None,
        choices=list(CONDITION_IDS.keys()),
        help="only scrape this condition for each card",
    )
    p.add_argument(
        "--headless",
        type=int,
        default=int(os.environ.get("HEADLESS", "1")),
        help="1 = headless Chromium (default), 0 = show the browser for debugging",
    )
    args = p.parse_args()
    asyncio.run(
        run(
            dry_run=args.dry_run,
            only_this=args.only_this,
            only_condition=args.only_condition,
            headless=bool(args.headless),
        )
    )


if __name__ == "__main__":
    main()
