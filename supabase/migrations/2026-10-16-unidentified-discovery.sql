-- Keep successful SNKRDUNK no-match cards visible for manual assignment.
ALTER TABLE public.master_table
  DROP CONSTRAINT IF EXISTS master_table_verify_status_check;

ALTER TABLE public.master_table
  ADD CONSTRAINT master_table_verify_status_check
  CHECK (
    verify_status IS NULL
    OR verify_status IN ('verified', 'rejected', 'unidentified')
  );

-- Backfill cards whose discovery completed without finding an apparel_id.
UPDATE public.master_table AS cards
SET verify_status = 'unidentified'
WHERE cards.snkrdunk_apparel_id IS NULL
  AND cards.verify_status IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.discover_queue AS queue
    WHERE queue.card_id = cards.id
      AND queue.status = 'done'
      AND queue.last_error IS NULL
  );
