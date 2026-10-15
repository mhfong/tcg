-- GOLD-DON cards are identified by card_series and their product slug,
-- not by a card index.
ALTER TABLE public.master_table
  ALTER COLUMN card_index DROP NOT NULL;

UPDATE public.master_table
SET card_index = NULL
WHERE card_rarity = 'GOLD-DON'
  AND card_index IS NOT NULL;

ALTER TABLE public.master_table
  ADD CONSTRAINT master_table_gold_don_card_index_null
  CHECK (card_rarity <> 'GOLD-DON' OR card_index IS NULL);