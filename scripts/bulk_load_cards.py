#!/usr/bin/env python3.9
"""Generate a SQL file that bulk-inserts all rows from data/master_table.csv
into the public.master_table table. Output is written to scripts/master_table_seed.sql.
"""
import csv
import os
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

def main() -> int:
    with open(CSV_PATH, 'r', encoding='utf-8', newline='') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    print(f'Read {len(rows)} rows from {CSV_PATH}')

    cols_sql = ', '.join(COLUMN_MAP.values())
    batch: list[str] = []
    total_written = 0
    with open(OUT_PATH, 'w', encoding='utf-8') as out:
        out.write('-- Auto-generated from data/master_table.csv\n')
        out.write('-- Run with: supabase db query --linked --file scripts/master_table_seed.sql\n\n')
        for row in rows:
            values = [sql_escape(row.get(c, '') or '') for c in COLUMN_MAP.keys()]
            batch.append(f"  ({', '.join(values)})")
            if len(batch) >= BATCH_SIZE:
                out.write(f'INSERT INTO public.master_table ({cols_sql}) VALUES\n')
                out.write(',\n'.join(batch))
                out.write('\nON CONFLICT (tcg_type, card_series, card_index, card_rarity) DO NOTHING;\n\n')
                total_written += len(batch)
                batch = []
        if batch:
            out.write(f'INSERT INTO public.master_table ({cols_sql}) VALUES\n')
            out.write(',\n'.join(batch))
            out.write('\nON CONFLICT (tcg_type, series, card_number, rarity) DO NOTHING;\n\n')
            total_written += len(batch)
    print(f'Wrote {total_written} rows to {OUT_PATH}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
