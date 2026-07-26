#!/usr/bin/env python3
"""Daily SNKRDUNK used-listing price scrape for every mapped card.

For each row in `master_table` that has a `snkrdunk_apparel_id`, fetch
the SNKRDUNK used listings page for two conditions:

  - A     (used, raw):       .../apparels/<id>/used?conditionIds=18
  - PSA10 (used, graded):    .../apparels/<id>/used?conditionIds=22

…and write one row per *active* listing into `price_history` with:

  condition     = 'RAW_A'  | 'PSA10'
  status        = 'listed'  | 'sold'
  price_jpy     = <integer from the page>
  price_hkd     = round(price_jpy * fx_rate_jpy_hkd)
  fx_rate_jpy_hkd = <rate from frankfurter.app at scrape time>
  fx_rate_date  = <date the rate applies to>
  apparel_id    = <snkrdunk apparel id>
  listing_id    = <snkrdunk listing id>
  observed_date = today (UTC)
  card_id       = master_table.id
  time_text     = first N時間前 / N日前 / YYYY/MM/DD marker on the
                  listing detail page (NULL if not exposed)

Dedup
-----
We de-duplicate by (card_id, condition, observed_date, listing_id)
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

FX rate
-------
At scrape time we fetch today's JPY→HKD rate from frankfurter.dev
(`https://api.frankfurter.dev/v1/latest?from=JPY&to=HKD`, the active
endpoint behind frankfurter.app), stamp the rate and its date on
each row, and derive price_hkd from price_jpy. The historical rate at
observation time is what makes longitudinal comparisons consistent.

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

# ─── FX rate (JPY → HKD) ───────────────────────────────────────────────
FX_API_URL = "https://api.frankfurter.dev/v1/latest?from=JPY&to=HKD"
# In-memory cache so every card in a single run only hits the API once.
_FX_CACHE: dict[str, tuple[float, datetime.date]] = {}


def fetch_fx_rate_jpy_hkd() -> tuple[float, datetime.date]:
    """Return (rate, date) for the JPY→HKD conversion.

    Uses frankfurter.app — no API key, ECB reference rate, ~50ms
    response. We cache the result for the lifetime of the process.
    Raises RuntimeError if the rate can't be fetched.
    """
    today = datetime.datetime.now(datetime.timezone.utc).date()
    if "today" in _FX_CACHE:
        return _FX_CACHE["today"]
    try:
        r = httpx.get(FX_API_URL, timeout=10, follow_redirects=True)
        r.raise_for_status()
        body = r.json()
        rate = float(body["rates"]["HKD"])
        date = datetime.date.fromisoformat(body["date"])
    except Exception as e:
        raise RuntimeError(f"failed to fetch JPY→HKD rate: {e}") from e
    _FX_CACHE["today"] = (rate, date)
    return rate, date


def jpy_to_hkd(price_jpy: int, rate: float) -> int:
    """Convert a JPY price to HKD using the supplied rate, rounded."""
    return round(price_jpy * rate)


# ─── SNKRDUNK URLs ───────────────────────────────────────────────────────
# The JP-locale SNKRDUNK site is the canonical source — pricing is in JPY.
# English-locale URLs (/en/...) use HKD and would corrupt the JPY column.
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
    return {_row_key(r) for r in _fetch_existing_rows(card_id, observed_date)}


def _fetch_existing_rows(card_id: str, observed_date: datetime.date) -> list[dict]:
    """Return the raw rows recorded for this card on the given
    observed_date. Used by the main loop to look up row ids and
    statuses when patching from listed → sold.
    """
    params = {
        "select": "id,condition,listing_id,status",
        "card_id": f"eq.{card_id}",
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
    return r.json() or []


def _row_key(row: dict) -> tuple[str, str]:
    return (row["condition"], row["listing_id"] or "")



def fetch_listings_snapshot(
    card_id: str, observed_date: datetime.date
) -> dict[tuple[str, str], dict]:
    """Return {(condition, listing_id): {price_jpy, ...}} for every
    listing snapshot recorded for this card on the given observed_date.
    """
    params = {
        "select": "condition,listing_id,price_jpy,status",
        "card_id": f"eq.{card_id}",
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
    return {
        (row["condition"], row["listing_id"] or ""): row
        for row in rows
        if row.get("listing_id")
    }


def fetch_latest_listed(
    card_id: str, listing_id: str, condition: str
) -> Optional[dict]:
    """Return the most recent 'listed' snapshot for a (card_id,
    listing_id, condition) triple, or None if none exists.

    We use this to find the row we should transition to 'sold' when
    a listing disappears from the live page.
    """
    params = {
        "select": "id,price_jpy,observed_date",
        "card_id": f"eq.{card_id}",
        "listing_id": f"eq.{listing_id}",
        "condition": f"eq.{condition}",
        "status": "eq.listed",
        "order": "observed_date.desc",
        "limit": 1,
    }
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/price_history",
        params=params,
        headers=H_JSON,
        timeout=30,
    )
    r.raise_for_status()
    rows = r.json() or []
    return rows[0] if rows else None


def mark_listing_sold(row_id: str, dry_run: bool) -> bool:
    """Patch a price_history row from status='listed' to status='sold'.
    Used when a listing was visible yesterday but is gone today.
    """
    if dry_run:
        return True
    r = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/price_history",
        params={"id": f"eq.{row_id}"},
        json={"status": "sold"},
        headers=H_JSON,
        timeout=30,
    )
    if r.status_code >= 400:
        print(
            f"  [!] mark-sold failed for row {row_id}: "
            f"HTTP {r.status_code} {r.text[:200]}",
            file=sys.stderr,
        )
        return False
    return True
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
#   <a class="..." href="/apparels/<apparel_id>/used/<listing_id>">
#     <div class="...price...">¥NNN,NNN ...</div>
#   </a>
# JP-locale prices render as a bare number with `¥` glyph nearby; the
# listing id is captured separately so the dedup key is stable across days.
LISTING_PATH_RE = re.compile(r"/apparels/\d+/used/([A-Z0-9]{6,30})")
# Matches the price + condition pair. We accept either ¥NNN,NNN or
# NNN,NNN¥, and tolerate whitespace between the digits and the
# condition marker (A / PSA10).
PRICE_JPY_RE = re.compile(
    r"(?:¥\s*)?([\d,]+)\s*¥?\s*(?:\n\s*/\s*\n\s*|\s*[/\s]\s*)(?:A|PSA\s*10)",
    re.IGNORECASE,
)
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


# Time markers we recognise on the listing detail page. Examples
# seen in production: "10時間前", "1日前", "2026/07/24".
LISTING_TIME_RE = re.compile(
    r"(\d{1,3}時間前|\d{1,3}日前|\d{4}/\d{2}/\d{2})"
)


async def fetch_listing_detail(
    page: Page, apparel_id: str, listing_id: str
) -> dict:
    """Fetch the listing's detail page and return a dict with two
    keys: `sold` (boolean) and `time_text` (str | None).

    The detail page exposes:
      - "取引完了" (transaction completed) → sold=True
      - The first N時間前 / N日前 / YYYY/MM/DD marker → time_text
    """
    url = f"{SNKRDUNK_BASE}/apparels/{apparel_id}/used/{listing_id}"
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=20_000)
    except PWTimeout:
        return {"sold": False, "time_text": None}
    try:
        await page.wait_for_load_state("networkidle", timeout=4000)
    except PWTimeout:
        pass
    body = await page.locator("body").inner_text()
    sold = "取引完了" in body
    m = LISTING_TIME_RE.search(body)
    return {"sold": sold, "time_text": m.group(1) if m else None}


async def fetch_used_listings(
    page: Page, apparel_id: str, condition_db: str
) -> list[dict]:
    """Return [{listing_id, price_jpy, condition, sold, time_text}]
    for one used listing page. `sold` and `time_text` are placeholders
    that the main loop fills in by visiting each listing's detail page.
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
        price_match = PRICE_JPY_RE.search(text)
        if not price_match:
            continue
        price_jpy = int(price_match.group(1).replace(",", ""))
        seen[listing_id] = {
            "listing_id": listing_id,
            "price_jpy": price_jpy,
            "condition": condition_db,
            "sold": False,  # filled in by the main loop via the detail page
            "time_text": None,  # same
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

    # Fetch today's JPY→HKD rate once per run; every row stamps it.
    try:
        fx_rate, fx_date = fetch_fx_rate_jpy_hkd()
    except RuntimeError as e:
        print(f"[fatal] {e}", file=sys.stderr)
        sys.exit(2)
    print(f"[plan] fx_rate JPY→HKD = {fx_rate} (date={fx_date})")

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
            existing_rows = _fetch_existing_rows(card_id, today)
            # Map: (condition, listing_id) -> (row_id, status)
            existing: dict[tuple[str, str], tuple[str, str]] = {
                _row_key(r): (r["id"], r["status"]) for r in existing_rows
            }
            already = len(existing)
            if already:
                print(f"  existing observations today: {already}")

            # 2b. Pre-fetch yesterday's listings so we can detect
            #     which ones have been sold (vanished from the page).
            yesterday = today - datetime.timedelta(days=1)
            yesterday_listings = fetch_listings_snapshot(card_id, yesterday)
            if yesterday_listings:
                print(f"  yesterday listed set: {len(yesterday_listings)}")

            for condition in conditions:
                listings = await fetch_used_listings(page, apparel_id, condition)
                live_ids = {l["listing_id"] for l in listings}
                print(f"  {condition}: {len(listings)} listing(s) live")

                # 2b-i. Detect sold listings: any listing that was
                # present yesterday but not today is considered sold.
                # We update the most recent 'listed' row for that
                # listing_id to status='sold' so we keep just one
                # canonical sold record per (listing_id, condition).
                sold_count = 0
                for key, snap_row in yesterday_listings.items():
                    if key[0] != condition:
                        continue
                    if key[1] in live_ids:
                        continue  # still listed today
                    # Vanished → mark the most recent 'listed' row sold
                    latest = fetch_latest_listed(card_id, key[1], condition)
                    if latest is None:
                        # No 'listed' row to transition (e.g. the row
                        # was already marked sold in a previous run).
                        continue
                    if dry_run:
                        print(
                            f"    [dry-run] mark sold (vanished): listing_id={key[1]} "
                            f"¥{snap_row.get('price_jpy')}"
                        )
                        sold_count += 1
                        continue
                    if mark_listing_sold(latest["id"], dry_run):
                        sold_count += 1
                if sold_count:
                    print(f"  {condition}: {sold_count} sold (vanished)")

                # 2b-ii. Insert today's new listings. Each listing is
                # checked against its detail page (取引完了 marker) to
                # determine sold vs on-sale status. We also patch any
                # existing today's row that was previously recorded as
                # 'listed' but is now actually sold.
                new_rows = 0
                sold_at_check = 0
                for listing in listings:
                    key = (listing["condition"], listing["listing_id"])
                    detail = await fetch_listing_detail(
                        page, apparel_id, listing["listing_id"]
                    )
                    sold = detail["sold"]
                    listing["sold"] = sold
                    listing["time_text"] = detail["time_text"]
                    if key in existing:
                        # Already recorded for today. If the previous
                        # record was 'listed' but the listing is now
                        # sold, flip it without inserting a duplicate.
                        _, prev_status = existing[key]
                        if prev_status == "listed" and sold:
                            if dry_run:
                                print(
                                    f"    [dry-run] mark sold: listing_id={listing['listing_id']}"
                                )
                            elif mark_listing_sold(existing[key][0], dry_run):
                                existing[key] = (existing[key][0], "sold")
                                sold_at_check += 1
                        continue
                    row_to_insert = {
                        "card_id": card_id,
                        "condition": CONDITION_TO_DB[condition],
                        "observed_date": today.isoformat(),
                        "price_jpy": listing["price_jpy"],
                        "price_hkd": jpy_to_hkd(listing["price_jpy"], fx_rate),
                        "fx_rate_jpy_hkd": fx_rate,
                        "fx_rate_date": fx_date.isoformat(),
                        "status": "sold" if sold else "listed",
                        "listing_id": listing["listing_id"],
                        "apparel_id": apparel_id,
                        "time_text": detail["time_text"],
                    }
                    if dry_run:
                        print(f"    [dry-run] {row_to_insert}")
                        new_rows += 1
                        continue
                    if insert_observation(row_to_insert):
                        existing[key] = ("?", "sold" if sold else "listed")
                        new_rows += 1
                if sold_at_check:
                    print(f"  {condition}: {sold_at_check} previously-listed now sold")
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
