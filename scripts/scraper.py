"""
Yuyu-tei product page parser.

Fetches a yuyu-tei.jp product page and extracts structured card fields
(TCG type, series, card number, name, rarity, image URL).

Used by:
  - scripts/parse_server.py — local HTTP proxy (browser calls this)
  - CLI: python scripts/scraper.py <url> [--json]
"""

import argparse
import json
import re
from typing import Optional

import httpx

# TCG code used in yuyu-tei URL paths
YUYUTEI_TCG_CODES = {
    "poc": "PTCG",
    "opc": "OPCG",
}

# TCG code used in the image CDN path
YUYUTEI_IMAGE_TCG_CODES = {
    "PTCG": "poc",
    "OPCG": "opc",
}


def parse_yuyutei_url(url: str) -> Optional[dict]:
    """
    Extract structural fields directly from a yuyu-tei.jp product URL.
    Returns a dict with tcg_type, series, slug_id, or None if invalid.
    """
    if not url:
        return None
    try:
        u = httpx.URL(url)
    except Exception:
        return None
    if u.host not in ("yuyu-tei.jp", "www.yuyu-tei.jp"):
        return None

    # Path looks like /sell/poc/card/s12a/10262  or  /sell/opc/card/op01/0123
    parts = [p for p in u.path.split("/") if p]
    if len(parts) < 5 or parts[0] != "sell" or parts[2] != "card":
        return None

    tcg_code = parts[1].lower()
    tcg_type = YUYUTEI_TCG_CODES.get(tcg_code)
    if not tcg_type:
        return None

    series = parts[3].lower()
    slug_id = parts[4]
    return {"tcg_type": tcg_type, "series": series, "slug_id": slug_id}


def extract_card_number(html: str, tcg_type: str) -> str:
    """
    Extract the card's collector number from the page HTML.

    Strategy (most-reliable first):
      1. JSON-LD `description` field, e.g. "OP15-119" or "259/172"
      2. og:description meta tag (first card-number-shaped token)
      3. TCG-specific pattern: OPCG uses alphanumeric (OP15-119),
         PTCG uses slash form (259/172)
    """
    # 1. JSON-LD description — cleanest source on yuyu-tei
    m = re.search(
        r'"description"\s*:\s*"([A-Z]{0,3}\d{0,3}[-/]\d{1,4}[A-Za-z0-9]*)"',
        html,
    )
    if m:
        return m.group(1).replace(" ", "")

    # 2. og:description meta tag
    m = re.search(
        r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        flags=re.IGNORECASE,
    )
    if m:
        token = re.search(r"[A-Z]{0,3}\d{0,3}[-/]\d{1,4}", m.group(1))
        if token:
            return token.group(0)

    # 3. Pattern by TCG
    if tcg_type == "OPCG":
        m = re.search(r"\b(OP\d+[-/]\d{1,4})\b", html)
        if m:
            return m.group(1).replace("/", "-")
    # PTCG fallback (slash form). Use a leading word boundary so we
    # don't accidentally match `op15/10146.jpg` from the og:image URL.
    m = re.search(r"\b(\d{1,4}/\d{1,4})\b", html)
    if m:
        return m.group(1)

    return ""


def parse_yuyutei_card(url: str) -> dict:  # noqa: C901  (extraction, kept together)
    """
    Fetch a yuyu-tei product page and return structured card fields.

    Returns a dict with:
      tcg_type, card_series, card_index, card_name, card_rarity,
      url_yuyutei, image_url

    On failure, returns {"error": "..."}.
    """
    meta = parse_yuyutei_url(url)
    if not meta:
        return {"error": f"Invalid yuyu-tei URL: {url}"}

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0 Safari/537.36"
        ),
        "Accept-Language": "ja,en;q=0.9",
    }

    try:
        r = httpx.get(url, headers=headers, timeout=15.0, follow_redirects=True)
        r.raise_for_status()
    except httpx.HTTPError as e:
        return {"error": f"Fetch failed: {e}"}

    html = r.text

    # Title examples:
    #   PTCG: "AR ヒスイビリリダマ | 販売 | [S12a] ハイクラスパック ... | ポケモンカードゲーム"
    #   OPCG: "P-SEC モンキー・D・ルフィ(パラレル) | 販売 | [OP15]神の島の冒険 | ONE PIECEカードゲーム"
    title_match = re.search(r"<title>([^<]+)</title>", html)
    title = title_match.group(1).strip() if title_match else ""
    # Strip site suffix "| ポケモンカードゲーム" / "| ONE PIECE カードゲーム"
    title = re.sub(r"\s*\|\s*(ポケモンカードゲーム|ONE PIECE.*|ワンピース.*)\s*$", "", title)
    head = title.split("|")[0].strip() if title else ""
    # Strip trailing 販売 / 買取 verb
    head = re.sub(r"\s+(販売|買取)\s*$", "", head)
    # Strip ALL trailing parenthetical qualifiers (loop so we handle
    #   "name(foo)(bar)" → "name" and "ドン!!カード(x)(パラレル)(スーパーパラレル)" → "ドン!!カード(x)")
    while re.search(r"\s*\([^)]*\)\s*$", head):
        head = re.sub(r"\s*\([^)]*\)\s*$", "", head)
    head_tokens = head.split(maxsplit=1)
    rarity = head_tokens[0] if head_tokens else ""
    name_jp = head_tokens[1] if len(head_tokens) > 1 else ""
    # Special case: yuyu-tei uses "-" as the rarity placeholder for
    # ドン!! cards (which have GOLD-DON rarity). Detect and fix.
    if name_jp.startswith("ドン!!カード") and rarity == "-":
        rarity = "GOLD-DON"

    # Series from bracket in title: [S12a] or [OP01]
    series_match = re.search(r"\[([A-Za-z0-9]+)\]", title)
    series = series_match.group(1).lower() if series_match else meta["series"]

    # Card number — multiple strategies, most-precise first
    card_number = extract_card_number(html, meta["tcg_type"])

    # Image URL — predictable CDN path
    image_tcg = YUYUTEI_IMAGE_TCG_CODES.get(meta["tcg_type"], "poc")
    image_url = f"https://card.yuyu-tei.jp/{image_tcg}/front/{series}/{meta['slug_id']}.jpg"

    return {
        "tcg_type": meta["tcg_type"],
        "card_series": series,
        "card_index": card_number,
        "card_name": name_jp,
        "card_rarity": rarity,
        "url_yuyutei": url,
        "image_url": image_url,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Parse a yuyu-tei product page")
    parser.add_argument("url", help="e.g. https://yuyu-tei.jp/sell/poc/card/s12a/10262")
    parser.add_argument("--json", action="store_true",
                        help="Output compact JSON (no pretty-printing)")
    args = parser.parse_args()

    result = parse_yuyutei_card(args.url)
    print(json.dumps(result, ensure_ascii=False, indent=None if args.json else 2))
