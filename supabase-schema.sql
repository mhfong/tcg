-- ============================================
-- TCG Market Intelligence - Supabase Schema
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- 1. Master table (source of truth for all cards)
CREATE TABLE IF NOT EXISTS master_table (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tcg_type TEXT NOT NULL CHECK (tcg_type IN ('PTCG', 'OPCG')),
  card_series TEXT NOT NULL,
  card_index TEXT NOT NULL,
  card_name TEXT NOT NULL DEFAULT '',
  card_rarity TEXT NOT NULL,
  url_yuyutei TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tcg_type, card_series, card_index, card_rarity)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON master_table TO authenticated;

-- 2. Price history (populated by scraper)
CREATE TABLE IF NOT EXISTS price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id UUID NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'TAG10', 'RAW_A')),
  price INTEGER NOT NULL,
  buyers_count INTEGER DEFAULT 0,
  scraped_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON price_history TO authenticated;

CREATE INDEX IF NOT EXISTS idx_price_history_card_date ON price_history(card_id, scraped_at DESC);

-- 3. Watchlist (per user)
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, card_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON watchlist TO authenticated;

-- 4. Transactions (per user)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'TAG10', 'RAW_A')),
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  date DATE NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON transactions TO authenticated;

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Master table: readable by all authenticated users
ALTER TABLE master_table ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master table is viewable by authenticated users"
  ON master_table FOR SELECT
  TO authenticated
  USING (true);

-- Price history: readable by all authenticated users
ALTER TABLE price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Price history viewable by authenticated users"
  ON price_history FOR SELECT
  TO authenticated
  USING (true);

-- Watchlist: users can only see/modify their own
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlist"
  ON watchlist FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist"
  ON watchlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist"
  ON watchlist FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Transactions: users can only see/modify their own
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transactions"
  ON transactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================
-- Service role policies for scraper
-- (The scraper uses service_role key, which bypasses RLS)
-- ============================================
