// Supabase Edge Function: snkrdunk-meta
//
// Receives an apparel_id from the frontend, fetches the SNKRDUNK
// product page server-side, parses out og:image / og:title / og:site_name
// so the Validation subpage can render the SNKRDUNK product image
// alongside the yuyu-tei front scan.
//
// CORS-safe: the browser cannot directly fetch snkrdunk.com without an
// Access-Control-Allow-Origin header, but Deno's outbound fetch() is not
// subject to that browser-only rule, so this function is the bridge.
//
// Request body (POST application/json):
//   { "apparel_id": "128117" }
//
// Response (200 application/json):
//   { "apparel_id": "128117", "title": "...", "image": "...",
//     "brand": "ONE PIECE", "fetched": true }
//
// On error or fetch failure:
//   { "apparel_id": "128117", "title": "", "image": "",
//     "brand": "", "fetched": false }
//
// Deploy:
//   supabase functions deploy snkrdunk-meta --no-verify-jwt
//
// Local test:
//   curl -X POST http://localhost:54321/functions/v1/snkrdunk-meta \
//     -H "Content-Type: application/json" \
//     -d '{"apparel_id":"128117"}'

// @ts-ignore Deno-only imports
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const ALLOWED_APPAREL_RE = /^\d{4,8}$/
const SNKRDUNK_PAGE = (id: string) => `https://snkrdunk.com/apparels/${id}`
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

function parseOg(html: string, property: string): string {
  // Match both <meta property="og:X" content="..."> and the reverse-attribute form.
  const re = new RegExp(
    `<meta\\s+[^>]*?(?:property|name)=["']og:${property}["'][^>]*?content=["']([^"']+)["']`,
    "i",
  )
  const m = html.match(re)
  return m?.[1] ?? ""
}

async function fetchOgMeta(apparel_id: string): Promise<{
  apparel_id: string
  title: string
  image: string
  brand: string
  fetched: boolean
}> {
  const url = SNKRDUNK_PAGE(apparel_id)
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.9",
      },
      redirect: "follow",
    })
    if (!r.ok) {
      return { apparel_id, title: "", image: "", brand: "", fetched: false }
    }
    const html = await r.text()
    return {
      apparel_id,
      title: parseOg(html, "title"),
      image: parseOg(html, "image"),
      brand: parseOg(html, "site_name"),
      fetched: true,
    }
  } catch {
    return { apparel_id, title: "", image: "", brand: "", fetched: false }
  }
}

async function handle(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Use POST" }, 405)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400)
  }

  const apparel_id = String(body.apparel_id ?? "").trim()
  if (!ALLOWED_APPAREL_RE.test(apparel_id)) {
    return jsonResponse(
      { error: "apparel_id must be 4-8 digits" },
      400,
    )
  }

  const meta = await fetchOgMeta(apparel_id)
  return jsonResponse(meta)
}

// @ts-ignore Deno entrypoint
serve(handle)
