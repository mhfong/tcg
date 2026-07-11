# Auto-discover SNKRDUNK apparel_ids for new cards

When a new row is added to `master_table`, this pipeline automatically
discovers the matching SNKRDUNK `apparel_id` (the 5-digit number in
`https://snkrdunk.com/apparels/<apparel_id>/...`) and writes it back
to `master_table.snkr_dunk_apparel_id`.

## Flow

```
INSERT INTO master_table (snkrdunk_apparel_id IS NULL)
       │
       ▼
Supabase Database Webhook
  (filter: snkrdunk_apparel_id=is.null, event: INSERT)
       │
       ▼
Supabase Edge Function  (supabase/functions/snkrdunk-dispatch)
  • receives the row payload
  • extracts master_id
  • POSTs to GitHub repository_dispatch
       │
       ▼
GitHub Actions workflow  (.github/workflows/snkrdunk-discover-on-new-card.yml)
  • checkout repo
  • install python deps + Playwright + Chromium
  • runs:  python scripts/discover_snkrdunk_ids.py --only-this <master_id> --apply
  • commits the updated data/master_snkrdunk.csv
       │
       ▼
master_table.snkr_dunk_apparel_id is now set in Supabase
```

## One-time setup

You need to do this **once** to make the automation work.

### 1. Deploy the Supabase Edge Function

```bash
supabase functions deploy snkrdunk-dispatch --no-verify-jwt
```

Output: `Function URL: https://<project_ref>.supabase.co/functions/v1/snkrdunk-dispatch`

### 2. Set the GitHub PAT as a Supabase secret

1. Create a Fine-grained PAT at https://github.com/settings/tokens
   - Resource owner: mhfong
   - Repository access: only `tcg`
   - Permissions: **Actions: Write**
2. Set it as a Supabase secret:

```bash
supabase secrets set GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxxxxxx
```

### 3. (Optional) Set the SNKRDUNK sessionid for full automation

If you skip this, the workflow runs in **guided mode** and only
writes a clickable search URL to the CSV. With it, the workflow
fully automates the discovery.

1. Log in to https://snkrdunk.com in your browser
2. DevTools → Application → Cookies → snkrdunk.com → copy `sessionid`
3. Add it as a GitHub secret: `gh secret set SNKRDUNK_SESSION_ID --repo mhfong/tcg`
   (Note: stored in GitHub, not Supabase, because the GitHub Actions
    workflow uses it directly.)

### 4. Create the Supabase Database Webhook

```bash
export SUPABASE_PROJECT_REF=uimoiutektarmjeoubem
export SUPABASE_ACCESS_TOKEN=sbp_...     # Supabase dashboard / settings / API
python scripts/setup_snkrdunk_webhook.py
```

The script will:
- list any existing webhook with the same name (skip if already exists)
- prompt you to confirm
- POST to the Supabase Management API to create the webhook
  - Name: `new-card-snkrdunk-discover`
  - Table: `master_table`
  - Event: `INSERT`
  - Filter: `snkrdunk_apparel_id=is.null` (don't re-fire for already-mapped cards)
  - URL: the Edge Function URL from step 1

Re-run is safe. To delete and recreate:

```bash
python scripts/setup_snkrdunk_webhook.py --list
python scripts/setup_snkrdunk_webhook.py --delete <id>
python scripts/setup_snkrdunk_webhook.py   # recreate
```

### 5. Test the end-to-end flow

```bash
# Trigger a test repository_dispatch (no DB insert)
python scripts/setup_snkrdunk_webhook.py --test-dispatch

# Or insert a real row and watch the GitHub Action start
gh run watch
```

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Edge Function returns 500 with "GITHUB_TOKEN not set" | Supabase secret missing | `supabase secrets set GITHUB_TOKEN=...` |
| GitHub Action fails with 401 | Token doesn't have Actions: Write on mhfong/tcg | Re-create the PAT with the right scope |
| Webhook never fires | Filter `snkrdunk_apparel_id=is.null` doesn't match | Check the inserted row has `snkrdunk_apparel_id = NULL` |
| Workflow runs but finds no match | SNKRDUNK search needs the `SNKRDUNK_SESSION_ID` secret | Add it as a GitHub secret (step 3) |
| Edge Function times out | Cold start can take a few seconds on first invocation | Re-run the workflow; subsequent runs are fast |

## Why this design

- **No polling**: the trigger fires within ~2 seconds of the row insert
- **Idempotent**: the Supabase webhook's row filter prevents re-firing for
  cards that already have a snkrdunk_apparel_id, and the daily cron
  also skips them
- **No Playwright in the Edge Function**: we just translate a webhook
  payload into a GitHub repository_dispatch event. Playwright runs
  in the GitHub Action where it has full system access
- **Single source of truth for discovery logic**: `discover_snkrdunk_ids.py`
  is run by both the cron (bulk) and the workflow (single card). No
  duplicate logic
