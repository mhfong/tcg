#!/usr/bin/env python3
"""Real SNKRDUNK discovery via Playwright.

The previous discover_snkrdunk_ids.py used a guided-mode URL approach: it
just printed a search URL and the user clicked it. This script automates
the actual click-and-extract for each card using a headless Chromium.

For each master_table row with snkrdunk_apparel_id IS NULL, we:
  1. Build a JP search keyword (card_name + card_index)
  2. Open snkrdunk.com, type the keyword into the homepage search box
  3. Press Enter, wait for results
  4. For each candidate product link, follow it
  5. Read the apparel_id from the URL
  6. Score the candidate by card_index + rarity + parallel keyword
  7. PATCH master_table.snkr_dunk_apparel_id with the best match

Usage:
  python scripts/discover_snkrdunk_real.py --apply --limit 20
  python scripts/discover_snkrdunk_real.py --only-this opcgop11op07085sp10150 --apply
  python scripts/discover_snkrdunk_real.py --dry-run                # don't PATCH
  python scripts/discover_snkrdunk_real.py --csv /tmp/test.csv      # custom CSV out

Environment:
  SUPABASE_URL               (required)
  SUPABASE_SERVICE_ROLE_KEY  (required, for SELECT + PATCH)
"""
import argparse
import csv
import datetime
import os
import re
import sys
import time
from pathlib import Path
from typing import Optional

import asyncio
import httpx
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout

# ─── Supabase config ────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DEFAULT_CSV = Path("data/master_snkrdunk.csv")
PRICE_HISTORY_COLUMNS_APPAREL = "snkrdunk_apparel_id"

H_JSON = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

SNKRDUNK_BASE = "https://snkrdunk.com"

# ─── master_table fetch ─────────────────────────────────────────────────────

def fetch_unmapped() -> list[dict]:
    """Return all master_table rows with snkrdunk_apparel_id IS NULL."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    r = httpx.get(
        f"{SUPABASE_URL}/rest/v1/master_table",
        params={
            "select": "id,card_name,card_index,card_rarity,tcg_type,snkrdunk_apparel_id",
            "snkrdunk_apparel_id": "is.null",
            "limit": 1000,
            "order": "id",
        },
        headers=H_JSON,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


def patch_master(master_id: str, apparel_id: str) -> None:
    r = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/master_table",
        params={"id": f"eq.{master_id}"},
        json={"snkrdunk_apparel_id": apparel_id},
        headers=H_JSON,
        timeout=30,
    )
    r.raise_for_status()


# ─── CSV bookkeeping ────────────────────────────────────────────────────────

def load_csv() -> dict[str, dict]:
    if not DEFAULT_CSV.exists():
        return {}
    with DEFAULT_CSV.open() as f:
        return {row["master_id"]: row for row in csv.DictReader(f)}


def save_csv(existing: dict[str, dict]) -> None:
    DEFAULT_CSV.parent.mkdir(parents=True, exist_ok=True)
    cols = ["master_id", "tcg_type", "card_series", "card_index", "card_rarity",
            "yuyutei_slug", "card_name_hint", "snkrdunk_apparel_id",
            "snkrdunk_search_url", "verified_at"]
    with DEFAULT_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in existing.values():
            w.writerow({k: r.get(k, "") for k in cols})


# ─── Keyword building ──────────────────────────────────────────────────────

def strip_index_suffix(name: str) -> str:
    """Drop [OPxx-xxx] etc. from a card name."""
    return re.sub(r"\s*\[[A-Z]{2,4}[-‐−]?\d+\]\s*", " ", name or "").strip()


def build_keyword(card: dict) -> str:
    """Build a search keyword.

    SNKRDUNK's autocomplete recognises short JP card_index strings
    (e.g. "OP07-085") but often does NOT recognise full character
    names (especially obscure characters like ステューシー) or names
    that contain "(パラレル)" because the parens confuse the parser.

    Strategy:
      1. Use card_index alone first (always works for cards SNKRDUNK
         has indexed)
      2. If that returns 0 results, fall back to the JP name without
         the (パラレル) suffix
      3. Finally, try the raw name as a last resort
    """
    idx = (card.get("card_index") or "").upper()
    return idx or strip_index_suffix(card.get("card_name") or "")


def build_keyword_fallbacks(card: dict) -> list[str]:
    """Alternative keywords to try in order if the primary returns 0."""
    idx = (card.get("card_index") or "").upper()
    name = strip_index_suffix(card.get("card_name") or "")
    out = []
    if idx and name:
        out.append(f"{name} {idx}")
    if name:
        out.append(name)
    return out


# ─── Playwright helpers ─────────────────────────────────────────────────────

async def search_snkrdunk(page, keyword: str) -> list[dict]:
    """Type `keyword` into the SNKRDUNK homepage search box, return candidates.

    Returns: [{apparel_id, name, href}, ...] (deduped by apparel_id)
    """
    await page.goto(f"{SNKRDUNK_BASE}/", wait_until="domcontentloaded", timeout=30000)
    # Block Buyee modal that intercepts pointer events
    await page.evaluate("""
