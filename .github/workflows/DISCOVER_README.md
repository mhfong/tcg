# Auto-discovery: how new cards get a SNKRDUNK apparel_id

When you add a card to `master_table` without a `snkrdunk_apparel_id`,
the Validation page automatically enqueues it for discovery the next
time you load the page. The GitHub Actions cron worker picks it up
within 5 minutes and runs `scripts/discover_snkrdunk_apparel_ids.py`
on it. The card then appears in the Unverified tab.

## Data flow

```
Browser (Validation page)
  │ load() finds pending rows
  │ ↓ auto-enqueue via discover-trigger Edge Function
  ▼
Supabase `discover_queue` table  ── queued rows
  │
  │ polled every 5 min
  ▼
GitHub Actions workflow (.github/workflows/discover.yml)
  │ for each pending row, run:
  │   python scripts/discover_snkrdunk_apparel_ids.py \
  │     --only-this <card_id> --apply
  │ ↓ writes snkrdunk_apparel_id back to master_table
  ▼
Next page refresh → card now in Unverified tab
```

## Required GitHub Actions secrets

The `.github/workflows/discover.yml` workflow needs two secrets
configured in **Settings → Secrets and variables → Actions**:

| Secret | Where to find it |
|---|---|
| `SUPABASE_URL` | Same as `VITE_SUPABASE_URL` in `.env`: `https://uimoiutektarmjeoubem.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as `SUPABASE_SERVICE_ROLE_KEY` in `secret.py` |

Without these, the workflow will fail at the "Claim pending rows"
step.

## Supabase Edge Function secrets

The `discover-trigger` Edge Function reads `SNKRDUNK_DISCOVER_SERVICE_KEY`
(which holds the service role key, with a non-reserved name because
Supabase's CLI blocks `SUPABASE_*` secret names).

If the function ever loses its secret, re-run:

```bash
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY secret.py | cut -d= -f2- | tr -d "'\"")
supabase secrets set SNKRDUNK_DISCOVER_SERVICE_KEY="$SERVICE_KEY" \
  --project-ref uimoiutektarmjeoubem
```

## Migration

The migration `supabase/migrations/2026-07-19-discover-queue.sql`
creates the queue table. It has already been applied to the linked
project. To re-apply on a fresh project:

```bash
export SUPABASE_ACCESS_TOKEN=$(grep SUPABASE_ACCESS_TOKEN .env | cut -d= -f2-)
supabase db query --linked --file supabase/migrations/2026-07-19-discover-queue.sql
```

## Manual triggering

If you need to run discover immediately (not wait for the cron):

1. Open **Actions → Discover SNKRDUNK apparel_ids** in the GitHub UI.
2. Click **Run workflow** → **Run workflow**.

The worker will claim all pending rows and run the discover script
on them in sequence.
