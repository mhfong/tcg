-- ============================================
-- TCG Market Intelligence - Supabase Schema
-- Run this SQL in Supabase SQL Editor
-- ============================================

-- 1. Cards master table (source of truth)
CREATE TABLE IF NOT EXISTS cards (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tcg_type TEXT NOT NULL CHECK (tcg_type IN ('PTCG', 'OPCG')),
  series TEXT NOT NULL,
  card_number TEXT NOT NULL,
  name_jp TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  rarity TEXT NOT NULL,
  snkrdunk_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tcg_type, series, card_number, rarity)
);

-- 2. Price history (populated by scraper)
CREATE TABLE IF NOT EXISTS price_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'TAG10', 'RAW_A')),
  price INTEGER NOT NULL,
  buyers_count INTEGER DEFAULT 0,
  scraped_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_card_date ON price_history(card_id, scraped_at DESC);

-- 3. Watchlist (per user)
CREATE TABLE IF NOT EXISTS watchlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, card_id)
);

-- 4. Transactions (per user)
CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('buy', 'sell')),
  condition TEXT NOT NULL CHECK (condition IN ('PSA10', 'TAG10', 'RAW_A')),
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  date DATE NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Cards: readable by all authenticated users
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cards are viewable by authenticated users"
  ON cards FOR SELECT
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
