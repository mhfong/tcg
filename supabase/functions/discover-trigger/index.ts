// Supabase Edge Function: discover-trigger
//
// Enqueues one or more card_ids, or all cards missing an apparel_id, into the discover_queue table so the
// scripts/discover_snkrdunk_apparel_ids.py worker (driven by the
// .github/workflows/discover.yml cron) can pick them up and look up
// their SNKRDUNK apparel_ids.
//
// Why an Edge Function rather than direct Supabase client writes?
//   - The browser-side validation page is what knows when a new
//     card has no snkrdunk_apparel_id. Calling this function is the
//     signal that says "please discover apparel_id for these rows".
//   - The Edge Function runs with the service role key so it can
//     write to discover_queue rows even with RLS enabled.
//   - The Edge Function uses ON CONFLICT DO NOTHING (via the unique
//     partial index on status='pending') to avoid creating duplicate
//     queue rows when the user clicks "discover" twice.
//
// Request body (POST application/json):
//   { "card_ids": ["opcgst01st21014sr10099", "ptcgsv02a201165sar10507"] }
//   { "enqueue_all": true }
//
// Response (200):
//   { "queued": 2, "skipped": 0, "ids": [...] }
//
//   `queued`  — number of NEW pending rows inserted
//   `skipped` — number of card_ids that already had a pending row
//   `ids`     — the input list (echoed back)
//
// Deploy:
//   supabase functions deploy discover-trigger --no-verify-jwt
//
// Local test:
//   curl -X POST http://localhost:54321/functions/v1/discover-trigger \
//     -H "Content-Type: application/json" \
//     -d '{"card_ids":["opcgst01st21014sr10099"]}'

// @ts-ignore Deno-only imports
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
// @ts-ignore Deno-only imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  })
}

const CARD_ID_RE = /^[a-z0-9]+$/i
const PAGE_SIZE = 1000
const INSERT_CHUNK_SIZE = 500

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405)
  }

  // Parse + validate body. Explicit card_ids requests remain capped at
  // 50; the enqueue_all mode reads IDs server-side in pages instead of
  // sending a large list through the browser.
  let body: { card_ids?: unknown; enqueue_all?: unknown }
  try {
    body = (await req.json()) as {
      card_ids?: unknown
      enqueue_all?: unknown
    }
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400)
  }
  const enqueueAll = body.enqueue_all === true
  const raw = Array.isArray(body.card_ids) ? body.card_ids : []
  if (!enqueueAll && raw.length === 0) {
    return jsonResponse({ error: "card_ids array required" }, 400)
  }
  if (!enqueueAll && raw.length > 50) {
    return jsonResponse({ error: "too many card_ids (max 50)" }, 400)
  }
  let card_ids = raw.filter(
    (x): x is string => typeof x === "string" && CARD_ID_RE.test(x),
  )
  if (!enqueueAll && card_ids.length === 0) {
    return jsonResponse(
      { error: "no valid card_ids (expected alphanumeric)" },
      400,
    )
  }

  // Service-role Supabase client. The Edge Function is deployed with
  // --no-verify-jwt and the service role key is set as a Supabase
  // secret. Note: Supabase reserves the SUPABASE_* env namespace for
  // its own runtime config, so we use the SNKRDUNK_DISCOVER_SERVICE_KEY
  // name to avoid the CLI rejecting our secrets set call.
  const url = Deno.env.get("SUPABASE_URL") ?? ""
  const serviceKey = Deno.env.get("SNKRDUNK_DISCOVER_SERVICE_KEY") ?? ""
  if (!url || !serviceKey) {
    return jsonResponse(
      { error: "SUPABASE_URL / SNKRDUNK_DISCOVER_SERVICE_KEY not set" },
      500,
    )
  }
  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false },
  })

  if (enqueueAll) {
    const missingIds: string[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await sb
        .from("master_table")
        .select("id")
        .is("snkrdunk_apparel_id", null)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) {
        return jsonResponse({ error: error.message }, 500)
      }
      missingIds.push(...(data ?? []).map(row => row.id))
      if (!data || data.length < PAGE_SIZE) break
    }
    card_ids = missingIds.filter(id => CARD_ID_RE.test(id))
  }

  card_ids = [...new Set(card_ids)]
  if (card_ids.length === 0) {
    return jsonResponse({
      queued: 0,
      skipped: 0,
      ids: [],
      enqueue_all: enqueueAll,
      dispatched: false,
      dispatch_error: "no cards need SNKRDUNK discovery",
    })
  }

  // Build the rows we want to insert. The unique partial index
  // uniq_discover_queue_card_pending (where status='pending')
  // ensures at most one pending row per card. We use a two-step
  // approach to dedupe in JS rather than `upsert onConflict card_id`,
  // because that requires a plain UNIQUE on card_id — we want to
  // keep history (done/failed rows) so a plain UNIQUE won't do.
  const already = new Set<string>()
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await sb
      .from("discover_queue")
      .select("card_id")
      .eq("status", "pending")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      return jsonResponse({ error: error.message }, 500)
    }
    for (const row of data ?? []) already.add(row.card_id)
    if (!data || data.length < PAGE_SIZE) break
  }
  const toInsert = card_ids
    .filter(id => !already.has(id))
    .map(card_id => ({ card_id, status: "pending" }))

  let queued = 0
  for (let offset = 0; offset < toInsert.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = toInsert.slice(offset, offset + INSERT_CHUNK_SIZE)
    const { error: insErr } = await sb
      .from("discover_queue")
      .insert(chunk)
    if (insErr) {
      return jsonResponse({ error: insErr.message }, 500)
    }
    queued += chunk.length
  }
  const skipped = card_ids.length - queued

  // After enqueueing, kick the GitHub Actions worker via the
  // workflow_dispatch API. The worker used to run on a `*/5 * * * *`
  // cron, but that was eating the free-tier minutes quota. We now
  // trigger it on demand from here so each enqueue pays the runner
  // spin-up cost only when there's actually work to do.
  //
  // Only dispatch when we actually inserted NEW rows. If every
  // card_id was already pending (skipped > 0, queued == 0) the
  // worker is either already running on them or has already
  // finished them — no need to kick off another run. This prevents
  // the burst of duplicate dispatches that happens when the page
  // auto-triggers across multiple mounts/polls.
  //
  // We do this *after* the DB write so that if GitHub dispatch
  // fails the rows are still safely queued (the user can retry
  // from the page; the unique partial index dedupes).
  const ghToken = Deno.env.get("GH_DISPATCH_TOKEN") ?? ""
  let dispatched = false
  let dispatchError: string | null = null
  if (ghToken && queued > 0) {
    try {
      const r = await fetch(
        "https://api.github.com/repos/mhfong/tcg/actions/workflows/discover.yml/dispatches",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ref: "main" }),
        },
      )
      // GitHub returns 204 No Content on success.
      dispatched = r.status === 204
      if (!dispatched) {
        dispatchError = `github dispatch returned ${r.status}`
      }
    } catch (e) {
      dispatchError = e instanceof Error ? e.message : String(e)
    }
  } else if (!ghToken) {
    dispatchError = "GH_DISPATCH_TOKEN not configured"
  } else {
    // queued === 0; skipped > 0. No new work to dispatch.
    dispatchError = "skipped (already pending)"
  }

  return jsonResponse({
    queued,
    skipped,
    ids: enqueueAll ? [] : card_ids,
    enqueue_all: enqueueAll,
    dispatched,
    dispatch_error: dispatchError,
  })
}

serve(handle)