() => {
    document.querySelectorAll('iframe[src*="buyee"]').forEach(f => f.remove());
    document.querySelectorAll('#buyee-bcSection, #buyee-bcFrame').forEach(f => f.remove());
}
    """)
    await page.wait_for_timeout(800)
    inp = page.locator('input[name="keywords"]').first
    await inp.fill(keyword, force=True)
    await inp.press("Enter")
    await page.wait_for_timeout(4000)
    cards = await page.evaluate("""
() => {
    const out = [];
    document.querySelectorAll('a[href*="/apparels/"]').forEach(a => {
        const href = a.getAttribute('href');
        const m = href.match(/\\/apparels\\/(\\d+)/);
        if (!m) return;
        const id = m[1];
        let name = '';
        const card = a.closest('article, li, [class*="item" i], [class*="card" i]') || a;
        const txts = card.querySelectorAll('p, h2, h3, h4, span');
        for (const t of txts) {
            const s = t.textContent.trim();
            if (s.length > 5 && s.length < 200) { name = s; break; }
        }
        out.push({apparel_id: id, name, href});
    });
    const seen = new Set();
    return out.filter(o => { if (seen.has(o.apparel_id)) return false; seen.add(o.apparel_id); return true; });
}
    """)
    return cards


async def get_apparel_meta(page, apparel_id: str) -> dict:
    """Visit a product page and pull title + body text for scoring."""
    await page.goto(f"{SNKRDUNK_BASE}/apparels/{apparel_id}", wait_until="domcontentloaded", timeout=30000)
    await page.wait_for_timeout(1500)
    return await page.evaluate("""
