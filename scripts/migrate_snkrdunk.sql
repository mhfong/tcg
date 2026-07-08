-- One-shot migration for SNKRDUNK daily scraper.
--
-- Run this in the Supabase SQL editor (or `supabase db query --linked --file
-- scripts/migrate_snkrdunk.sql`) BEFORE running the dry-run orchestrator.
--
-- Adds:
--   1. master_table.snkr_dunk_apparel_id column (cached SNKRDUNK product id)
--   2. New price_history table (overwrites the existing one)
--   3. Missing GRANTs to service_role (required for the scraper)
--
-- Safe to re-run (all statements are IF NOT EXISTS / additive).

-- 1. Add the new column on master_table
ALTER TABLE public.master_table
  ADD COLUMN IF NOT EXISTS snkrdunk_apparel_id TEXT;

-- 2. Overwrite the price_history table with the new shape
DROP TABLE IF EXISTS public.price_history CASCADE;

CREATE TABLE public.price_history (
  id            UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id       TEXT         NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  source        TEXT         NOT NULL CHECK (source IN ('jp', 'en')),
  condition     TEXT         NOT NULL CHECK (condition IN ('PSA10', 'RAW_A')),
  observed_date DATE         NOT NULL,
  price         INTEGER      NULL,
  price_hkd     INTEGER      NULL,
  status        TEXT         NOT NULL CHECK (status IN ('sold', 'listed')),
  listing_id    TEXT         NULL,
  apparel_id    TEXT         NULL,
  scraped_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_card_date
  ON price_history(card_id, observed_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_apparel_date
  ON price_history(apparel_id, observed_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_card_condition_date
  ON price_history(card_id, condition, observed_date DESC);

-- 3. Re-create RLS policies (DROP TABLE CASCADE removed them)
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Price history viewable by authenticated users"
  ON price_history FOR SELECT
  TO authenticated
  USING (true);

-- 4. GRANTs (re-apply in case DROP TABLE CASCADE removed them)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_table  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions   TO service_role;
