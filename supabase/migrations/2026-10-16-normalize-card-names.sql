-- Normalize card-name punctuation without removing meaningful internal spaces.
UPDATE public.master_table
SET card_name = replace(
  replace(btrim(card_name), '（', '('),
  '）', ')'
)
WHERE card_name IS DISTINCT FROM replace(
  replace(btrim(card_name), '（', '('),
  '）', ')'
);