() => {
    const title = document.querySelector('h1, [class*="name" i]')?.textContent?.trim() || '';
    const og = document.querySelector('meta[property="og:title"]')?.content || '';
    const body = document.body.innerText.slice(0, 2000);
    return {title, og, body};
}
    """)


# ─── Scoring ────────────────────────────────────────────────────────────────

# Map our card_rarity → required string fragments in the SNKRDUNK title.
# These are SNKRDUNK's actual product name suffixes for the OP/PTCG
# parallel variants.
RARITY_KEYWORDS = {
    "SP":    ["SEC-P", "SR-P", "R-P", "AR-P", "(パラレル)", "(Parallel)"],
    "P-SEC": ["SEC-P"],
    "SR":    ["SR"],
    "SR-P":  ["SR-P"],
    "SAR":   ["SAR"],
    "AR":    ["AR"],
    "RR":    ["RR"],
    "R":     [" R ", "R-"],
    "MUR":   ["MUR", "UR"],
    "UR":    ["UR"],
}

# Map tcg_type → required keyword in title
TCG_KEYWORDS = {
    "PTCG": ["ポケモン", "Pokemon"],
    "OPCG": [],   # too noisy
}


def score_candidate(card: dict, meta: dict) -> int:
    """Higher = better match. 0 = not a match."""
    title = (meta.get("title") or "") + " " + (meta.get("og") or "") + " " + (meta.get("body") or "")
    score = 0
    idx = (card.get("card_index") or "").upper()
    if idx and idx in title.upper():
        score += 50
    rarity = card.get("card_rarity") or ""
    for kw in RARITY_KEYWORDS.get(rarity, []):
        if kw in title:
            score += 30
            break
    tcg = card.get("tcg_type") or ""
    for kw in TCG_KEYWORDS.get(tcg, []):
        if kw in title:
            score += 20
            break
    name = strip_index_suffix(card.get("card_name") or "")
    if name and (name[:6] in title or name in title):
        score += 10
    # Prefer JP over EN. SNKRDUNK titles mark EN with "英語版" or
    # end with "[EN]". Heavily penalise EN so the JP variant always wins
    # on a tie.
    is_en = "英語版" in title or "[EN]" in title or "[English]" in title
    if is_en:
        score -= 5
    # Strongly prefer non-reprint / non-commemorative products over
    # THE BEST / コミパラ / SPC reprints.
    if "コミパラ" in title or "Comic Parallel" in title:
        score -= 10
    if "THE BEST" in title or "THE BEST" in title.upper():
        score -= 5
    return score


# ─── Per-card flow ──────────────────────────────────────────────────────────

async def discover_one(page, card: dict) -> Optional[dict]:
    """Run the full search → score → best-match flow for one card.

    Returns: {"apparel_id", "name", "score", "url"} or None.
    """
    primary = build_keyword(card)
    fallbacks = build_keyword_fallbacks(card)
    keywords = [primary] + [k for k in fallbacks if k and k != primary]
    print(f"  keywords: {keywords}", file=sys.stderr)
    candidates: list[dict] = []
    used_keyword = ""
    for kw in keywords:
        print(f"  q: {kw!r}", file=sys.stderr)
        try:
            cs = await search_snkrdunk(page, kw)
        except PlaywrightTimeout as e:
            print(f"  search timed out: {e}", file=sys.stderr)
            continue
        except Exception as e:
            print(f"  search error: {e}", file=sys.stderr)
            continue
        if cs:
            candidates = cs
            used_keyword = kw
            break
    if not candidates:
        print(f"  no candidates from any keyword", file=sys.stderr)
        return None
    print(f"  {len(candidates)} candidates (from {used_keyword!r})", file=sys.stderr)
    # Score each by visiting its product page
    best = None
    for c in candidates[:15]:  # cap to 15 to stay within timeout budget
        try:
            meta = await get_apparel_meta(page, c["apparel_id"])
        except Exception as e:
            print(f"    {c['apparel_id']}: meta error {e}", file=sys.stderr)
            continue
        s = score_candidate(card, meta)
        title = meta.get("title") or meta.get("og") or ""
        print(f"    {c['apparel_id']}: score={s:3d}  {title[:80]}", file=sys.stderr)
        if s == 0:
            continue
        if best is None or s > best["score"]:
            best = {"apparel_id": c["apparel_id"], "name": title,
                    "score": s, "url": f"{SNKRDUNK_BASE}/apparels/{c['apparel_id']}"}
    return best


# ─── Main ───────────────────────────────────────────────────────────────────

async def run(args) -> int:
    if args.only_this:
        # Pull the one card
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/master_table",
            params={"select": "id,card_name,card_index,card_rarity,tcg_type,snkrdunk_apparel_id",
                    "id": f"eq.{args.only_this}", "limit": 1},
            headers=H_JSON, timeout=30,
        )
        r.raise_for_status()
        cards = r.json()
    else:
        cards = fetch_unmapped()
    if args.limit:
        cards = cards[: args.limit]
    if not cards:
        print("[discover-real] no cards to process", file=sys.stderr)
        return 0
    print(f"[discover-real] {len(cards)} card(s) to discover", file=sys.stderr)
    csv_data = load_csv()
    found = 0
    not_found = 0
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ja-JP",
            viewport={"width": 1280, "height": 900},
        )
        # Block heavy assets for speed
        await ctx.route("**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf}",
                        lambda r: r.abort())
        await ctx.route("**/connect.buyee.jp/**", lambda r: r.abort())
        page = await ctx.new_page()
        for i, card in enumerate(cards, 1):
            print(f"\n[{i}/{len(cards)}] {card['id']} ({card.get('tcg_type','')})",
                  file=sys.stderr)
            try:
                best = await discover_one(page, card)
            except Exception as e:
                print(f"  ERR: {e}", file=sys.stderr)
                best = None
            if not best:
                not_found += 1
                continue
            print(f"  → PICK {best['apparel_id']} (score {best['score']}): {best['name'][:80]}",
                  file=sys.stderr)
            if not args.dry_run and args.apply:
                try:
                    patch_master(card["id"], best["apparel_id"])
                    print(f"  ✓ PATCHed master_table", file=sys.stderr)
                except Exception as e:
                    print(f"  ! PATCH failed: {e}", file=sys.stderr)
                    not_found += 1
                    continue
            # Update CSV
            now = datetime.date.today().isoformat()
            row = csv_data.get(card["id"], {
                "master_id": card["id"],
                "tcg_type": card.get("tcg_type", ""),
                "card_series": "",
                "card_index": card.get("card_index", ""),
                "card_rarity": card.get("card_rarity", ""),
                "yuyutei_slug": "",
                "card_name_hint": strip_index_suffix(card.get("card_name", "")),
                "snkrdunk_apparel_id": "",
                "snkrdunk_search_url": "",
                "verified_at": "",
            })
            row["snkrdunk_apparel_id"] = best["apparel_id"]
            row["snkrdunk_search_url"] = best["url"]
            row["verified_at"] = now
            row["card_name_hint"] = strip_index_suffix(card.get("card_name", "")) or row.get("card_name_hint", "")
            csv_data[card["id"]] = row
            save_csv(csv_data)
            found += 1
            # Be polite
            await asyncio.sleep(1.0)
        await browser.close()
    print(f"\n[discover-real] done. found={found} not_found={not_found}",
          file=sys.stderr)
    return 0 if not_found == 0 else 0  # always exit 0; not-found is not a failure


def cli() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=__import__("argparse").RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="Only process the first N cards")
    ap.add_argument("--only-this", default="", help="Only process this one master_id")
    ap.add_argument("--apply", action="store_true",
                    help="PATCH master_table.snkr_dunk_apparel_id for each match")
    ap.add_argument("--dry-run", action="store_true",
                    help="Don't PATCH, just print what would happen")
    args = ap.parse_args()
    if not args.dry_run and not args.apply and not args.only_this:
        # Default: apply
        args.apply = True
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(cli())
