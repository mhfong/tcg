-- ============================================
-- TCG Cards Library - Seed Data
-- Run this SQL in Supabase SQL Editor AFTER schema
-- ============================================
-- Sources:
--   Card list: yuyu-tei.jp
--   snkrdunk URLs: snkrdunk.com/en/trading-cards/{id}
--
-- Cards with NULL snkrdunk_url need manual ID lookup.
-- To find an ID, search the card on snkrdunk.com and grab the
-- numeric ID from the URL.
-- ============================================

-- ────────────────────────────────────────────
-- PTCG  ·  s12a VSTAR Universe  ·  AR cards
-- ────────────────────────────────────────────
INSERT INTO cards (tcg_type, series, card_number, name_jp, name_en, rarity, snkrdunk_url)
VALUES
  ('PTCG', 's12a', '173/172', 'ヒスイビリリダマ', 'Hisuian Voltorb', 'AR', 'https://snkrdunk.com/en/trading-cards/105555'),
  ('PTCG', 's12a', '174/172', 'コロトック', 'Kricketune', 'AR', 'https://snkrdunk.com/en/trading-cards/105538'),
  ('PTCG', 's12a', '175/172', 'ブーバーン', 'Magmortar', 'AR', 'https://snkrdunk.com/en/trading-cards/105558'),
  ('PTCG', 's12a', '176/172', 'オドリドリ', 'Oricorio', 'AR', NULL),
  ('PTCG', 's12a', '177/172', 'ラプラス', 'Lapras', 'AR', 'https://snkrdunk.com/en/trading-cards/105566'),
  ('PTCG', 's12a', '178/172', 'マナフィ', 'Manaphy', 'AR', NULL),
  ('PTCG', 's12a', '179/172', 'ケルディオ', 'Keldeo', 'AR', 'https://snkrdunk.com/en/trading-cards/105537'),
  ('PTCG', 's12a', '180/172', 'エレキブル', 'Electivire', 'AR', 'https://snkrdunk.com/en/trading-cards/105532'),
  ('PTCG', 's12a', '181/172', 'ストリンダー', 'Toxtricity', 'AR', 'https://snkrdunk.com/en/trading-cards/105542'),
  ('PTCG', 's12a', '182/172', 'ガラルフリーザー', 'Galarian Articuno', 'AR', NULL),
  ('PTCG', 's12a', '183/172', 'ミュウ', 'Mew', 'AR', NULL),
  ('PTCG', 's12a', '184/172', 'ルナトーン', 'Lunatone', 'AR', NULL),
  ('PTCG', 's12a', '185/172', 'デオキシス', 'Deoxys', 'AR', 'https://snkrdunk.com/en/trading-cards/105547'),
  ('PTCG', 's12a', '186/172', 'ディアンシー', 'Diancie', 'AR', NULL),
  ('PTCG', 's12a', '187/172', 'キュワワー', 'Comfey', 'AR', 'https://snkrdunk.com/en/trading-cards/105535'),
  ('PTCG', 's12a', '188/172', 'ガラルサンダー', 'Galarian Zapdos', 'AR', NULL),
  ('PTCG', 's12a', '189/172', 'ソルロック', 'Solrock', 'AR', NULL),
  ('PTCG', 's12a', '190/172', 'ガラルファイヤー', 'Galarian Moltres', 'AR', NULL),
  ('PTCG', 's12a', '191/172', 'アブソル', 'Absol', 'AR', NULL),
  ('PTCG', 's12a', '192/172', 'フォクスライ', 'Thievul', 'AR', 'https://snkrdunk.com/en/trading-cards/105559'),
  ('PTCG', 's12a', '193/172', 'ジバコイル', 'Magnezone', 'AR', 'https://snkrdunk.com/en/trading-cards/105541'),
  ('PTCG', 's12a', '194/172', 'チルタリス', 'Altaria', 'AR', NULL),
  ('PTCG', 's12a', '195/172', 'ラティアス', 'Latias', 'AR', 'https://snkrdunk.com/en/trading-cards/105565'),
  ('PTCG', 's12a', '196/172', 'ヒスイヌメルゴン', 'Hisuian Goodra', 'AR', NULL),
  ('PTCG', 's12a', '197/172', 'メタモン', 'Ditto', 'AR', NULL),
  ('PTCG', 's12a', '198/172', 'ノコッチ', 'Dunsparce', 'AR', 'https://snkrdunk.com/en/trading-cards/103063'),
  ('PTCG', 's12a', '199/172', 'ミルタンク', 'Miltank', 'AR', 'https://snkrdunk.com/en/trading-cards/103064'),
  ('PTCG', 's12a', '200/172', 'ビーダル', 'Bibarel', 'AR', NULL),
  ('PTCG', 's12a', '201/172', 'リオル', 'Riolu', 'AR', 'https://snkrdunk.com/en/trading-cards/105567'),
  ('PTCG', 's12a', '202/172', 'チルット', 'Swablu', 'AR', 'https://snkrdunk.com/en/trading-cards/105545'),
  ('PTCG', 's12a', '203/172', 'ヨマワル', 'Duskull', 'AR', 'https://snkrdunk.com/en/trading-cards/105564'),
  ('PTCG', 's12a', '204/172', 'ビッパ', 'Bidoof', 'AR', 'https://snkrdunk.com/en/trading-cards/105556'),
  ('PTCG', 's12a', '205/172', 'ピカチュウ', 'Pikachu', 'AR', 'https://snkrdunk.com/en/trading-cards/105553'),
  ('PTCG', 's12a', '206/172', 'ナエトル', 'Turtwig', 'AR', 'https://snkrdunk.com/en/trading-cards/105550'),
  ('PTCG', 's12a', '207/172', 'パラス', 'Paras', 'AR', 'https://snkrdunk.com/en/trading-cards/105551'),
  ('PTCG', 's12a', '208/172', 'ポチエナ', 'Poochyena', 'AR', 'https://snkrdunk.com/en/trading-cards/105561'),
  ('PTCG', 's12a', '209/172', 'メリープ', 'Mareep', 'AR', 'https://snkrdunk.com/en/trading-cards/105562')
