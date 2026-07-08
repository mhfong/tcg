"""
Discover the SNKRDUNK apparel_id for each card in master_table.

What it does
------------
For each card in `master_table` (or in data/master_snkrdunk.csv if no
Supabase env), the script finds the SNKRDUNK `apparel_id` (the 5-digit
number in the URL `snkrdunk.com/apparels/<apparel_id>`).

Two operating modes
-------------------

1. **Cookie mode** (recommended; the only fully-automated mode)
   Set the env var `SNKRDUNK_SESSION_ID` to a valid SNKRDUNK session
   cookie value. The script will then hit SNKRDUNK's authenticated
   v2 search API and get real, keyword-filtered results. To find your
   session cookie: log in to https://snkrdunk.com/ in your browser,
   open DevTools > Application > Cookies > snkrdunk.com, copy the
   `sessionid` value.

2. **Guided mode** (no auth needed; user does the click-through)
   The script uses SNKRDUNK's anonymous v3 autocomplete API to find
   the canonical search keyword for each card, then writes a clickable
   `https://snkrdunk.com/search?keyword=...` URL to a CSV column.
   You then open each URL, find the matching product, and copy the
   apparel_id back into the CSV. The script re-reads the CSV on the
   next run.

Why two modes
-------------
SNKRDUNK's main search backend requires an authenticated session.
Anonymous search returns a fixed list of trending products regardless
of the keyword. The autocomplete (v3) API is the only anonymous
endpoint that exposes any product information. So:

  - With auth: fully automated, instant.
  - Without auth: ~10 seconds per card to type into the search bar,
    which is what "guided mode" generates a URL for.

Output
------
In both modes, the script writes results to
`data/master_snkrdunk.csv` (snkrdunk_apparel_id column). With
`--apply`, it also PATCHes the live `master_table.snkr_dunk_apparel_id`
column in Supabase.

Examples
--------
    # Guided mode (anonymous, no DB writes)
    python scripts/discover_snkrdunk_ids.py

    # Cookie mode (anonymous) - snkrdunk_apparel_id auto-discovered
    SNKRDUNK_SESSION_ID=abc123... python scripts/discover_snkrdunk_ids.py

    # Cookie mode + apply to live DB
    SNKRDUNK_SESSION_ID=... \\
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
        python scripts/discover_snkrdunk_ids.py --apply

    # Only the first 5 cards (debug)
    python scripts/discover_snkrdunk_ids.py --limit 5
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
from datetime import date
from pathlib import Path
from typing import Optional

try:
    import httpx
except ImportError:
    print("httpx required.", file=sys.stderr)
    sys.exit(2)


# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CSV = ROOT / "data" / "master_snkrdunk.csv"

SNKRDUNK_BASE = "https://snkrdunk.com"

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)

# Score threshold for picking a candidate
CONFIDENCE_THRESHOLD = 4

# Map card_rarity -> regex(es) that match the rarity token in a result title
RARITY_PATTERNS = {
    "SP":     [r"\bSP\b"],
    "SR":     [r"\bSR\b"],
    "SEC":    [r"\bSEC\b"],
    "SEC-SPC": [r"SEC[\-‐−]?SPC", r"SEC\s*SPC"],
    "SEC-SP":  [r"SEC[\-‐−]?SP"],
    "P-SEC":  [r"P[\-‐−]?SEC"],
    "L":      [r"\bL\b"],
    "MUR":    [r"\bMUR\b"],
    "SAR":    [r"\bSAR\b"],
    "AR":     [r"\bAR\b"],
    "RRR":    [r"\bRRR\b"],
    "CHR":    [r"\bCHR\b"],
    "ACE":    [r"\bACE\b"],
    "TR":     [r"\bTR\b"],
    "R":      [r"\bR\b"],
    "UC":     [r"\bUC\b"],
    "C":      [r"\bC\b"],
}


# ─────────────────────────────────────────────────────────────────────────────
# master_table fetch
# ─────────────────────────────────────────────────────────────────────────────

def fetch_master_table() -> list[dict]:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return []
    H = {"apikey": key, "Authorization": f"Bearer {key}"}
    out: list[dict] = []
    offset = 0
    while True:
        r = httpx.get(
            f"{url}/rest/v1/master_table",
            params={
                "select": "id,tcg_type,card_series,card_index,card_name,card_rarity,url_yuyutei,snkrdunk_apparel_id",
                "order": "id", "limit": 1000, "offset": offset,
            },
            headers=H, timeout=30,
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


# ─────────────────────────────────────────────────────────────────────────────
# SNKRDUNK API: anonymous v3 autocomplete
# ─────────────────────────────────────────────────────────────────────────────

def snkrdunk_suggestions(keyword: str) -> list[dict]:
    """Hit the anonymous v3 autocomplete API. Returns [{keyword}]."""
    try:
        r = httpx.get(
            f"{SNKRDUNK_BASE}/v3/search/suggestions",
            params={"keyword": keyword, "limit": 10},
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/json",
                "Referer": f"{SNKRDUNK_BASE}/",
            },
            timeout=15,
        )
    except httpx.HTTPError as e:
        print(f"  [v3] network error: {e}", file=sys.stderr)
        return []
    if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
        return []
    try:
        data = r.json()
        return data.get("suggestions", [])
    except json.JSONDecodeError:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# SNKRDUNK API: authenticated v2 search
# ─────────────────────────────────────────────────────────────────────────────

def snkrdunk_search_v2(keyword: str, session_id: str) -> list[dict]:
    """Hit the v2 search API with the user's session cookie.

    Returns [{apparel_id, name, ...}] from the response. Empty list if
    the session is invalid or the API rejects the request.
    """
    cookies = {"sessionid": session_id}
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Referer": f"{SNKRDUNK_BASE}/",
        "Origin": SNKRDUNK_BASE,
    }
    # Try v2 with department=tradingcard
    try:
        r = httpx.get(
            f"{SNKRDUNK_BASE}/v2/search",
            params={"keyword": keyword, "limit": 20, "page": 1,
                    "department": "tradingcard"},
            cookies=cookies, headers=headers, timeout=15,
        )
    except httpx.HTTPError as e:
        print(f"  [v2] network error: {e}", file=sys.stderr)
        return []
    if r.status_code != 200 or "json" not in r.headers.get("content-type", ""):
        print(f"  [v2] status={r.status_code}", file=sys.stderr)
        return []
    try:
        data = r.json()
    except json.JSONDecodeError:
        return []
    return data.get("products", [])


# ─────────────────────────────────────────────────────────────────────────────
# Query building
# ─────────────────────────────────────────────────────────────────────────────

def build_query_variants(card: dict) -> list[str]:
    """Build 3 progressively-looser queries to try against SNKRDUNK."""
    idx = card.get("card_index") or ""
    rarity = card.get("card_rarity") or ""
    name = card.get("card_name") or ""
    tcg = card.get("tcg_type") or ""
    out: list[str] = []
    if name and idx:
        # Clean the name: drop [OPxx-xxx] suffix
        clean = re.sub(r"\s*\[[A-Z]{2,4}[-‐−]?\d+\]\s*", " ", name).strip()
        out.append(f"{clean} {idx}".strip())
    if idx and rarity:
        out.append(f"{idx} {rarity}")
    if idx:
        out.append(idx)
    if name:
        clean = re.sub(r"\s*\[[A-Z]{2,4}[-‐−]?\d+\]\s*", " ", name).strip()
        if clean and clean not in out:
            out.append(clean[:60])
    return out[:4]


def build_query_for_suggestions(card: dict) -> str:
    """Build a short keyword to send to the autocomplete API.

    Best with a Japanese card_name (the autocomplete is JP-localized).
    Falls back to card_index alone.
    """
    name = card.get("card_name") or ""
    idx = card.get("card_index") or ""
    if name:
        # Strip [OPxx-xxx] suffix; keep Japanese characters
        clean = re.sub(r"\s*\[[A-Z]{2,4}[-‐−]?\d+\]\s*", " ", name).strip()
        # Take the first 12 chars - long enough to disambiguate, short
        # enough that DDG/SNKRDUNK autocomplete can expand it
        return clean[:12]
    return idx


# ─────────────────────────────────────────────────────────────────────────────
# Candidate scoring (used for cookie mode)
# ─────────────────────────────────────────────────────────────────────────────

def score_v2_candidate(card: dict, product: dict) -> int:
    """Score a v2 search result against a card. Higher = better."""
    score = 0
    name = product.get("name", "") or ""
    idx = card.get("card_index", "")
    rarity = card.get("card_rarity", "")
    if idx and idx in name:
        score += 3
    elif idx and re.search(re.escape(idx.split("-")[0]), name):
        score += 1
    if rarity:
        for pat in RARITY_PATTERNS.get(rarity, [re.escape(rarity)]):
            if re.search(pat, name):
                score += 2
                break
    return score


def best_v2_match(card: dict, products: list[dict]) -> Optional[dict]:
    if not products:
        return None
    scored = [(score_v2_candidate(card, p), p) for p in products]
    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_prod = scored[0]
    if best_score < CONFIDENCE_THRESHOLD:
        return None
    return {**best_prod, "score": best_score}


# ─────────────────────────────────────────────────────────────────────────────
# DB apply
# ─────────────────────────────────────────────────────────────────────────────

def apply_to_supabase(results: list[dict]) -> None:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[snkrdunk-discover] --apply: missing SUPABASE_URL / "
              "SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        return
    H = {"apikey": key, "Authorization": f"Bearer {key}",
         "Content-Type": "application/json"}
    for r in results:
        body = {"snkrdunk_apparel_id": r["apparel_id"]}
        resp = httpx.patch(
            f"{url}/rest/v1/master_table",
            params={"id": f"eq.{r['master_id']}"},
            json=body, headers=H, timeout=15,
        )
        if resp.status_code in (200, 204):
            print(f"  PATCH {r['master_id']} -> {r['apparel_id']} OK",
                  file=sys.stderr)
        else:
            print(f"  PATCH {r['master_id']} failed: {resp.status_code} "
                  f"{resp.text[:200]}", file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────────
# main
# ─────────────────────────────────────────────────────────────────────────────

def main(args: argparse.Namespace) -> int:
    print(f"[snkrdunk-discover] loading master_table ...", file=sys.stderr)
    cards = fetch_master_table()
    if not cards:
        print("[snkrdunk-discover] WARN: no master_table rows loaded "
              "(SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing). "
              "Reading from data/master_snkrdunk.csv instead.",
              file=sys.stderr)
        if not DEFAULT_CSV.exists():
            print(f"[snkrdunk-discover] {DEFAULT_CSV} not found; nothing to do",
                  file=sys.stderr)
            return 1
        with DEFAULT_CSV.open() as f:
            csv_cards = list(csv.DictReader(f))
        for c in csv_cards:
            if "id" not in c and "master_id" in c:
                c["id"] = c["master_id"]
        cards = csv_cards

    if args.only_missing:
        before = len(cards)
        cards = [c for c in cards if not c.get("snkrdunk_apparel_id")]
        print(f"[snkrdunk-discover] {before - len(cards)} already mapped, "
              f"{len(cards)} to discover", file=sys.stderr)

    if args.limit:
        cards = cards[: args.limit]

    # Read existing CSV
    existing: dict[str, dict] = {}
    if DEFAULT_CSV.exists():
        with DEFAULT_CSV.open() as f:
            for row in csv.DictReader(f):
                existing[row["master_id"]] = row
    for c in cards:
        if c["id"] not in existing:
            existing[c["id"]] = {
                "master_id": c["id"],
                "tcg_type": c.get("tcg_type", ""),
                "card_series": c.get("card_series", ""),
                "card_index": c.get("card_index", ""),
                "card_rarity": c.get("card_rarity", ""),
                "yuyutei_slug": (c.get("url_yuyutei") or "").rsplit("/", 1)[-1],
                "card_name_hint": c.get("card_name", ""),
                "snkrdunk_apparel_id": "",
                "snkrdunk_search_url": "",
                "verified_at": "",
            }
        # Always refresh card_name_hint with the live master_table value
        # (the CSV's hint can be stale if it was hand-written)
        live_name = c.get("card_name", "")
        if live_name:
            existing[c["id"]]["card_name_hint"] = live_name

    if not cards:
        print("[snkrdunk-discover] nothing to discover", file=sys.stderr)
        return 0

    session_id = os.environ.get("SNKRDUNK_SESSION_ID", "").strip()
    if session_id:
        print(f"[snkrdunk-discover] cookie mode: SNKRDUNK_SESSION_ID "
              f"is set (len={len(session_id)})", file=sys.stderr)
    else:
        print("[snkrdunk-discover] guided mode: SNKRDUNK_SESSION_ID not set; "
              "will use the v3 autocomplete to build a clickable search URL "
              "for each card. You then click the URL, find the product, and "
              "paste the apparel_id back into the CSV.", file=sys.stderr)

    found = 0
    not_found = 0
    results: list[dict] = []
    for i, card in enumerate(cards, 1):
        cid = card["id"]
        print(f"[{i}/{len(cards)}] {cid} ({card.get('tcg_type')} "
              f"{card.get('card_series')} {card.get('card_index')} "
              f"{card.get('card_rarity')})", file=sys.stderr)

        if session_id:
            # Cookie mode: try v2 search with each query variant
            queries = build_query_variants(card)
            best: Optional[dict] = None
            for q in queries:
                print(f"  q: {q}", file=sys.stderr)
                products = snkrdunk_search_v2(q, session_id)
                if products:
                    candidate = best_v2_match(card, products)
                    if candidate and (not best or candidate["score"] > best["score"]):
                        best = candidate
            if best:
                apparel_id = str(best.get("id") or best.get("apparelId") or "")
                if not apparel_id:
                    print(f"  -> match found but no apparelId in result: "
                          f"{list(best.keys())[:5]}", file=sys.stderr)
                    not_found += 1
                else:
                    print(f"  -> {apparel_id}  (score={best['score']})  "
                          f"\"{(best.get('name') or '')[:80]}\"",
                          file=sys.stderr)
                    existing[cid]["snkrdunk_apparel_id"] = apparel_id
                    existing[cid]["verified_at"] = "auto-" + date.today().isoformat()
                    found += 1
                    results.append({"master_id": cid, "apparel_id": apparel_id})
            else:
                print(f"  -> no confident match", file=sys.stderr)
                not_found += 1
        else:
            # Guided mode: build a SNKRDUNK search URL using the v3
            # autocomplete to pick a good keyword
            idx = card.get("card_index", "")
            name = card.get("card_name", "")
            # Build queries in priority order
            queries_to_try: list[str] = []
            if name:
                clean = re.sub(r"\s*\[[A-Z]{2,4}[-‐−]?\d+\]\s*", " ", name).strip()
                if clean:
                    queries_to_try.append(clean[:12])  # Japanese name
                    queries_to_try.append(f"{clean} {idx}".strip() if idx else clean)
            if idx:
                queries_to_try.append(idx)
                queries_to_try.append(f"{idx} {card.get('card_rarity', '')}".strip())
            # Pick the first query that the SNKRDUNK autocomplete recognises
            best_kw = None
            best_kw_source = None
            for q in queries_to_try:
                if not q:
                    continue
                print(f"  q: {q}", file=sys.stderr)
                suggestions = snkrdunk_suggestions(q)
                if not suggestions:
                    continue
                # Prefer a suggestion that contains the card_index
                if idx:
                    for s in suggestions:
                        k = s.get("keyword", "")
                        if idx.lower() in k.lower():
                            best_kw = k
                            best_kw_source = "v3-autocomplete"
                            break
                if not best_kw:
                    best_kw = suggestions[0].get("keyword", "")
                    best_kw_source = "v3-autocomplete"
                if best_kw:
                    break
            if not best_kw:
                # Fall back to the first query verbatim
                best_kw = queries_to_try[0] if queries_to_try else idx
                best_kw_source = "fallback"
            search_url = f"{SNKRDUNK_BASE}/search?keyword={urllib.parse.quote(best_kw)}"
            existing[cid]["snkrdunk_search_url"] = search_url
            print(f"  -> {search_url}  ({best_kw_source})", file=sys.stderr)
            print(f"     (open this URL, find the matching product, "
                  f"copy the 5-digit apparel_id)", file=sys.stderr)

    # Write CSV
    DEFAULT_CSV.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["master_id", "tcg_type", "card_series", "card_index",
                  "card_rarity", "yuyutei_slug", "card_name_hint",
                  "snkrdunk_apparel_id", "snkrdunk_search_url", "verified_at"]
    with DEFAULT_CSV.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        seen_ids = {c["id"] for c in cards}
        for cid in [c["id"] for c in cards] + [k for k in existing if k not in seen_ids]:
            w.writerow(existing[cid])
    print(f"[snkrdunk-discover] wrote {DEFAULT_CSV}", file=sys.stderr)

    if session_id:
        print(f"\n[snkrdunk-discover] done. found={found} not_found={not_found}",
              file=sys.stderr)
    else:
        print(f"\n[snkrdunk-discover] done. {len(cards)} search URLs written "
              f"to {DEFAULT_CSV}. Open each URL, copy the apparel_id, and "
              f"re-run this script to verify.", file=sys.stderr)
    if results:
        print("\nDiscovered apparel_ids:", file=sys.stderr)
        for r in results:
            print(f"  {r['master_id']:<35} -> {r['apparel_id']}",
                  file=sys.stderr)
    if args.apply and results:
        apply_to_supabase(results)
    return 0


def cli() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--limit", type=int, default=0,
                    help="Only process the first N cards (debug)")
    ap.add_argument("--only-missing", action="store_true",
                    help="Skip cards that already have a snkrdunk_apparel_id")
    ap.add_argument("--apply", action="store_true",
                    help="PATCH master_table.snkr_dunk_apparel_id in Supabase "
                         "for each confident match (cookie mode only)")
    args = ap.parse_args()
    return main(args)


if __name__ == "__main__":
    raise SystemExit(cli())
