-- Migration: switch master_table.id from UUID to deterministic TEXT
--
-- Run this in the Supabase SQL Editor. The table is currently empty,
-- so this is a clean drop-and-recreate. If you have data, see the
-- "with data" section at the bottom for a safer migration.
--
-- 1. Drop dependent tables (their FKs reference master_table.id)
-- 2. Drop master_table
-- 3. Recreate everything with the new TEXT id

BEGIN;

-- Drop in dependency order
DROP TABLE IF EXISTS public.price_history CASCADE;
DROP TABLE IF EXISTS public.transactions CASCADE;
DROP TABLE IF EXISTS public.watchlist CASCADE;
DROP TABLE IF EXISTS public.master_table CASCADE;

-- 1. Master table — id is now TEXT, generated deterministically by the
-- frontend (src/lib/cardId.ts), scraper (scripts/scraper.py), and bulk
-- loader (scripts/bulk_load_cards.py) using the formula:
--   PTCG: 'ptcg' + series + digits(card_index) + lowercase(rarity) + yuyutei_slug
--   OPCG: 'opcg' + alphanum-lowercase(card_index) + letters-only(rarity) + yuyutei_slug
CREATE TABLE IF NOT EXISTS master_table (
  id TEXT PRIMARY KEY,
  tcg_type TEXT NOT NULL CHECK (tcg_type IN ('PTCG', 'OPCG')),
  card_series TEXT NOT NULL,
  card_index TEXT NOT NULL,
  card_name TEXT NOT NULL DEFAULT '',
  card_rarity TEXT NOT NULL,
  url_yuyutei TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON master_table TO authenticated;

-- 2. Price history (FK now TEXT)
CREATE TABLE IF NOT EXISTS price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'TAG10', 'RAW_A')),
  price INTEGER NOT NULL,
  buyers_count INTEGER DEFAULT 0,
  scraped_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON price_history TO authenticated;

CREATE INDEX IF NOT EXISTS idx_price_history_card_date ON price_history(card_id, scraped_at DESC);

-- 3. Watchlist (FK now TEXT)
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, card_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON watchlist TO authenticated;

-- 4. Transactions (FK now TEXT)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'TAG10', 'RAW_A')),
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  date DATE NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO authenticated;

-- Master table: readable and writable by all authenticated users
ALTER TABLE master_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master table is viewable by authenticated users"
  ON master_table FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cards"
  ON master_table FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update cards"
  ON master_table FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete cards"
  ON master_table FOR DELETE
  TO authenticated
  USING (true);

-- Watchlist: per-user
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own watchlist"
  ON watchlist FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own watchlist"
  ON watchlist FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own watchlist"
  ON watchlist FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Transactions: per-user
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Price history: readable by all authenticated users
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Price history viewable by authenticated users"
  ON price_history FOR SELECT TO authenticated USING (true);

COMMIT;

-- After running this, populate master_table with:
--   supabase db query --linked --file scripts/master_table_seed.sql
-- (or paste the contents into the SQL editor)
