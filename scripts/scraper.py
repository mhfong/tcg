"""
TCG Price Scraper - Placeholder
Scrapes snkrdunk.com for Japanese PTCG & OPCG card prices.

This is a scaffold. The actual scraping logic will be discussed and
implemented together with the user, as snkrdunk's page structure
and API endpoints need to be analyzed collaboratively.

Environment variables required:
  SUPABASE_URL          - Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY - Supabase service role key (bypasses RLS)
"""

import os
import sys
from datetime import datetime, timezone

import httpx
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def get_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
        sys.exit(1)
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def scrape_card_price(card: dict) -> list[dict]:
    """
    Scrape price data for a single card from snkrdunk.

    TODO: Implement with user once scraping logic is discussed.
    This function should return a list of price records:
    [
        {
            "card_id": card["id"],
            "condition": "PSA10" | "TAG10" | "RAW_A",
            "price": 12345,
            "buyers_count": 10,
            "scraped_at": "2026-05-03T00:00:00Z"
        }
    ]
    """
    url = card.get("snkrdunk_url")
    if not url:
        return []

    # Placeholder: actual scraping logic to be implemented
    print(f"  [SKIP] No scraping logic yet for: {card.get('name_jp', card['id'])}")
    return []


def main():
    print(f"=== TCG Price Scraper - {datetime.now(timezone.utc).isoformat()} ===")

    sb = get_supabase()

    # Get all cards that have a snkrdunk URL
    result = sb.table("cards").select("*").not_.is_("snkrdunk_url", "null").execute()
    cards = result.data

    if not cards:
        print("No cards with snkrdunk URLs found. Nothing to scrape.")
        return

    print(f"Found {len(cards)} cards to scrape")

    all_prices = []
    for card in cards:
        prices = scrape_card_price(card)
        all_prices.extend(prices)

    if all_prices:
        print(f"Inserting {len(all_prices)} price records...")
        sb.table("price_history").insert(all_prices).execute()
        print("Done!")
    else:
        print("No price data collected in this run.")


if __name__ == "__main__":
    main()
