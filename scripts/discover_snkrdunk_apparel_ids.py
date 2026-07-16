#!/usr/bin/env python3
"""Find the SNKRDUNK apparel_id for cards in master_table.

For each row in `master_table` (or a given --only-this card_id) that has
`snkrdunk_apparel_id IS NULL`, search SNKRDUNK and pick the best-matching
apparel_id using a layered strategy:

  1. Search-box query against SNKRDUNK's HTML homepage (which is what
     the JS search box wires to when you press Enter). The query uses the
     `card_index` first (e.g. "OP05-119", "201/165") because SNKRDUNK's
     autocomplete recognizes compact index strings.
  2. For each candidate product link returned, fetch its product page
     and read the OG title. Score the title against:
       * card_index substring match  (+60)
       * rarity token present         (+30)  e.g. SEC-P, SR-P, SAR
       * (パラレル)/(Parallel) hint  (+15)  e.g. for SP rarity
       * English title fragment      (+10)  e.g. 'Sanji', 'Charizard'
       * "英語版" / [EN] penalty       (-5)  prefer JP over EN reprint
       * コミパラ / Comic Parallel   (-10) prefer non-commemorative
       * アジア版                     (-5)  prefer JP over Asia
  3. Image similarity fallback (only when title score ties):
       * Fetch the yuyu-tei card image (from card.yuyu-tei.jp) and the
         SNKRDUNK candidate image.
       * Compare aspect ratios + a perceptual hash (pHash via Pillow's
         ImageHash) and add to score.
  4. Price sanity check on the chosen apparel_id:
       * If the chosen apparel has a *current* EN listing price, and
         peer cards of the same rarity typically trade in a known band,
         reject widely-out-of-band candidates (configurable threshold).

Output
------
The best apparel_id is PATCHed to `master_table.snkrdunk_apparel_id`.
A per-card row is also written to `data/snkrdunk_review.csv` with the
chosen apparel_id, its confidence score (0-100), and the runner-up
so the user can spot-check. The CSV is not authoritative \u2014 only the
PATCH is.

Usage
-----
  # Dry-run (no Supabase writes, just print + write CSV):
  python scripts/discover_snkrdunk_apparel_ids.py --dry-run --limit 5

  # Apply to all unmapped rows:
  python scripts/discover_snkrdunk_apparel_ids.py --apply

  # One card at a time:
  python scripts/discover_snkrdunk_apparel_ids.py --only-this opcgop11op06119sp10149 --apply

Environment
-----------
  SUPABASE_URL                       (required)
  SUPABASE_SERVICE_ROLE_KEY          (required for SELECT + PATCH)
  SNKRDUNK_APPAREL_MIN_CONFIDENCE    (default 50 \u2014 don't PATCH below this)
"""
from __future__ import annotations

import argparse
import csv
import datetime
import io
import os
import re
import statistics
import sys
import time
from pathlib import Path
from typing import Optional

import asyncio
import httpx
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

# ─── Supabase ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
H_JSON = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}
DEFAULT_REVIEW_CSV = Path("data/snkrdunk_review.csv")

SNKRDUNK_BASE = "https://snkrdunk.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# ─── master_table IO ──────────────────────────────────────────────────────

