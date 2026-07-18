// Supabase Edge Function: discover-trigger
//
// Enqueues one or more card_ids into the discover_queue table so the
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

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405)
  }

  // Parse + validate body. card_ids is required, non-empty array of
  // alphanumeric ids. We cap at 50 per request to keep payloads
  // small (the page usually sends 1-3 at a time).
  let body: { card_ids?: unknown }
  try {
    body = (await req.json()) as { card_ids?: unknown }
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400)
  }
  const raw = Array.isArray(body.card_ids) ? body.card_ids : []
  if (raw.length === 0) {
    return jsonResponse({ error: "card_ids array required" }, 400)
  }
  if (raw.length > 50) {
    return jsonResponse({ error: "too many card_ids (max 50)" }, 400)
  }
  const card_ids = raw.filter(
    (x): x is string => typeof x === "string" && CARD_ID_RE.test(x),
  )
  if (card_ids.length === 0) {
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

  // Build the rows we want to insert. The unique partial index
  // uniq_discover_queue_card_pending (where status='pending')
  // ensures at most one pending row per card. We use a two-step
  // approach to dedupe in JS rather than `upsert onConflict card_id`,
  // because that requires a plain UNIQUE on card_id — we want to
  // keep history (done/failed rows) so a plain UNIQUE won't do.
  const { data: existing, error: exErr } = await sb
    .from("discover_queue")
    .select("card_id")
    .eq("status", "pending")
    .in("card_id", card_ids)
  if (exErr) {
    return jsonResponse({ error: exErr.message }, 500)
  }
  const already = new Set((existing ?? []).map(r => r.card_id))
  const toInsert = card_ids
    .filter(id => !already.has(id))
    .map(card_id => ({ card_id, status: "pending" }))

  let queued = 0
  if (toInsert.length > 0) {
    const { error: insErr } = await sb
      .from("discover_queue")
      .insert(toInsert)
    if (insErr) {
      return jsonResponse({ error: insErr.message }, 500)
    }
    queued = toInsert.length
  }
  const skipped = card_ids.length - queued

  return jsonResponse({ queued, skipped, ids: card_ids })
}

serve(handle)
