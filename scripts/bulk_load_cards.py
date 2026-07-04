#!/usr/bin/env python3.9
"""Generate a SQL file that bulk-inserts all rows from data/master_table.csv
into the public.master_table table. Output is written to scripts/master_table_seed.sql.

The card `id` is generated deterministically per the scheme in src/lib/cardId.ts:
  PTCG: 'ptcg' + series + digits(card_index) + lowercase(rarity) + yuyutei_slug
  OPCG: 'opcg' + digits(card_index) + letters-only-lowercase(rarity) + yuyutei_slug
"""
import csv
import os
import re
import sys

CSV_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'master_table.csv')
OUT_PATH = os.path.join(os.path.dirname(__file__), 'master_table_seed.sql')
BATCH_SIZE = 500

# Map: csv_col -> db_col
COLUMN_MAP = {
    'tcg_type': 'tcg_type',
    'card_series': 'card_series',
    'card_index': 'card_index',
    'card_name': 'card_name',
    'card_rarity': 'card_rarity',
    'url_yuyutei': 'url_yuyutei',
}

def sql_escape(value: str) -> str:
    """Escape a string for a PostgreSQL single-quoted literal."""
    if value is None:
        return 'NULL'
    return "'" + value.replace("'", "''") + "'"

def yuyutei_slug(url: str) -> str:
    """Extract the last non-empty path segment from a yuyu-tei.jp URL."""
    if not url:
        return ''
    parts = [p for p in url.split('/') if p]
    return parts[-1] if parts else ''

def make_card_id(tcg_type: str, card_series: str, card_index: str, card_rarity: str, url_yuyutei: str) -> str:
    """Mirror of the frontend's src/lib/cardId.ts — keep in sync."""
    digits = re.sub(r'\D', '', card_index or '')
    slug = yuyutei_slug(url_yuyutei)
    if tcg_type == 'PTCG':
        return f"ptcg{(card_series or '').lower()}{digits}{(card_rarity or '').lower()}{slug}"
    # OPCG: keep letters + digits, lowercase, no non-alphanumeric
    opcg_index = re.sub(r'[^a-z0-9]', '', (card_index or '').lower())
    rarity_letters = re.sub(r'[^a-z]', '', (card_rarity or '').lower())
    return f"opcg{opcg_index}{rarity_letters}{slug}"

def main() -> int:
    with open(CSV_PATH, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f'Read {len(rows)} rows from {CSV_PATH}')

    cols_sql = 'id, ' + ', '.join(COLUMN_MAP.values())
    batch: list[str] = []
    total_written = 0
    with open(OUT_PATH, 'w', encoding='utf-8') as out:
        out.write('-- Auto-generated from data/master_table.csv\n')
        out.write('-- Run with: supabase db query --linked --file scripts/master_table_seed.sql\n\n')
        for row in rows:
            tcg_type = (row.get('tcg_type') or '').strip()
            card_series = (row.get('card_series') or '').strip()
            card_index = (row.get('card_index') or '').strip()
            card_rarity = (row.get('card_rarity') or '').strip()
            url_yuyutei = (row.get('url_yuyutei') or '').strip()
            card_id = make_card_id(tcg_type, card_series, card_index, card_rarity, url_yuyutei)
            values = [sql_escape(card_id)] + [
                sql_escape(row.get(c, '') or '') for c in COLUMN_MAP.keys()
            ]
            batch.append(f"  ({', '.join(values)})")
            if len(batch) >= BATCH_SIZE:
                out.write(f'INSERT INTO public.master_table ({cols_sql}) VALUES\n')
                out.write(',\n'.join(batch))
                out.write('\nON CONFLICT (id) DO NOTHING;\n\n')
                total_written += len(batch)
                batch = []
        if batch:
            out.write(f'INSERT INTO public.master_table ({cols_sql}) VALUES\n')
            out.write(',\n'.join(batch))
            out.write('\nON CONFLICT (id) DO NOTHING;\n\n')
            total_written += len(batch)
    print(f'Wrote {total_written} rows to {OUT_PATH}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
