-- ============================================================================
-- price_history: backfill price_jpy, fx_rate_jpy_hkd, fx_rate_date
-- ============================================================================
--
-- BACKGROUND
--   The 142 pre-existing rows were scraped from JP-locale SNKRDUNK
--   pages (prices rendered in ¥) but were stored under price_hkd
--   because the old schema had a single currency-agnostic numeric
--   column. The price_hkd column actually holds JPY values.
--
--   The new schema separates price_jpy (raw scraped value) from
--   price_hkd (derived via fx_rate_jpy_hkd), so we:
--     1. Copy price_hkd → price_jpy (the real JPY value).
--     2. Compute price_hkd = round(price_jpy * rate).
--     3. Stamp fx_rate_jpy_hkd and fx_rate_date with today's rate.
--
-- RATE USED
--   0.04787  (1 JPY = 0.04787 HKD)
--   date     2026-07-24
--   source   https://api.frankfurter.dev/v1/latest?from=JPY&to=HKD
--
-- APPLY ORDER
--   After:
--     1. 2026-07-27-price-history-drop-source-jpy-only.sql
--     2. 2026-07-27-price-history-time-text.sql
--
-- SAFE TO RE-RUN
--   Yes, idempotent: the WHERE filter only touches rows whose
--   price_jpy and price_hkd are both non-null.
-- ============================================================================

UPDATE price_history
SET
  price_jpy       = price_hkd,                            -- original "price_hkd" actually held JPY
  price_hkd       = ROUND(price_hkd * 0.04787)::integer,
  fx_rate_jpy_hkd = 0.04787,
  fx_rate_date    = DATE '2026-07-24'
WHERE price_jpy IS NOT NULL
  AND price_hkd IS NOT NULL;

-- Verification
SELECT
  COUNT(*)                                       AS total,
  COUNT(*) FILTER (WHERE price_jpy IS NOT NULL)  AS jpy_rows,
  COUNT(*) FILTER (WHERE price_hkd IS NOT NULL)  AS hkd_rows,
  ROUND(AVG(price_jpy))                          AS avg_price_jpy,
  ROUND(AVG(price_hkd))                          AS avg_price_hkd,
  MIN(price_jpy)                                 AS min_jpy,
  MAX(price_jpy)                                 AS max_jpy
FROM price_history;

-- Optional follow-up: enforce NOT NULL once data is consistent.
-- ALTER TABLE price_history
--   ALTER COLUMN price_jpy       SET NOT NULL,
--   ALTER COLUMN price_hkd       SET NOT NULL,
--   ALTER COLUMN fx_rate_jpy_hkd SET NOT NULL,
--   ALTER COLUMN fx_rate_date    SET NOT NULL;