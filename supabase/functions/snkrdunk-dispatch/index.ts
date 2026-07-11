// Supabase Edge Function: relay a Database Webhook to GitHub.
//
// Flow:
//   1. master_table INSERT (where snkrdunk_apparel_id IS NULL)
//   2. Supabase Database Webhook POSTs the row payload to this function
//   3. We extract the new card's master_id and POST a repository_dispatch
//      event to GitHub
//   4. GitHub Actions workflow `.github/workflows/snkrdunk-discover-on-new-card.yml`
//      wakes up and runs `python scripts/discover_snkrdunk_ids.py`
//
// This is just a thin relay. The discovery logic lives in the Python
// script (and the existing daily scraper workflow). Keeping the heavy
// work in GitHub Actions means we don't have to bundle Playwright or
// the rest of the scraper stack in Deno.
//
// Deploy:
//   supabase functions deploy snkrdunk-dispatch --no-verify-jwt
//
// Required secrets (set via `supabase secrets set`):
//   GITHUB_TOKEN       Fine-grained PAT, Actions: Write on mhfong/tcg
//   GITHUB_REPO        "mhfong/tcg"  (default, can override)

interface SupabaseWebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

const GITHUB_REPO = Deno.env.get("GITHUB_REPO") || "mhfong/tcg";

Deno.serve(async (req) => {
  // CORS preflight (Supabase webhooks don't send OPTIONS, but be defensive)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const token = Deno.env.get("GITHUB_TOKEN");
  if (!token) {
    return jsonResponse(
      { error: "GITHUB_TOKEN secret not set" },
      500,
    );
  }

  let payload: SupabaseWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON" }, 400);
  }

  if (payload.type !== "INSERT" || payload.table !== "master_table") {
    // Database Webhook can fire for UPDATE/DELETE; we only care about
    // INSERTs on master_table. Other tables are ignored.
    return jsonResponse({ ignored: true, reason: "not an INSERT on master_table" });
  }

  const cardId = payload.record?.id as string | undefined;
  if (!cardId) {
    return jsonResponse({ error: "no record.id in payload" }, 400);
  }

  // Filter again here, in case the Database Webhook row_count filter
  // didn't catch it (defence in depth).
  if (payload.record?.snkrdunk_apparel_id) {
    return jsonResponse({ ignored: true, reason: "already has snkrdunk_apparel_id" });
  }

  // Trigger the GitHub Actions workflow via repository_dispatch.
  const ghResp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "supabase-edge-function/snkrdunk-dispatch",
      },
      body: JSON.stringify({
        event_type: "new-card",
        client_payload: {
          master_id: cardId,
          source: "supabase-webhook",
        },
      }),
    },
  );

  if (!ghResp.ok) {
    const text = await ghResp.text();
    return jsonResponse(
      { error: `GitHub API returned ${ghResp.status}`, body: text },
      502,
    );
  }

  return jsonResponse({
    ok: true,
    master_id: cardId,
    github_status: ghResp.status,
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