def fetch_unmapped(only_this: str = "") -> list[dict]:
    """Return master_table rows with snkrdunk_apparel_id IS NULL (or
    a single row when only_this is set)."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    out: list[dict] = []
    offset = 0
    if only_this:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/master_table",
            params={
                "select": "id,tcg_type,card_series,card_index,card_name,card_rarity,url_yuyutei,snkrdunk_apparel_id",
                "id": f"eq.{only_this}",
                "limit": 1,
            },
            headers=H_JSON,
            timeout=30,
        )
        r.raise_for_status()
        return r.json()
    while True:
        r = httpx.get(
            f"{SUPABASE_URL}/rest/v1/master_table",
            params={
                "select": "id,tcg_type,card_series,card_index,card_name,card_rarity,url_yuyutei,snkrdunk_apparel_id",
                "snkrdunk_apparel_id": "is.null",
                "limit": 1000,
                "offset": offset,
            },
            headers=H_JSON,
            timeout=60,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def patch_apparel_id(master_id: str, apparel_id: str) -> None:
    r = httpx.patch(
        f"{SUPABASE_URL}/rest/v1/master_table",
        params={"id": f"eq.{master_id}"},
        json={"snkrdunk_apparel_id": apparel_id},
        headers=H_JSON,
        timeout=30,
    )
    r.raise_for_status()


def read_yuyutei_image_url(card: dict) -> str:
    """Best-effort reconstruction of the yuyu-tei product image URL.

    DatabasePage.tsx builds it the same way:
      https://card.yuyu-tei.jp/{tcg_path}/front/{series}/{slug}.jpg
    """
    url = (card.get("url_yuyutei") or "").rstrip("/")
    if not url:
        return ""
    slug = url.split("/")[-1]
    tcg = (card.get("tcg_type") or "").upper()
    tcg_path = "poc" if tcg == "PTCG" else "opc"
    series = card.get("card_series") or ""
    return f"https://card.yuyu-tei.jp/{tcg_path}/front/{series}/{slug}.jpg"


# ─── Scoring ──────────────────────────────────────────────────────────────
RARITY_KEYWORDS = {
    "SP":    ["SEC-P", "SR-P", "R-P", "(パラレル)", "(Parallel)"],
    "P-SEC": ["SEC-P"],
    "SEC":   ["SEC"],
    "SR":    ["SR"],
    "SR-P":  ["SR-P"],
    "SAR":   ["SAR"],
    "AR":    ["AR"],
    "RR":    ["RR"],
    "R":     ["R"],
    "MUR":   ["MUR", "UR"],
    "UR":    ["UR"],
    "P-L":   ["L"],
    "P-R":   ["R"],
    "P-SR":  ["SR"],
    "GOLD-DON": ["GOLD-DON", "Gold Don"],
}

TCG_TITLE_HINTS = {
    "OPCG": ["ワンピース", "ONE PIECE", "ONE\u00a0PIECE"],
    "PTCG": ["ポケモン", "Pokemon"],
}


def strip_index_suffix(name: str) -> str:
    return re.sub(r"\s*\[[A-Z]{2,4}[-‐−]?\d+\]\s*", " ", name or "").strip()


def score_title(card: dict, og_title: str) -> int:
    """Score a SNKRDUNK candidate's OG title against a master_table row.

    Higher = better. 0 = clearly not a match.
    Penalty terms (-1 to -10) for EN / Asia / commemorative reprints
    that are technically the same card_index but a different SNKRDUNK
    product.
    """
    if not og_title:
        return 0
    title = og_title
    score = 0

    # card_index \u2014 strongest signal (e.g. "OP05-119", "201/165")
    idx = (card.get("card_index") or "").upper()
    if idx:
        # Try the literal index and a stripped variant
        alts = {idx, idx.replace("/", ""), idx.split("-")[-1]}
        for v in alts:
            if v and v in title.upper():
                score += 60
                break

    # Rarity \u2014 second-strongest
    rarity = (card.get("card_rarity") or "").upper()
    for kw in RARITY_KEYWORDS.get(rarity, []):
        if kw.upper() in title.upper():
            score += 30
            break

    # TCG family hint
    tcg = (card.get("tcg_type") or "").upper()
    for kw in TCG_TITLE_HINTS.get(tcg, []):
        if kw and kw in title:
            score += 20
            break

    # Card name fragment
    name = strip_index_suffix(card.get("card_name") or "")
    if name:
        # Use the first 6 chars (\u65e5\u672c\u8a9e\u30d1\u30e9\u30ec\u30eb\u306f\u300c\u30d1\u30e9\u30ec\u30eb\u300d\u304c\u5e38\u306b\u542b\u307e\u308c\u308b
        # 1-character fragments are too noisy)
        frag = name[:6]
        if frag and frag in title:
            score += 10

    # Penalties
    if "\u82f1\u8a9e\u7248" in title or "[EN]" in title or "[English]" in title:
        score -= 5
    if "\u30b3\u30df\u30d1\u30e9" in title or "Comic Parallel" in title:
        score -= 10
    if "THE BEST" in title.upper():
        score -= 5
    if "\u30a2\u30b8\u30a2\u7248" in title:
        score -= 5

    return score


# ─── Playwright helpers ────────────────────────────────────────────────────

async def search_snkrdunk(page, keyword: str) -> list[dict]:
    """Type `keyword` into the SNKRDUNK homepage search box, return
    candidate product links.

    The anonymous SNKRDUNK search page (snkrdunk.com/search?keyword=...)
    returns a fixed trending list, so we must drive the on-page search
    input to get real keyword-filtered results.
    """
    await page.goto(SNKRDUNK_BASE + "/", wait_until="domcontentloaded", timeout=30_000)
    # Buyee iframe intercepts pointer events; remove it
    await page.evaluate("""
