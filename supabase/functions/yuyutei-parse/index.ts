// Supabase Edge Function: yuyutei-parse
//
// Receives a yuyu-tei.jp product URL from the frontend, fetches the page,
// and returns structured card fields. The frontend then asks the user to
// confirm before inserting into the cards table.
//
// Deploy:
//   supabase functions deploy yuyutei-parse --no-verify-jwt
// (--no-verify-jwt is optional; if you keep auth on, the frontend must
//  send the user's bearer token via Authorization header)
//
// Local test:
//   curl -X POST http://localhost:54321/functions/v1/yuyutei-parse \
//     -H "Content-Type: application/json" \
//     -d '{"url":"https://yuyu-tei.jp/sell/poc/card/s12a/10262"}'

// @ts-ignore Deno-only imports
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"

const ALLOWED_HOST = "yuyu-tei.jp"

const TCG_FROM_PATH: Record<string, string> = { poc: "PTCG", opc: "OPCG" }
const IMAGE_TCG: Record<string, string> = { PTCG: "poc", OPCG: "opc" }

function parsePathMeta(rawUrl: string): { tcg_type: string; series: string; slug_id: string } | null {
  let u: URL
  try { u = new URL(rawUrl) } catch { return null }
  if (!u.hostname.endsWith(ALLOWED_HOST)) return null

  const parts = u.pathname.split("/").filter(Boolean)
  if (parts.length < 5 || parts[0] !== "sell" || parts[2] !== "card") return null

  const tcg_type = TCG_FROM_PATH[parts[1].toLowerCase()]
  if (!tcg_type) return null
  return { tcg_type, series: parts[3].toLowerCase(), slug_id: parts[4] }
}

async function parseYuyuteiCard(url: string): Promise<Record<string, string>> {
  const meta = parsePathMeta(url)
  if (!meta) throw new Error(`Invalid yuyu-tei URL: ${url}`)

  const r = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      "Accept-Language": "ja,en;q=0.9",
    },
    redirect: "follow",
  })
  if (!r.ok) throw new Error(`Fetch failed: HTTP ${r.status}`)
  const html = await r.text()

  // 1. <title> → e.g.
  //   PTCG: "AR ヒスイビリリダマ | 販売 | [S12a] ハイクラスパック ... | ポケモンカードゲーム"
  //   OPCG: "P-SEC モンキー・D・ルフィ(パラレル) | 販売 | [OP15]神の島の冒険 | ONE PIECEカードゲーム"
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
  let title = titleMatch?.[1].trim() ?? ""
  title = title.replace(/\s*\|\s*(ポケモンカードゲーム|ONE PIECE.*|ワンピース.*)\s*$/i, "")
  let head = (title.split("|")[0] ?? "").trim()
  // Strip trailing 販売 / 買取 verb
  head = head.replace(/\s+(販売|買取)\s*$/, "")
  // Strip ALL trailing parenthetical qualifiers (loop handles
  //   "name(foo)(bar)" → "name" and "ドン!!カード(x)(パラレル)(スーパーパラレル)" → "ドン!!カード(x)")
  while (/\s*\([^)]*\)\s*$/.test(head)) {
    head = head.replace(/\s*\([^)]*\)\s*$/, "")
  }
  const headTokens = head.split(/\s+/, 2)
  let rarity = headTokens[0] ?? ""
  let name_jp = headTokens[1] ?? ""
  // Special case: yuyu-tei uses "-" as the rarity placeholder for
  // ドン!! cards (which actually have GOLD-DON rarity).
  if (name_jp.startsWith("ドン!!カード") && rarity === "-") {
    rarity = "GOLD-DON"
  }

  // 2. Series from bracket in title
  const seriesMatch = title.match(/\[([A-Za-z0-9]+)\]/)
  const series = (seriesMatch?.[1] ?? meta.series).toLowerCase()

  // 3. Card number — multiple strategies, most-precise first
  const card_number = extractCardNumber(html, meta.tcg_type)

  // 4. Image URL — predictable CDN path
  const image_tcg = IMAGE_TCG[meta.tcg_type] ?? "poc"
  const image_url = `https://card.yuyu-tei.jp/${image_tcg}/front/${series}/${meta.slug_id}.jpg`

  return {
    tcg_type: meta.tcg_type,
    series,
    card_number,
    name_jp,
    rarity,
    yuyutei_url: url,
    image_url,
  }
}

function extractCardNumber(html: string, tcgType: string): string {
  // 1. JSON-LD description — cleanest source
  const desc = html.match(/"description"\s*:\s*"([A-Z]{0,3}\d{0,3}[-/]\d{1,4}[A-Za-z0-9]*)"/)
  if (desc) return desc[1].replace(/\s+/g, "")

  // 2. og:description meta tag
  const og = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  )
  if (og) {
    const t = og[1].match(/[A-Z]{0,3}\d{0,3}[-/]\d{1,4}/)
    if (t) return t[0]
  }

  // 3. Pattern by TCG
  if (tcgType === "OPCG") {
    const m = html.match(/\b(OP\d+[-/]\d{1,4})\b/)
    if (m) return m[1].replace("/", "-")
  }
  // PTCG fallback (slash form). Leading word boundary prevents matching
  // `op15/10146.jpg` from the og:image URL.
  const slash = html.match(/\b(\d{1,4}\/\d{1,4})\b/)
  if (slash) return slash[1]

  return ""
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    })
  }

  if (req.method !== "POST") {
    return json({ error: "Use POST" }, 405)
  }

  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: "Invalid JSON body" }, 400)
  }

  const url = (body.url ?? "").trim()
  if (!url) return json({ error: "Missing 'url' field" }, 400)

  try {
    const card = await parseYuyuteiCard(url)
    return json(card)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return json({ error: msg }, 500)
  }
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  })
}
