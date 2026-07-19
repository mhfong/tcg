// Supabase Edge Function: factory-reset
//
// Deletes all application data while preserving auth.users accounts.
//
// Safety gates:
//   - JWT verification stays ON (deploy without --no-verify-jwt)
//   - request body must include confirmation === "RESET EVERYTHING"
//   - caller email must match FACTORY_RESET_ALLOWED_EMAIL
//   - reset is blocked while discover_queue has rows in status='processing'
//
// Deleted data:
//   - watchlist
//   - transactions
//   - price_history
//   - discover_queue
//   - master_table
//
// Deploy:
//   supabase functions deploy factory-reset

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

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "POST required" }, 405)
  }

  let body: { confirmation?: unknown }
  try {
    body = (await req.json()) as { confirmation?: unknown }
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400)
  }
  if (body.confirmation !== "RESET EVERYTHING") {
    return jsonResponse({ error: 'confirmation must equal "RESET EVERYTHING"' }, 400)
  }

  const url = Deno.env.get("SUPABASE_URL") ?? ""
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""
  const serviceKey = Deno.env.get("SNKRDUNK_DISCOVER_SERVICE_KEY") ?? ""
  const allowedEmail = (Deno.env.get("FACTORY_RESET_ALLOWED_EMAIL") ?? "").trim().toLowerCase()
  if (!url || !anonKey || !serviceKey || !allowedEmail) {
    return jsonResponse({ error: "factory reset secrets are not fully configured" }, 500)
  }

  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader) {
    return jsonResponse({ error: "missing Authorization header" }, 401)
  }

  const caller = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await caller.auth.getUser()
  const email = userData.user?.email?.trim().toLowerCase() ?? ""
  if (userError || !userData.user || !email) {
    return jsonResponse({ error: "authentication required" }, 401)
  }
  if (email !== allowedEmail) {
    return jsonResponse({ error: "factory reset is restricted to the owner account" }, 403)
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  })

  const { count: processingCount, error: processingError } = await admin
    .from("discover_queue")
    .select("id", { head: true, count: "exact" })
    .eq("status", "processing")
  if (processingError) {
    return jsonResponse({ error: processingError.message }, 500)
  }
  if ((processingCount ?? 0) > 0) {
    return jsonResponse(
      {
        error: "Factory reset is blocked while SNKRDUNK discovery is actively processing cards. Wait for the worker to finish and try again.",
      },
      409,
    )
  }

  const deleteAllRows = async (table: string): Promise<string | null> => {
    const { error } = await admin.from(table).delete().not("id", "is", null)
    return error ? `${table}: ${error.message}` : null
  }

  const errors = [
    await deleteAllRows("watchlist"),
    await deleteAllRows("transactions"),
    await deleteAllRows("price_history"),
    await deleteAllRows("discover_queue"),
    await deleteAllRows("master_table"),
  ].filter(Boolean)
  if (errors.length > 0) {
    return jsonResponse({ error: errors.join("; ") }, 500)
  }

  return jsonResponse({ ok: true })
}

serve(handle)
