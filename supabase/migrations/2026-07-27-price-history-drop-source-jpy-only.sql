-- ============================================================================
-- price_history: drop `source`, rename `price` -> `price_jpy`, add FX columns
-- ============================================================================
--
-- BACKGROUND
--   The table used to mix three currencies under one `source` column:
--     - 'jp' (yuyu-tei JPY, price)
--     - 'en' (snkrdunk HKD, price_hkd)
--   We're consolidating: every row will be JPY, with price_hkd derived from
--   the daily JPY→HKD rate stamped at observation time. The `source` column
--   is no longer needed; the column `price_jpy` makes the unit explicit.
--
-- WHAT THIS MIGRATION DOES
--   1. Drop the CHECK constraint on `source`.
--   2. Drop the `source` column.
--   3. Rename `price` (the JPY column) to `price_jpy`.
--   4. Add `fx_rate_jpy_hkd NUMERIC(12,8)` (the rate used) and
--      `fx_rate_date DATE` (the date of the rate) columns.
--   5. Backfill `price_hkd`, `fx_rate_jpy_hkd`, `fx_rate_date` for existing
--      rows using TODAY's rate from frankfurter.app. Skippable — leave the
--      block commented out if you want to backfill lazily.
--   6. Make `price_hkd` NOT NULL going forward (new rows always carry a rate).
--
-- RUN ORDER
--   Apply this first, then the separate `time_text` migration if not yet
--   applied:
--     supabase db query --linked --file supabase/migrations/2026-07-27-price-history-time-text.sql

BEGIN;

-- 1. Drop CHECK on source
ALTER TABLE price_history
  DROP CONSTRAINT IF EXISTS price_history_source_check;

-- 2. Drop the source column itself
ALTER TABLE price_history
  DROP COLUMN IF EXISTS source;

-- 3. Rename price (JPY) -> price_jpy
ALTER TABLE price_history
  RENAME COLUMN price TO price_jpy;

-- 4. Add FX tracking columns
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS fx_rate_jpy_hkd NUMERIC(12, 8) NULL,
  ADD COLUMN IF NOT EXISTS fx_rate_date    DATE         NULL;

-- 5. Make price_hkd NOT NULL for new rows (existing rows must be backfilled
--    first; the UPDATE below does that with the current rate).
--    If you skip step 6's UPDATE, comment out this ALTER too.
ALTER TABLE price_history
  ALTER COLUMN price_hkd DROP NOT NULL;

-- 6. Backfill existing rows.
--    TODO: before running this, hit
--      curl -sSL 'https://api.frankfurter.app/latest?from=JPY&to=HKD'
--    and substitute the rate + date below. Example from 2026-07-24:
--      rate = 0.04787, date = '2026-07-24'
--
-- UPDATE price_history
-- SET price_hkd      = ROUND(price_jpy * <RATE>)::INTEGER,
--     fx_rate_jpy_hkd = <RATE>,
--     fx_rate_date    = '<YYYY-MM-DD>'
-- WHERE price_hkd IS NULL
--   AND price_jpy IS NOT NULL;

-- 7. Tighten price_hkd NOT NULL again — enable once step 6 has run.
-- ALTER TABLE price_history
--   ALTER COLUMN price_hkd SET NOT NULL;

COMMIT;

-- ============================================================================
-- Optional sanity check (run separately after migration):
--   SELECT
--     COUNT(*)                                       AS total,
--     COUNT(*) FILTER (WHERE price_jpy IS NOT NULL)  AS jpy_rows,
--     COUNT(*) FILTER (WHERE price_hkd IS NOT NULL)  AS hkd_rows,
--     COUNT(*) FILTER (WHERE fx_rate_date IS NOT NULL) AS fx_stamped
--   FROM price_history;
-- ============================================================================