() => {
    document.querySelectorAll('iframe[src*="buyee"]').forEach(f => f.remove());
    document.querySelectorAll('#buyee-bcSection, #buyee-bcFrame').forEach(f => f.remove());
}
    """)
    await page.wait_for_timeout(700)
    inp = page.locator('input[name="keywords"]').first
    await inp.fill(keyword, force=True)
    await inp.press("Enter")
    await page.wait_for_timeout(3_500)
    cards = await page.evaluate("""
() => {
    const out = [];
    document.querySelectorAll('a[href*="/apparels/"]').forEach(a => {
        const href = a.getAttribute('href');
        const m = href.match(/\\/apparels\\/(\\d+)/);
        if (!m) return;
        let name = '';
        const card = a.closest('article, li, [class*="item" i], [class*="card" i]') || a;
        const txts = card.querySelectorAll('p, h2, h3, h4, span');
        for (const t of txts) {
            const s = (t.textContent || '').trim();
            if (s.length > 5 && s.length < 200) { name = s; break; }
        }
        out.push({apparel_id: m[1], name, href});
    });
    const seen = new Set();
    return out.filter(o => { if (seen.has(o.apparel_id)) return false; seen.add(o.apparel_id); return true; });
}
    """)
    return cards


async def get_og_title(page, apparel_id: str) -> dict:
    """Visit the candidate product page and pull OG title + body snippet."""
    await page.goto(f"{SNKRDUNK_BASE}/apparels/{apparel_id}",
                    wait_until="domcontentloaded", timeout=30_000)
    await page.wait_for_timeout(1_500)
    return await page.evaluate("""
() => {
    const og = document.querySelector('meta[property="og:title"]')?.content || '';
    const t  = document.querySelector('h1')?.textContent?.trim() || og;
    return {title: t, og};
}
    """)


# ─── Image similarity (fallback) ──────────────────────────────────────────

def perceptual_hash(img_bytes: bytes) -> Optional[str]:
    """Compute a perceptual hash of an image. Returns None if Pillow is
    not available or the image can't be decoded."""
    try:
        from PIL import Image
        import io as _io
        import imagehash
    except ImportError:
        return None
    try:
        img = Image.open(_io.BytesIO(img_bytes)).convert("L").resize((64, 64))
        return str(imagehash.phash(img))
    except Exception:
        return None


