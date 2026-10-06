# Discover Queue Automation

## Goal

Process all queued SNKRDUNK discovery cards automatically while preserving the existing five-card batch size and workflow timeout.

## Design

The Validation page requests an `enqueue_all` operation instead of sending a truncated list of card IDs. The `discover-trigger` Edge Function pages through every `master_table` row missing `snkrdunk_apparel_id`, deduplicates against all pending queue rows, and inserts the new rows in chunks. Existing explicit `card_ids` requests remain capped at 50 for compatibility.

The discovery workflow continues to claim and process at most five pending rows per run. After the batch completes successfully, a final step queries `discover_queue` for one remaining `pending` row. If one exists, the step dispatches `discover.yml` again through GitHub's `workflow_dispatch` API. If none exists, the run ends without starting another runner.

The workflow receives `actions: write` permission for the dispatch request and retains `contents: read`. The existing concurrency group prevents overlapping discovery workers. Failures before the continuation step, such as dependency installation or queue claiming, do not dispatch another run. The Validation page uses exact count queries for missing cards and each queue status so the UI remains accurate beyond the Supabase 1,000-row response limit.

## Validation

- Run a local YAML/action syntax check when available.
- Confirm the continuation step uses the pending queue state rather than a fixed number of runs.
- Confirm no live workflow is triggered during local validation.