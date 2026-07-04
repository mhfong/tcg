"""
Yuyu-tei set-page scraper.

Fetches a yuyu-tei.jp set listing page (e.g. /sell/poc/s/s12a) and
returns the available rarities and the cards in each rarity.

Used by scripts/parse_server.py for the "import from yuyu-tei" feature.
Can also be run from the CLI:

    python scripts/scrape_set.py poc s12a              # list all rarities
    python scripts/scrape_set.py poc s12a --rarity UR  # list UR cards
    python scripts/scrape_set.py poc s12a --json       # JSON output
"""

import argparse
import json
import re
import sys
from typing import Optional

import httpx

YUYUTEI_TCG_CODES = {
    "poc": "PTCG",
    "opc": "OPCG",
}

# Section header pattern: e.g. <span ...>UR</span> Card List or
# <span ...>P-SEC</span> Card List (parallel rarities on OPCG) or
# <span>-</span> Card List (the OPCG "don" section for ドン!!カード)
SECTION_HEADER_RE = re.compile(
    r'<span[^>]*>(P?-?[A-Z]{1,3}|-)</span>\s*Card\s*List',
    re.IGNORECASE,
)

# Each card is wrapped in <div class="card-product ...">
CARD_PRODUCT_RE = re.compile(r'<div\s+class="card-product[^"]*"', re.IGNORECASE)

# Within a card-product, extract the slug and the alt text (which
# contains the card number, rarity, and Japanese name).
SLUG_RE = re.compile(
    r'href="https://yuyu-tei\.jp/sell/(?:poc|opc)/card/[a-z0-9]+/(\d+)"',
)
ALT_RE = re.compile(r'alt="([^"]+)"')
NAME_RE = re.compile(r'<h4[^>]*>([^<]+)</h4>')


def fetch_set_page(tcg_code: str, series: str) -> str:
    """Fetch the yuyu-tei set listing page HTML."""
    tcg_code = tcg_code.lower()
    series = series.lower()
    url = f"https://yuyu-tei.jp/sell/{tcg_code}/s/{series}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.9",
    }
    with httpx.Client(timeout=30, follow_redirects=True, headers=headers) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.text


def list_rarities(tcg_code: str, series: str) -> list[str]:
    """
    Return the available rarity codes (in page order) for a set.
    Example: ["UR", "HR", "SAR", "MA", "CHR", "AR", "SR", "RR", "R", ...]

    On OPCG sets, a synthetic "GOLD-DON" entry is appended when the page
    has a <span>-</span> section (containing ドン!!カード super-parallels).
    """
    html = fetch_set_page(tcg_code, series)
    rarities = list({m.group(1).upper() for m in SECTION_HEADER_RE.finditer(html)})
    if tcg_code.lower() == "opc" and any(r == "-" for r in rarities):
        rarities.append("GOLD-DON")
    return rarities


def fetch_cards_in_rarity(
    tcg_code: str, series: str, rarity: str
) -> list[dict]:
    """
    Return the list of cards in the given rarity for the set.

    Each item: { "card_index": "259/172", "card_name": "オリジンパルキアVSTAR",
                  "url_yuyutei": "https://yuyu-tei.jp/sell/poc/card/s12a/10348" }

    Special rarity "GOLD-DON" (OPCG only) returns the super-parallel
    (スーパーパラレル) ドン!! cards in the set's <span>-</span> section.
    """
    html = fetch_set_page(tcg_code, series)
    rarity_upper = rarity.upper()

    # Special case: GOLD-DON maps to the <span>-</span> section, filtered
    # to only the スーパーパラレル (super parallel / gold) variants.
    if rarity_upper == "GOLD-DON":
        return _fetch_gold_don_cards(tcg_code, series, html)

    # Find the section for this rarity (match both plain "UR" and "P-UR" forms)
    header_m = re.search(
        rf'<span[^>]*>{re.escape(rarity_upper)}</span>\s*Card\s*List',
        html,
        re.IGNORECASE,
    )
    if not header_m:
        return []
    start = header_m.end()
    # Section ends at the next rarity section
    next_m = SECTION_HEADER_RE.search(html, start)
    end = next_m.start() if next_m else len(html)
    section = html[start:end]

    base_url = f"https://yuyu-tei.jp/sell/{tcg_code.lower()}/card/{series.lower()}"
    cards = []
    seen_slugs: set[str] = set()

    for prod in CARD_PRODUCT_RE.split(section)[1:]:
        slug_m = SLUG_RE.search(prod)
        if not slug_m:
            continue
        slug = slug_m.group(1)
        if slug in seen_slugs:
            continue
        seen_slugs.add(slug)

        # Find the alt that contains the rarity (skip the "Star" favorite icon).
        # The card alts look like:
        #   PTCG: "259/172 UR オリジンパルキアVSTAR"
        #   OPCG: "OP15-007 SR ギン"
        #   OPCG parallel: "OP15-118 P-SEC エネルギル(パラレル)"
        # The 2nd whitespace-separated part is the rarity, which may be
        # "UR", "SR", "P-SEC", "P-SR", etc.
        rarity_alt_m = None
        for alt_m in ALT_RE.finditer(prod):
            alt = alt_m.group(1)
            # Skip the "Star" favorite icon
            if alt.strip() == "Star":
                continue
            # The card alt always has at least 3 space-separated parts and the
            # 2nd part is the rarity (UR, SR, P-SEC, etc.). Verify that.
            parts = alt.split(None, 2)
            if len(parts) >= 3 and parts[1].upper() == rarity_upper:
                rarity_alt_m = alt
                break
        if not rarity_alt_m:
            continue
        alt = rarity_alt_m

        parts = alt.split(None, 2)
        card_index, alt_rarity, card_name = parts
        if alt_rarity.upper() != rarity_upper:
            # Should not happen given the loop above, but be safe
            continue

        cards.append(
            {
                "card_index": card_index,
                "card_name": card_name,
                "url_yuyutei": f"{base_url}/{slug}",
            }
        )

    return cards


