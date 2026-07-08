-- One-shot GRANT migration for the SNKRDUNK daily scraper.
--
-- Why: the service_role JWT (used by scripts/scrape_snkrdunk_all.py and
-- .github/workflows/scrape-snkrdunk.yml) needs table-level access. The
-- project's schema only granted the `authenticated` role, so the service_role
-- gets HTTP 42501 when it tries to read or write master_table /
-- price_history. This migration adds the missing GRANTs.
--
-- Safe to re-run (idempotent).
--
-- Apply via one of:
--   1. Supabase dashboard → SQL editor → paste & run
--   2. CLI: supabase db query --linked --file scripts/grant_service_role.sql

GRANT SELECT, INSERT, UPDATE, DELETE ON public.master_table   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.price_history  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.watchlist      TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions   TO service_role;
