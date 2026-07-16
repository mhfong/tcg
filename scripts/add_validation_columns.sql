-- scripts/add_validation_columns.sql
--
-- Run by hand in the Supabase SQL editor.
--   https://supabase.com/dashboard/project/uimoiutektarmjeoubem/sql
--
-- Idempotent. Adds two columns to master_table for the Validation
-- subpage on the Database route:
--
--   verified_at     TIMESTAMPTZ NULL  -- when the human clicked "Confirm"
--   verify_status   TEXT NULL         -- 'verified' or 'rejected'

ALTER TABLE master_table
  ADD COLUMN IF NOT EXISTS verified_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS verify_status TEXT NULL
    CHECK (verify_status IS NULL OR verify_status IN ('verified', 'rejected'));

-- Index for the validation queue query:
--   WHERE snkrdunk_apparel_id IS NOT NULL AND verify_status IS NULL
CREATE INDEX IF NOT EXISTS idx_master_table_verify_queue
  ON master_table (snkrdunk_apparel_id)
  WHERE snkrdunk_apparel_id IS NOT NULL AND verify_status IS NULL;

-- Re-apply the role grants so the new columns are accessible to the
-- service_role key used by scripts and the existing service clients.
GRANT SELECT, INSERT, UPDATE, DELETE ON master_table TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON master_table TO authenticated;