ON CONFLICT (tcg_type, series, card_number, rarity) DO UPDATE
  SET name_jp      = EXCLUDED.name_jp,
      name_en      = EXCLUDED.name_en,
      snkrdunk_url = COALESCE(EXCLUDED.snkrdunk_url, cards.snkrdunk_url);

-- ────────────────────────────────────────────
-- OPCG  ·  OP01 ROMANCE DAWN  ·  L-P cards
-- ────────────────────────────────────────────
INSERT INTO cards (tcg_type, series, card_number, name_jp, name_en, rarity, snkrdunk_url)
VALUES
  ('OPCG', 'op01', 'OP01-001', 'ロロノア・ゾロ', 'Roronoa Zoro', 'L-P', 'https://snkrdunk.com/en/trading-cards/104428'),
  ('OPCG', 'op01', 'OP01-002', 'トラファルガー・ロー', 'Trafalgar Law', 'L-P', NULL),
  ('OPCG', 'op01', 'OP01-003', 'モンキー・D・ルフィ', 'Monkey D. Luffy', 'L-P', NULL),
  ('OPCG', 'op01', 'OP01-031', '光月おでん', 'Kozuki Oden', 'L-P', NULL),
  ('OPCG', 'op01', 'OP01-060', 'ドンキホーテ・ドフラミンゴ', 'Donquixote Doflamingo', 'L-P', 'https://snkrdunk.com/en/trading-cards/94872'),
  ('OPCG', 'op01', 'OP01-061', 'カイドウ', 'Kaido', 'L-P', 'https://snkrdunk.com/en/trading-cards/94873'),
  ('OPCG', 'op01', 'OP01-062', 'クロコダイル', 'Crocodile', 'L-P', 'https://snkrdunk.com/en/trading-cards/94874'),
  ('OPCG', 'op01', 'OP01-091', 'キング', 'King', 'L-P', 'https://snkrdunk.com/en/trading-cards/94888')
ON CONFLICT (tcg_type, series, card_number, rarity) DO UPDATE
  SET name_jp      = EXCLUDED.name_jp,
      name_en      = EXCLUDED.name_en,
      snkrdunk_url = COALESCE(EXCLUDED.snkrdunk_url, cards.snkrdunk_url);
