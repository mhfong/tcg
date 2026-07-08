"""
Daily SNKRDUNK price scraper.

Walks the whole master_table, discovers and caches a SNKRDUNK apparel_id for
each card, runs the per-apparel scraper, and upserts the results into the
`price_history` table in Supabase.

Per-apparel scraping is done by `scripts/scrape_snkrdunk.py` (subprocess) so the
two scripts can be developed and tested independently.

Discovery strategy (Phase 1)
----------------------------
SNKRDUNK's apparel_id is opaque. The cheapest way to find it for a card is to
try the yuyu-tei URL's last path segment (5-digit) as the apparel_id and
HEAD-validate. About 30-50% of cards hit; misses get cached as NULL so we
don't keep retrying. Phase 2 (later) can fall back to a SNKRDUNK search.

What gets written
-----------------
The CSV emitted by `scrape_snkrdunk.py` is reshaped into the `price_history`
table format:

    card_id, source, condition, observed_date, price, price_hkd, status,
    listing_id, apparel_id, scraped_at

The legacy `price` column is always JPY (set to NULL for source='en' rows).
HKD is stored in `price_hkd` for source='en' rows. This keeps the existing
WatchlistPage / InventoryPage / DashboardPage reads (`p.price` as a number,
`change_7d` math) working unchanged.

Usage
-----
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
        python scripts/scrape_snkrdunk_all.py

Env vars
--------
SNKRDUNK_BATCH_SIZE   max NEW cards to discover per run (default 200)
SNKRDUNK_DRY_RUN=1    discover only, skip the actual scraping
SNKRDUNK_SKIP_DISCOVERY=1   skip discovery, only scrape already-cached cards
"""

from __future__ import annotations

import csv
import io
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import httpx

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BATCH_SIZE = int(os.environ.get("SNKRDUNK_BATCH_SIZE", "200"))
DRY_RUN = os.environ.get("SNKRDUNK_DRY_RUN") == "1"
SKIP_DISCOVERY = os.environ.get("SNKRDUNK_SKIP_DISCOVERY") == "1"

H_JSON = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}
H_CSV = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "text/csv",
    "Prefer": "resolution=merge-duplicates,return=minimal",
}

PRICE_HISTORY_COLUMNS = [
    "card_id", "source", "condition", "observed_date", "price", "price_hkd",
    "status", "listing_id", "apparel_id", "scraped_at",
]

# Fields emitted by scrape_snkrdunk.py (must match CSV_FIELDS in that file)
SOURCE_CSV_COLUMNS = [
    "source", "condition", "date", "price_jpy", "price_hkd", "listed_hkd",
    "status", "listing_id", "url",
]


# ─────────────────────────────────────────────────────────────────────────────
# Supabase REST helpers
# ─────────────────────────────────────────────────────────────────────────────

def supabase_get(path: str, **params) -> list[dict]:
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/{path}",
        params=params,
        headers=H_JSON,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def supabase_patch(path: str, body: dict, **filters) -> None:
    r = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/{path}",
        params=filters,
        json=body,
        headers=H_JSON,
        timeout=30,
    )
    r.raise_for_status()


def supabase_upsert_csv(table: str, csv_text: str) -> int:
    """POST a CSV body to the table with merge-duplicates upsert.

    The CSV must contain all columns of the table; missing ones will be NULL.
    Returns the number of input rows (Supabase return=minimal gives no count).
    """
    n = sum(1 for _ in csv_text.splitlines() if _) - 1
    r = httpx.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        content=csv_text.encode("utf-8"),
        headers=H_CSV,
        timeout=180,
    )
    r.raise_for_status()
    return max(n, 0)


# ─────────────────────────────────────────────────────────────────────────────
# master_table fetch + apparel_id discovery
# ─────────────────────────────────────────────────────────────────────────────

def fetch_master_table() -> list[dict]:
    """All master_table rows (paginated)."""
    out: list[dict] = []
    offset = 0
    while True:
        rows = supabase_get(
            "master_table",
            select="id,url_yuyutei,snkrdunk_apparel_id",
            order="id",
            limit=1000,
            offset=offset,
        )
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def yuyutei_slug_candidate(url_yuyutei: str | None) -> str | None:
    if not url_yuyutei:
        return None
    parts = [p for p in urlparse(url_yuyutei).path.split("/") if p]
    if not parts:
        return None
    last = parts[-1]
    return last if last.isdigit() and len(last) == 5 else None


def discover_apparel_id(slug: str) -> str | None:
    """HEAD-validate the JP sales-history URL. 200 = valid SNKRDUNK product."""
    try:
        r = httpx.head(
            f"https://snkrdunk.com/apparels/{slug}/sales-histories",
            headers={"User-Agent": "tcg-pro-scraper/1.0"},
            follow_redirects=True,
            timeout=15,
        )
    except httpx.HTTPError:
        return None
    return slug if r.status_code == 200 else None


