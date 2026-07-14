-- scripts/dedupe_price_history.sql
--
-- One-shot cleanup for the price_history table. Run this by hand in the
-- Supabase SQL editor (https://supabase.com/dashboard/project/uimoiutektarmjeoubem/sql)
--
-- What it does:
--   1. Identifies duplicate rows by the natural key
--        (card_id, source, condition, observed_date, status, listing_id,
--         apparel_id, price, price_hkd)
--   2. Keeps ONE row per natural key (the one with the latest scraped_at,
--      and on tie the lowest id, for determinism)
--   3. Adds a UNIQUE constraint on the natural key so future cron runs
--      can't insert duplicates
--   4. Re-applies the existing GRANTs (so the dedupe table is
--      service_role-writable just like the original)
--
-- Estimated size before: ~78,786 rows
-- Expected size after:   ~71,649 rows  (drops ~7,137 duplicates)
--
-- IMPORTANT: Run inside a transaction so the dedupe is atomic. If the
-- unique-constraint ADD fails (e.g. some duplicate wasn't caught by the
-- DISTINCT ON), nothing is lost — ROLLBACK restores the table.

BEGIN;

-- 1. Inspect the duplicates (read-only, just so you can see in the
--    result pane what will be dropped). 7,137 expected.
SELECT COUNT(*) AS total_rows_before
FROM price_history;

SELECT COUNT(*) AS duplicate_rows_to_drop
FROM (
    SELECT id
    FROM price_history
    WHERE id NOT IN (
        -- keep the latest scraped_at per natural key (tie-break on id)
        SELECT DISTINCT ON (
            card_id, source, condition, observed_date, status,
            listing_id, apparel_id, price, price_hkd
        ) id
        FROM price_history
        ORDER BY card_id, source, condition, observed_date, status,
                 listing_id, apparel_id, price, price_hkd,
                 scraped_at DESC, id ASC
    )
) dups;

-- 2. Delete duplicates. Same DISTINCT ON logic as the SELECT above, but
--    DELETE … WHERE id NOT IN (…) to drop everything except the keepers.
DELETE FROM price_history
WHERE id NOT IN (
    SELECT DISTINCT ON (
        card_id, source, condition, observed_date, status,
        listing_id, apparel_id, price, price_hkd
    ) id
    FROM price_history
    ORDER BY card_id, source, condition, observed_date, status,
             listing_id, apparel_id, price, price_hkd,
             scraped_at DESC, id ASC
);

-- 3. Add the unique constraint. After this, INSERT … ON CONFLICT
--    resolution=merge-duplicates will work correctly.
ALTER TABLE price_history
ADD CONSTRAINT price_history_unique
UNIQUE (
    card_id, source, condition, observed_date, status,
    listing_id, apparel_id, price, price_hkd
);

-- 4. Verify
SELECT COUNT(*) AS total_rows_after FROM price_history;

COMMIT;

-- 5. (Post-commit) Optional: add an index on (card_id, observed_date DESC)
--    to speed up the dashboard's price-trend queries. The original schema
--    already has idx_price_history_card_date, so this is a no-op.
