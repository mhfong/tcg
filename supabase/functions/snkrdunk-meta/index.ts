// Supabase Edge Function: snkrdunk-meta
//
// Receives an apparel_id from the frontend, fetches the SNKRDUNK
// product page server-side, and parses the product title + image
// so the Validation subpage can render the SNKRDUNK product scan
// alongside the yuyu-tei front scan.
//
// CORS-safe: the browser cannot directly fetch snkrdunk.com without an
// Access-Control-Allow-Origin header, but Deno's outbound fetch() is not
// subject to that browser-only rule, so this function is the bridge.
//
// Image resolution order (parseProductImage below):
//   1. <img class="…__mainImage…" src="…"> — the actual product scan.
//      Promoted to ?size=l for the largest available variant.
//   2. Any cdn.snkrdunk.com/upload_bg_removed/<id>.webp URL on the page.
//   3. og:image (fallback for non-card products like sneakers).
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
  // GET is required because the <img> tag issues a plain GET. Without
  // it the browser preflight blocks the image. HEAD is allowed so
  // health checks (curl -I) and CDN probes work.
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
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

/**
 * Pick the product's front-scan image out of a SNKRDUNK page.
 *
 * snkrdunk.com sets `og:image` to its brand OGP collage, NOT to the
 * product photo, so we have to find the product image another way.
 *
 * The product page renders the actual card scan inside an `<img>`
 * whose CSS-module class is `__mainImage` (loader-class hash, but
 * the `__mainImage` suffix is stable across the site). It always
 * comes from `cdn.snkrdunk.com/upload_bg_removed/<id>.webp` and
 * supports a `?size=l|m|s` query to control dimensions.
 *
 * As a final fallback we use `og:image` (which works for non-card
 * products like sneakers, where the upload_bg_removed mainImage
 * path doesn't apply).
 */
function parseProductImage(html: string): string {
  // 1. Main product image — best signal. Match any <img … class="…__mainImage…" …>
  //    and pull its src. We allow any attribute order by looking for the
  //    class containing "mainImage" and then capture the src of the same tag.
  const mainImgRe = /<img\b[^>]*\bclass=["'][^"']*mainImage[^"']*["'][^>]*\bsrc=["']([^"']+)["']/i
  const mainImgRev = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*\bclass=["'][^"']*mainImage[^"']*["']/i
  let m = html.match(mainImgRe) ?? html.match(mainImgRev)
  if (m) {
    // Up-convert to the largest available size (~3-4× bigger payload).
    return m[1].replace(/\?size=[a-z]+$/i, "?size=l")
  }
  // 2. Any upload_bg_removed image URL on the page (still typically a card
  //    scan). Pick the largest.
  const allBg = [
    ...html.matchAll(
      /(?:https?:)?\/\/cdn\.snkrdunk\.com\/upload_bg_removed\/[A-Za-z0-9_-]+\.webp(?:\?size=[a-z]+)?/g,
    ),
  ].map(x => x[0])
  if (allBg.length > 0) {
    // Prefer the longest / most likely to be the largest. Promote to size=l.
    const longest = allBg.reduce((a, b) => (b.length > a.length ? b : a))
    const normalized = longest.startsWith("//") ? "https:" + longest : longest
    return normalized.replace(/\?size=[a-z]+$/i, "?size=l")
  }
  // 3. Fallback to og:image (covers non-card products).
  return parseOg(html, "image")
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
      image: parseProductImage(html),
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
  const url = new URL(req.url)

  // Image-proxy route: GET /image?u=<absolute-url>
  //
  // The browser cannot read pixel data from a cross-origin image
  // unless that image was served with `Access-Control-Allow-Origin`.
  // cdn.snkrdunk.com does NOT return CORS headers, so we cannot
  // run a canvas-based crop on the SNKRDUNK image directly. This
  // route proxies the image bytes back through Supabase's edge,
  // which DOES return CORS headers (see CORS constant above), so
  // the frontend can draw the image to a canvas and read pixel
  // data without tripping the browser's same-origin check.
  //
  // Cached by the browser/CDN with Cache-Control: public,
  // max-age=86400 (1 day) — the SNKRDUNK product images rarely
  // change, so a day of caching is safe and reduces load on the
  // edge.
  if (url.pathname.endsWith("/image") && req.method === "GET") {
    const target = url.searchParams.get("u") ?? ""
    if (!/^https?:\/\//.test(target)) {
      return jsonResponse({ error: "u must be an http(s) URL" }, 400)
    }
    // cdn.snkrdunk.com blocks some cloud / edge IPs with HTTP 403.
    // We try a plain request first and, on 403, retry with a fuller
    // browser-like header set (Referer, sec-ch-* hints). This isn't
    // guaranteed to bypass the block but it has historically unblocked
    // most cdn.snkrdunk.com edges. If both attempts 403, the caller
    // gets a clear error and can fall back to the un-proxied URL
    // (which is CORS-tainted but at least renders).
    const baseHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    }
    const browserHeaders: Record<string, string> = {
      ...baseHeaders,
      "Referer": "https://snkrdunk.com/",
      "sec-ch-ua":
        '"Chromium";v="124", "Not-A.Brand";v="99", "Google Chrome";v="124"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "image",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "same-site",
    }
    async function tryFetch(headers: Record<string, string>) {
      return await fetch(target, { headers, redirect: "follow" })
    }
    try {
      let r = await tryFetch(baseHeaders)
      if (r.status === 403) r = await tryFetch(browserHeaders)
      if (!r.ok) {
        return jsonResponse(
          {
            error: `upstream ${r.status}`,
            upstream_status: r.status,
            upstream_url: target,
            hint: r.status === 403
              ? "cdn.snkrdunk.com is blocking this edge IP. The image will render without cropping."
              : `upstream returned ${r.status}`,
          },
          502,
        )
      }
      const body = await r.arrayBuffer()
      const ct = r.headers.get("content-type") ?? "application/octet-stream"
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "public, max-age=86400",
          ...CORS,
        },
      })
    } catch (e) {
      return jsonResponse(
        { error: e instanceof Error ? e.message : String(e) },
        502,
      )
    }
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