def discover_for_cards(cards: list[dict]) -> int:
    """Try to discover apparel_id for cards that don't have one cached yet.

    Returns the number of NEW apparel_ids found and cached. Capped at BATCH_SIZE.
    """
    to_try = [c for c in cards if not c.get("snkrdunk_apparel_id")]
    to_try = to_try[:BATCH_SIZE]
    if not to_try:
        return 0
    found = 0
    for c in to_try:
        slug = yuyutei_slug_candidate(c.get("url_yuyutei"))
        if not slug:
            continue
        apparel_id = discover_apparel_id(slug)
        if not apparel_id:
            continue
        try:
            supabase_patch(
                "master_table",
                {"snkrdunk_apparel_id": apparel_id},
                id=f"eq.{c['id']}",
            )
        except httpx.HTTPError as e:
            print(f"  ! failed to cache {apparel_id} for {c['id']}: {e}",
                  file=sys.stderr)
            continue
        c["snkrdunk_apparel_id"] = apparel_id
        found += 1
        print(f"  + {c['id']} -> {apparel_id}", file=sys.stderr)
    return found


# ─────────────────────────────────────────────────────────────────────────────
# Per-apparel scraping + CSV reshape
# ─────────────────────────────────────────────────────────────────────────────

def run_per_apparel_scraper(apparel_id: str) -> Path:
    """Run scrape_snkrdunk.py for one apparel_id, return path to its CSV."""
    fd, name = tempfile.mkstemp(suffix=".csv", prefix=f"snkrdunk_{apparel_id}_")
    os.close(fd)
    out_path = Path(name)
    subprocess.run(
        [
            "python", "scripts/scrape_snkrdunk.py",
            "--apparel-id", apparel_id,
            "--output", str(out_path),
        ],
        check=True,
        cwd=str(Path(__file__).resolve().parent.parent),
    )
    return out_path


def reshape_to_price_history(
    source_csv: Path, card_id: str, apparel_id: str
) -> tuple[str, int]:
    """Read scrape_snkrdunk.py's CSV and emit price_history-shaped CSV.

    Returns (csv_text, row_count). Drops rows whose condition isn't PSA10/RAW_A
    (defensive — the scraper already filters, but the orchestrator shouldn't
    trust that).
    """
    scraped_at = ""  # let Supabase default fill this
    out = io.StringIO()
    writer = csv.DictWriter(
        out, fieldnames=PRICE_HISTORY_COLUMNS, lineterminator="\n"
    )
    writer.writeheader()
    n = 0
    with source_csv.open() as f:
        for row in csv.DictReader(f):
            cond = row["condition"]
            if cond not in ("PSA10", "RAW_A"):
                continue
            writer.writerow({
                "card_id": card_id,
                "source": row["source"],
                "condition": cond,
                "observed_date": row["date"],
                "price": row["price_jpy"] or "",      # JPY only
                "price_hkd": row["price_hkd"] or "",  # HKD for en rows
                "status": row["status"],
                "listing_id": row["listing_id"] or "",
                "apparel_id": apparel_id,
                "scraped_at": scraped_at,
            })
            n += 1
    return out.getvalue(), n


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    print("[snkrdunk] fetching master_table ...", file=sys.stderr)
    cards = fetch_master_table()
    print(f"[snkrdunk] {len(cards)} cards in master_table", file=sys.stderr)

    if not SKIP_DISCOVERY:
        print(f"[snkrdunk] discovering (batch_size={BATCH_SIZE}) ...",
              file=sys.stderr)
        n_new = discover_for_cards(cards)
        print(f"[snkrdunk] discovered {n_new} new apparel_ids", file=sys.stderr)
    else:
        print("[snkrdunk] skipping discovery (SNKRDUNK_SKIP_DISCOVERY=1)",
              file=sys.stderr)

    if DRY_RUN:
        print("[snkrdunk] dry-run, skipping scrape", file=sys.stderr)
        return 0

    # Dedupe by apparel_id — multiple master_table rows can share one SNKRDUNK
    # product (e.g. JP + EN printing of the same card). We pick the first
    # card_id for the apparel_id; the price_history table can hold many rows
    # per (apparel_id, observed_date) from different card_id mappings later.
    by_apparel: dict[str, str] = {}
    for c in cards:
        aid = c.get("snkrdunk_apparel_id")
        if aid and aid not in by_apparel:
            by_apparel[aid] = c["id"]
    print(f"[snkrdunk] scraping {len(by_apparel)} unique apparel_ids ...",
          file=sys.stderr)

    total_rows = 0
    successes = 0
    failures = 0
    for i, (apparel_id, card_id) in enumerate(by_apparel.items(), 1):
        print(f"[{i}/{len(by_apparel)}] {apparel_id} ({card_id}) ...",
              file=sys.stderr)
        try:
            raw_csv = run_per_apparel_scraper(apparel_id)
        except subprocess.CalledProcessError as e:
            print(f"  ! scraper failed for {apparel_id}: {e}", file=sys.stderr)
            failures += 1
            continue
        try:
            csv_text, n_rows = reshape_to_price_history(
                raw_csv, card_id, apparel_id
            )
            if n_rows == 0:
                print(f"  - {apparel_id}: 0 rows after reshape", file=sys.stderr)
                continue
            supabase_upsert_csv("price_history", csv_text)
            total_rows += n_rows
            successes += 1
            print(f"  ok {apparel_id}: {n_rows} rows upserted", file=sys.stderr)
        except httpx.HTTPError as e:
            print(f"  ! upsert failed for {apparel_id}: {e}", file=sys.stderr)
            failures += 1
        finally:
            raw_csv.unlink(missing_ok=True)

    print(
        f"[snkrdunk] done. successes={successes} failures={failures} "
        f"rows_upserted={total_rows}",
        file=sys.stderr,
    )
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