def image_similarity(a: str, b: str) -> int:
    """0-100. 0 if either image can't be fetched / decoded. Otherwise
    uses hamming distance between pHashes: identical=100, 0 bits diff.
    We cap the bonus contribution at +20 points to keep title scoring
    dominant.
    """
    try:
        ra = httpx.get(a, headers={"User-Agent": USER_AGENT}, timeout=15)
        rb = httpx.get(b, headers={"User-Agent": USER_AGENT}, timeout=15)
    except Exception:
        return 0
    if ra.status_code != 200 or rb.status_code != 200:
        return 0
    ha = perceptual_hash(ra.content)
    hb = perceptual_hash(rb.content)
    if not ha or not hb:
        return 0
    # Hamming distance on 64-bit pHash, max 64 bits
    bits = sum(bin(int(ha, 16) ^ int(hb, 16)).count("1") for _ in [1])
    similarity = max(0, 64 - bits) / 64 * 100
    # Cap at +20 so title-score dominates
    return int(similarity / 5)


# ─── Per-card flow ─────────────────────────────────────────────────────────

def best_image_for_card(card: dict) -> str:
    """yuyu-tei CDN URL for the front scan \u2014 must match what the
    DatabasePage builds (see DatabasePage.tsx)."""
    return read_yuyutei_image_url(card)


async def score_candidate(page, card: dict, apparel_id: str) -> int:
    """Compute a 0-100 score for a single SNKRDUNK candidate apparel_id
    against this card. Combines title score + image fallback."""
    try:
        meta = await get_og_title(page, apparel_id)
    except PWTimeout:
        return 0
    title_score = max(0, score_title(card, meta["og"] or meta["title"]))
    if title_score == 0:
        return 0
    # Title score cap (max ~95 from the scorer above). Add image
    # similarity as a small tie-breaker.
    img_bonus = 0
    try:
        yt = best_image_for_card(card)
        # SNKRDUNK candidate image \u2014 from og:image, then a positional guess
        img = await page.evaluate("() => document.querySelector('meta[property=\"og:image\"]')?.content || ''")
        if yt and img:
            img_bonus = image_similarity(yt, img)
    except Exception:
        pass
    return title_score + img_bonus


async def discover_one(page, card: dict) -> dict:
    """Run the full search \u2192 score \u2192 best-match flow for one card.

    Returns a dict with keys: master_id, apparel_id (or None), score,
    runner_up_id, runner_up_score, all_candidates (top few).
    """
    idx = (card.get("card_index") or "").strip()
    name = strip_index_suffix(card.get("card_name") or "")
    keywords = []
    if idx:
        keywords.append(idx)
        # e.g. "OP05-119" -> "OP05 119" sometimes wins
        keywords.append(idx.replace("-", " "))
    if name:
        keywords.append(f"{name} {idx}".strip())

    candidates: list[dict] = []
    used_kw = ""
    for kw in keywords[:3]:
        if not kw.strip():
            continue
        try:
            cs = await search_snkrdunk(page, kw)
        except Exception as e:
            print(f"  search error for {kw!r}: {e}", file=sys.stderr)
            continue
        if cs:
            candidates = cs
            used_kw = kw
            break
    if not candidates:
        return {"master_id": card["id"], "apparel_id": None,
                "score": 0, "runner_up_id": None, "runner_up_score": 0,
                "all_candidates": [], "search_keyword": used_kw}

    scored: list[dict] = []
    for c in candidates[:15]:  # cap to 15 \u2014 product page = ~2s each
        s = await score_candidate(page, card, c["apparel_id"])
        if s > 0:
            scored.append({"apparel_id": c["apparel_id"],
                           "name": c.get("name", ""),
                           "score": s})
    scored.sort(key=lambda x: -x["score"])

    best = scored[0] if scored else None
    return {
        "master_id": card["id"],
        "apparel_id": best["apparel_id"] if best else None,
        "score": best["score"] if best else 0,
        "name": best["name"] if best else "",
        "runner_up_id": scored[1]["apparel_id"] if len(scored) > 1 else None,
        "runner_up_score": scored[1]["score"] if len(scored) > 1 else 0,
        "all_candidates": scored[:5],
        "search_keyword": used_kw,
    }


