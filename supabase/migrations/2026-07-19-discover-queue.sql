-- Migration: add discover_queue table
--
-- Background: scripts/discover_snkrdunk_apparel_ids.py is a Python
-- scraper that uses Playwright + Pillow to find SNKRDUNK apparel_ids
-- for cards in master_table. It's too heavy to run inside a Deno
-- Edge Function (Playwright doesn't work in the sandbox, Pillow is
-- Python-only), so we trigger it via a queue + GitHub Actions cron:
--
--   1) The browser (Validation page) POSTs to the discover-trigger
--      Edge Function whenever it detects a card with no
--      snkrdunk_apparel_id. That function inserts a row here.
--   2) The .github/workflows/discover.yml workflow polls this table
--      every few minutes, picks up 'pending' rows, runs the Python
--      script with --only-this <id> --apply, and marks rows 'done'
--      or 'failed' with the error captured.
--   3) The next page-load re-fetches the rows; the discover script
--      has populated snkrdunk_apparel_id by then, so the card
--      appears in the validation queue.
--
-- Status state machine:
--   pending      → worker hasn't picked it up yet
--   processing   → worker has claimed it (worker_id set, attempts++)
--   done         → script ran successfully (or no match found; either
--                  way, snkrdunk_apparel_id is now populated on the row
--                  or the script reached its end without a hit)
--   failed       → script errored; last_error populated; attempts++

CREATE TABLE IF NOT EXISTS discover_queue (
  id                BIGSERIAL PRIMARY KEY,
  card_id           TEXT        NOT NULL REFERENCES master_table(id) ON DELETE CASCADE,
  status            TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','processing','done','failed')),
  attempts          INTEGER     NOT NULL DEFAULT 0,
  last_error        TEXT,
  last_attempted_at TIMESTAMPTZ,
  worker_id         TEXT,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- One pending row per card at a time. If the user clicks "discover"
-- again on a card that's already pending, this is a no-op (ON
-- CONFLICT DO NOTHING) rather than spawning duplicate workers.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_discover_queue_card_pending
  ON discover_queue(card_id)
  WHERE status = 'pending';

-- Hot path: worker queries WHERE status IN ('pending','processing')
-- ORDER BY requested_at ASC LIMIT N. Partial index keeps the scan
-- cheap as completed/failed rows accumulate.
CREATE INDEX IF NOT EXISTS idx_discover_queue_status_requested
  ON discover_queue(status, requested_at)
  WHERE status IN ('pending', 'processing');

-- RLS: the browser uses the anon key (RLS-aware). The Edge Function
-- and GitHub Actions worker use the service role (RLS-bypass).
ALTER TABLE discover_queue ENABLE ROW LEVEL SECURITY;

-- Authenticated users (the browser, via the anon key on the
-- frontend) can insert pending rows and read all queue rows so the
-- Validation page can show "discovering" status.
DROP POLICY IF EXISTS disq_insert_authenticated ON discover_queue;
CREATE POLICY disq_insert_authenticated ON discover_queue
  FOR INSERT TO authenticated
  WITH CHECK (status = 'pending');

DROP POLICY IF EXISTS disq_select_authenticated ON discover_queue;
CREATE POLICY disq_select_authenticated ON discover_queue
  FOR SELECT TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON discover_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON discover_queue TO service_role;
GRANT USAGE, SELECT ON SEQUENCE discover_queue_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE discover_queue_id_seq TO service_role;