def _fetch_gold_don_cards(tcg_code: str, series: str, html: str) -> list[dict]:
    """
    Return the GOLD-DON (super-parallel ドン!!カード) entries for the set.

    Yuyu-tei lists DON!! cards in a <span>-</span> Card List section, with
    alts shaped like "- - ドン!!カード(<effect>)(パラレル)(スーパーパラレル)".
    We capture only the スーパーパラレル variants and tag them as
    card_index "GOLD-DON" with the gold-don rarity.
    """
    header_m = re.search(
        r'<span[^>]*>-</span>\s*Card\s*List',
        html,
        re.IGNORECASE,
    )
    if not header_m:
        return []
    start = header_m.end()
    next_m = SECTION_HEADER_RE.search(html, start)
    end = next_m.start() if next_m else len(html)
    section = html[start:end]

    base_url = f"https://yuyu-tei.jp/sell/{tcg_code.lower()}/card/{series.lower()}"
    cards: list[dict] = []
    seen_slugs: set[str] = set()

    for prod in CARD_PRODUCT_RE.split(section)[1:]:
        slug_m = SLUG_RE.search(prod)
        if not slug_m:
            continue
        slug = slug_m.group(1)
        if slug in seen_slugs:
            continue

        # Find the alt that is a DON!! card and is the gold/super-parallel
        # variant (must contain スーパーパラレル).
        gold_alt: Optional[str] = None
        for alt_m in ALT_RE.finditer(prod):
            alt = alt_m.group(1).strip()
            if alt == "Star":
                continue
            if not alt.startswith("- -"):
                continue
            if "スーパーパラレル" not in alt:
                continue
            gold_alt = alt
            break
        if not gold_alt:
            continue

        seen_slugs.add(slug)
        # Strip the leading "- - " to get just the card name
        card_name = gold_alt[3:].strip()
        cards.append(
            {
                "card_index": "GOLD-DON",
                "card_name": card_name,
                "url_yuyutei": f"{base_url}/{slug}",
            }
        )

    return cards


# ---------- CLI ---------- #

def main() -> int:
    p = argparse.ArgumentParser(description="Scrape a yuyu-tei set page")
    p.add_argument("tcg", help="TCG code (poc or opc)")
    p.add_argument("series", help="Series slug, e.g. s12a, op15")
    p.add_argument("--rarity", help="If set, list only cards in this rarity")
    p.add_argument("--json", action="store_true", help="Output as JSON")
    args = p.parse_args()

    try:
        if args.rarity:
            cards = fetch_cards_in_rarity(args.tcg, args.series, args.rarity)
        else:
            rarities = list_rarities(args.tcg, args.series)
            if args.json:
                print(json.dumps({"rarities": rarities}, ensure_ascii=False))
            else:
                print(f"Available rarities in [{args.series}]:")
                for r in rarities:
                    print(f"  - {r}")
            return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1

    if args.json:
        print(
            json.dumps(
                {"tcg": args.tcg, "series": args.series, "rarity": args.rarity, "cards": cards},
                ensure_ascii=False,
            )
        )
    else:
        print(f"\n{len(cards)} {args.rarity} cards in [{args.series}]:\n")
        for c in cards:
            print(f"  • {c['card_index']:<10}  {c['card_name']}")
            print(f"    {c['url_yuyutei']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