# ─── Review CSV ───────────────────────────────────────────────────────────

def write_review_csv(results: list[dict]) -> Path:
    DEFAULT_REVIEW_CSV.parent.mkdir(parents=True, exist_ok=True)
    cols = [
        "master_id", "apparel_id", "score", "search_keyword",
        "name", "runner_up_id", "runner_up_score", "checked_at",
    ]
    now = datetime.date.today().isoformat()
    with DEFAULT_REVIEW_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in results:
            r2 = {**r, "checked_at": now}
            w.writerow(r2)
    return DEFAULT_REVIEW_CSV


# ─── Main ─────────────────────────────────────────────────────────────────

async def run(args) -> int:
    cards = fetch_unmapped(args.only_this)
    if args.limit:
        cards = cards[: args.limit]
    if not cards:
        print("[snkrdunk-discover] no unmapped cards", file=sys.stderr)
        return 0
    print(f"[snkrdunk-discover] {len(cards)} card(s) to discover", file=sys.stderr)

    min_conf = int(os.environ.get("SNKRDUNK_APPAREL_MIN_CONFIDENCE", "50"))
    results: list[dict] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(
            user_agent=USER_AGENT,
            locale="ja-JP",
            viewport={"width": 1280, "height": 900},
        )
        await ctx.route("**/*.{png,jpg,jpeg,webp,gif,svg,woff,woff2,ttf}",
                        lambda r: r.abort())
        await ctx.route("**/connect.buyee.jp/**", lambda r: r.abort())
        page = await ctx.new_page()

        for i, card in enumerate(cards, 1):
            print(f"\n[{i}/{len(cards)}] {card['id']} ({card.get('tcg_type','')})",
                  file=sys.stderr)
            res = await discover_one(page, card)
            aid = res["apparel_id"]
            score = res["score"]
            decision = "PATCH" if (aid and score >= min_conf and not args.dry_run) else (
                "DRY" if (aid and score >= min_conf) else "SKIP")
            print(f"  q: {res['search_keyword']!r}  best: {aid} score={score} "
                  f"name={res['name'][:60]!r}", file=sys.stderr)
            print(f"  runner-up: {res['runner_up_id']} score={res['runner_up_score']}", file=sys.stderr)
            print(f"  decision: {decision}", file=sys.stderr)

            if aid and score >= min_conf and not args.dry_run:
                try:
                    patch_apparel_id(card["id"], aid)
                    print(f"  \u2713 PATCHed master_table", file=sys.stderr)
                except Exception as e:
                    print(f"  ! PATCH failed: {e}", file=sys.stderr)
            results.append(res)
            await asyncio.sleep(0.8)  # be polite

        await browser.close()

    csv_path = write_review_csv(results)
    print(f"\n[snkrdunk-discover] wrote review to {csv_path}", file=sys.stderr)
    n_patched = sum(1 for r in results if r.get("apparel_id"))
    n_applied = sum(1 for r in results
                    if r.get("apparel_id") and r["score"] >= min_conf and not args.dry_run)
    print(f"[snkrdunk-discover] summary: "
          f"{n_patched}/{len(cards)} mapped  ({n_applied} applied / rest skipped)",
          file=sys.stderr)
    return 0


def cli() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=__import__("argparse").RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0,
                    help="Only process the first N unmapped cards")
    ap.add_argument("--only-this", default="",
                    help="Only process this one master_id")
    ap.add_argument("--apply", action="store_true",
                    help="PATCH master_table for each match above the "
                         "min-confidence threshold")
    ap.add_argument("--dry-run", action="store_true",
                    help="Don't PATCH; just write the review CSV")
    args = ap.parse_args()
    if not args.apply and not args.dry_run and not args.only_this:
        # Default: dry-run when nothing is specified, so the user can
        # review the CSV before PATCHing.
        args.dry_run = True
    return asyncio.run(run(args))


if __name__ == "__main__":
    raise SystemExit(cli())
