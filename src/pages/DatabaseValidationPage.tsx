import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ─── Types ────────────────────────────────────────────────────────────────

interface CardRow {
  id: string
  tcg_type: 'PTCG' | 'OPCG'
  card_series: string
  card_index: string
  card_name: string
  card_rarity: string
  url_yuyutei: string | null
  snkrdunk_apparel_id: string | null
  verified_at: string | null
  verify_status: 'verified' | 'rejected' | null
}

interface SnkrdunkMetadata {
  apparel_id: string
  title: string        // canonical Japanese product name
  image: string        // og:image (front scan)
  brand: string        // "ONE PIECE" / "ポケモンカード"
  fetched: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function yuyuteiImageUrl(card: CardRow): string {
  const url = (card.url_yuyutei ?? '').trim()
  if (!url) return ''
  // The CDN path mirrors the yuyu-tei product URL:
  //   https://yuyu-tei.jp/sell/{tcg}/card/{series}/{slug}
  //   https://card.yuyu-tei.jp/{tcg}/front/{series}/{slug}.jpg
  // We extract both series and slug from url_yuyutei rather than
  // from card.card_series — the card_series field is the short
  // display label (e.g. "st01") but the CDN uses the full
  // product-page series slug (e.g. "promo-st10"). When the two
  // diverge (promos, reprints, anniversary sets) the CDN path
  // built from card_series 404s, but the one built from the URL
  // resolves correctly.
  const segments = url.split('/').filter(Boolean)
  const slug = segments[segments.length - 1] ?? ''
  const series = segments[segments.length - 2] ?? ''
  if (!slug || !series) return ''
  const tcgPath = card.tcg_type === 'PTCG' ? 'poc' : 'opc'
  return `https://card.yuyu-tei.jp/${tcgPath}/front/${series}/${slug}.jpg`
}

function snkrdunkProductUrl(apparel_id: string): string {
  return `https://snkrdunk.com/apparels/${apparel_id}`
}

/**
 * Wrap a SNKRDUNK image URL in our Edge Function's CORS proxy.
 *
 * The browser refuses to read pixel data from a canvas that was
 * drawn from a cross-origin image unless that image was served
 * with `Access-Control-Allow-Origin`. cdn.snkrdunk.com does NOT
 * return CORS headers, so our `trimWhiteBorders` canvas pass
 * throws SecurityError on SNKRDUNK images. We work around this by
 * routing the image through our `snkrdunk-meta` Edge Function,
 * which adds proper CORS headers when proxying the bytes back.
 *
 * The proxy URL is `<edge>/image?u=<encoded-snkrdunk-url>`. The
 * browser caches the bytes (Cache-Control: max-age=86400) so we
 * only pay the proxy cost once per session.
 */
function snkrdunkProxiedImageUrl(rawUrl: string): string {
  const baseUrl =
    (
      (import.meta.env.VITE_SNKRDUNK_META_URL as string | undefined)?.trim() ||
      (
        ((import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ??
          '')
      ).replace(/\/+$/, '') + '/functions/v1/snkrdunk-meta'
    )
  return `${baseUrl}/image?u=${encodeURIComponent(rawUrl)}`
}

/**
 * Crop whitespace and transparency from all four sides of an
 * HTMLImageElement. Returns a cropped PNG data URL, or null if no
 * border was found / the image was unprocessable.
 *
 * "Whitespace" is treated broadly:
 *   - Pure-white pixels (RGB ≈ 255,255,255) are considered padding.
 *     This catches images that were saved with a solid white
 *     background instead of a transparent one.
 *   - Fully-transparent pixels (alpha = 0) are also considered
 *     padding. This catches the `upload_bg_removed` SNKRDUNK
 *     product scans which ship with transparent backgrounds.
 *
 * For each edge, we walk inward until we hit a pixel that is
 * NEITHER near-white NOR fully transparent. The returned canvas
 * is the tight bounding box of "opaque, non-white" content.
 *
 * SNKRDUNK's product scans ship with sizable transparent/white
 * borders which makes them look small compared to the yuyu-tei
 * scan in the validation page's side-by-side comparison. Trimming
 * the border lets the parent grid column (proportional to the
 * cropped image's natural aspect ratio) display the card
 * edge-to-edge.
 *
 * Performance: a typical ~600×600 image has ~2,400 pixels per edge
 * to scan; the function returns in well under 100ms on commodity
 * hardware. The result is memoized by the caller so this only
 * runs once per URL.
 */
async function trimWhiteBorders(
  img: HTMLImageElement,
  tolerance = 6,
): Promise<string | null> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) return null

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, w, h)

  let imageData: ImageData
  try {
    imageData = ctx.getImageData(0, 0, w, h)
  } catch {
    // CORS-tainted canvas; cannot read pixels. Skip the crop.
    return null
  }
  const data = imageData.data

  // A pixel is "content" if it is NEITHER near-white NOR fully
  // transparent. tolerance=6 means RGB sum must be ≤ (255+255+255)
  // - 3*6 = 747 to count as not-white. For the alpha check, a
  // pixel with alpha < 10 is treated as fully transparent.
  const RGB_THRESHOLD = 255 * 3 - tolerance * 3
  const ALPHA_THRESHOLD = 10
  const isContent = (i: number) =>
    data[i + 3] >= ALPHA_THRESHOLD &&
    data[i] + data[i + 1] + data[i + 2] < RGB_THRESHOLD

  let top = 0
  outerTop: for (; top < h; top++) {
    for (let x = 0; x < w; x++) {
      if (isContent((top * w + x) * 4)) break outerTop
    }
  }
  let bottom = h - 1
  outerBottom: for (; bottom > top; bottom--) {
    for (let x = 0; x < w; x++) {
      if (isContent((bottom * w + x) * 4)) break outerBottom
    }
  }
  let left = 0
  outerLeft: for (; left < w; left++) {
    for (let y = top; y <= bottom; y++) {
      if (isContent((y * w + left) * 4)) break outerLeft
    }
  }
  let right = w - 1
  outerRight: for (; right > left; right--) {
    for (let y = top; y <= bottom; y++) {
      if (isContent((y * w + right) * 4)) break outerRight
    }
  }

  // No cropping needed (image already tight, or fully empty —
  // caller checks and ignores).
  const noCrop =
    top === 0 && left === 0 && bottom === h - 1 && right === w - 1

  let cropW: number
  let cropH: number
  let srcX: number
  let srcY: number
  if (noCrop) {
    cropW = w
    cropH = h
    srcX = 0
    srcY = 0
  } else {
    cropW = right - left + 1
    cropH = bottom - top + 1
    srcX = left
    srcY = top
    if (cropW <= 0 || cropH <= 0) return null
  }

  const out = document.createElement('canvas')
  out.width = cropW
  out.height = cropH
  const octx = out.getContext('2d')
  if (!octx) return null
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(canvas, srcX, srcY, cropW, cropH, 0, 0, cropW, cropH)
  return out.toDataURL('image/png')
}

/** Fetch the SNKRDUNK og:image + og:title for an apparel_id.
 *
 * Snkrdunk.com does not return CORS headers, so we cannot fetch the
 * page directly from the browser. We ALWAYS POST to our Supabase Edge
 * Function (`snkrdunk-meta`, see supabase/functions/snkrdunk-meta/index.ts)
 * which performs the server-side fetch and returns parsed
 * og:image / og:title / og:site_name.
 *
 * URL resolution order:
 *   1. `VITE_SNKRDUNK_META_URL` if set (allows overriding to a
 *      local proxy during dev).
 *   2. `<VITE_SUPABASE_URL>/functions/v1/snkrdunk-meta` (the standard
 *      Supabase Edge Function URL).
 *
 * The Edge Function is deployed with `--no-verify-jwt`, so JWT
 * verification is off; we still pass `apikey: VITE_SUPABASE_ANON_KEY`
 * so Supabase can apply the usual anonymous-role rate limits.
 */
async function fetchSnkrdunkMeta(apparel_id: string): Promise<SnkrdunkMetadata> {
  const explicitUrl = (
    import.meta.env.VITE_SNKRDUNK_META_URL as string | undefined
  )?.trim()
  const baseUrl =
    explicitUrl ||
    ((import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? '')
      .replace(/\/+$/, '') +
      '/functions/v1/snkrdunk-meta'

  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (anonKey) {
    headers['apikey'] = anonKey
    headers['Authorization'] = `Bearer ${anonKey}`
  }

  try {
    const r = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ apparel_id }),
      cache: 'no-store',
    })
    if (!r.ok) {
      return { apparel_id, title: '', image: '', brand: '', fetched: false }
    }
    const data = (await r.json()) as Partial<SnkrdunkMetadata>
    return {
      apparel_id,
      title: data.title ?? '',
      image: data.image ?? '',
      brand: data.brand ?? '',
      fetched: data.fetched ?? true,
    }
  } catch {
    return { apparel_id, title: '', image: '', brand: '', fetched: false }
  }
}

/** Resolve the base URL for the discover-trigger Edge Function.
 *
 * Same env-var pattern as snkrdunkProxiedImageUrl above: prefer an
 * explicit VITE_DISCOVER_TRIGGER_URL override, otherwise derive from
 * VITE_SUPABASE_URL.
 */
function discoverTriggerUrl(): string {
  const explicit =
    (import.meta.env.VITE_DISCOVER_TRIGGER_URL as string | undefined)?.trim()
  if (explicit) return explicit
  const supabaseUrl =
    (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
  return supabaseUrl.replace(/\/+$/, '') + '/functions/v1/discover-trigger'
}

/** Enqueue one or more card_ids in the discover_queue table via the
 *  discover-trigger Edge Function. The Edge Function (not this code)
 *  is responsible for the unique-partial-index dedupe, so repeated
 *  calls for the same card are safe.
 *
 *  Returns true on success, false on transport / server error. We
 *  don't surface the error to the user — the banner just stays in
 *  "waiting" state and the next page refresh will retry.
 */
async function triggerDiscover(card_ids: string[]): Promise<boolean> {
  if (card_ids.length === 0) return true
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (anonKey) {
    headers['apikey'] = anonKey
    headers['Authorization'] = `Bearer ${anonKey}`
  }
  try {
    const r = await fetch(discoverTriggerUrl(), {
      method: 'POST',
      headers,
      body: JSON.stringify({ card_ids }),
      cache: 'no-store',
    })
    return r.ok
  } catch {
    return false
  }
}

// Lightweight front-end debounce so rapid clicks don't spam Supabase.
const SLEEP_MS = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// ─── Component ────────────────────────────────────────────────────────────

export default function DatabaseValidationPage() {
  const { user } = useAuth()
  const [rows, setRows] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metaCache, setMetaCache] = useState<Record<string, SnkrdunkMetadata>>({})
  const [metaLoading, setMetaLoading] = useState<Set<string>>(new Set())
  // Count of cards in master_table whose snkrdunk_apparel_id is
  // still NULL. These cards exist in the database but aren't part
  // of the validation queue yet — the user needs to run
  // scripts/discover_snkrdunk_apparel_ids.py to look them up on
  // SNKRDUNK. We surface this count in a banner so the user
  // knows why their newly-added card isn't appearing.
  const [pendingDiscoveryCount, setPendingDiscoveryCount] = useState(0)
  // Card IDs of the pending-discovery rows. We auto-enqueue these
  // in a separate effect so the GitHub Actions cron picks them up.
  const [pendingDiscoveryIds, setPendingDiscoveryIds] = useState<string[]>([])
  // Set to true once we've kicked off discover-trigger for the
  // current page mount's pending IDs. We don't re-kick on every
  // refresh — only the first time we see new pending IDs in this
  // session.
  const [discoverEnqueued, setDiscoverEnqueued] = useState(false)
  // discover_queue status counts (status → count). Used to render a
  // progress bar so the user knows how many cards the worker has
  // processed vs. still has to do.
  const [queueStatus, setQueueStatus] = useState<{
    pending: number
    processing: number
    done: number
    failed: number
  }>({ pending: 0, processing: 0, done: 0, failed: 0 })
  // Tracks the number of `done`/`failed` rows from PREVIOUS batches
  // that the user has already seen finish. We subtract this from
  // every poll's totals so the progress bar only reflects the
  // CURRENT active batch — otherwise the bar would never reset
  // after the first batch completed (the queue retains done/failed
  // rows indefinitely for audit purposes) and the user would think
  // the worker was "still finding old cards" every time they
  // added a new card to the database.
  //
  // The baseline is bumped up each time the active batch reaches
  // 100% with no in-flight work, and reset to 0 the moment any
  // new pending row appears (signalling a new batch has started).
  const completedBaselineRef = useRef(0)

  // Index of the card currently displayed in the detail panel
  const [cursor, setCursor] = useState(0)
  const [filter, setFilter] = useState<'unverified' | 'verified' | 'rejected'>('unverified')
  const [searchTerm, setSearchTerm] = useState('')
  // Tracks whether the filter has been chosen by the user (or by the
  // initial-load auto-pick). Once true, we never overwrite the user's
  // selection on subsequent re-fetches.
  const [filterChosen, setFilterChosen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      // Two queries in parallel:
      //   1) Cards that have a snkrdunk_apparel_id — these drive the
      //      validation queue (Unverified / Verified / Rejected).
      //   2) Cards WITHOUT a snkrdunk_apparel_id — these need the
      //      discover script to run before they can be validated.
      //      We surface their count in a banner so the user knows
      //      "I added a card but it doesn't show up" means the
      //      discover job hasn't run yet.
      // Three parallel queries:
      //   1) Cards that have a snkrdunk_apparel_id — these drive the
      //      validation queue (Unverified / Verified / Rejected).
      //   2) Cards WITHOUT a snkrdunk_apparel_id — these need the
      //      discover script to run before they can be validated.
      //      We surface their count in a banner so the user knows
      //      "I added a card but it doesn't show up" means the
      //      discover job hasn't run yet.
      //   3) discover_queue status counts — lets the banner show a
      //      progress bar with done/total for the active discovery
      //      batch.
      const [withId, withoutId, queueRows] = await Promise.all([
        supabase
          .from('master_table')
          .select(
            'id,tcg_type,card_series,card_index,card_name,card_rarity,url_yuyutei,snkrdunk_apparel_id,verified_at,verify_status',
          )
          .not('snkrdunk_apparel_id', 'is', null)
          .order('verify_status', { ascending: true, nullsFirst: true })
          .order('created_at', { ascending: true })
          .limit(500),
        // Fetch up to 50 pending IDs. We cap at 50 because the
        // discover-trigger Edge Function also caps at 50 per
        // request, and we don't want to spam the queue if a big
        // batch sneaks through.
        supabase
          .from('master_table')
          .select('id')
          .is('snkrdunk_apparel_id', null)
          .order('created_at', { ascending: true })
          .limit(50),
        // Counts of rows by status. RLS allows the authenticated
        // user to SELECT, so we can read counts without service role.
        supabase
          .from('discover_queue')
          .select('status'),
      ])
      if (withId.error) throw withId.error
      const data = (withId.data ?? []) as CardRow[]
      setRows(data)
      setPendingDiscoveryCount((withoutId.data ?? []).length)
      setPendingDiscoveryIds((withoutId.data ?? []).map(r => r.id))
      // Tally queue status counts. We tolerate the queue query
      // failing (it's a nice-to-have) without aborting the whole
      // load.
      const qs = { pending: 0, processing: 0, done: 0, failed: 0 }
      for (const r of (queueRows.data ?? []) as { status: string }[]) {
        if (r.status in qs) {
          qs[r.status as keyof typeof qs]++
        }
      }
      setQueueStatus(qs)
      setCursor(0)
      // Update the "completed batch" baseline so the progress bar
      // only tracks the CURRENT batch's work. The invariant is:
      //
      //   visibleDone + visibleFailed + pending + processing
      //     = current batch size
      //
      // where visibleDone/Failed = max(0, rawDone/RawFailed -
      // baseline).
      //
      // We bump the baseline UP every time the queue transitions
      // from "had in-flight work" to "no in-flight work" — that's
      // the moment a batch has finished. We bump it by exactly the
      // amount of done/failed rows the queue has accumulated so
      // far. That way:
      //
      //   - During batch 1: baseline stays 0, bar tracks 0→100%
      //   - When batch 1 completes: baseline = done+failed so far
      //     (e.g. 5). Bar collapses to 0%.
      //   - If user adds 3 new cards: queue grows to pending=3,
      //     done=5, failed=0. Total visible = 3+0+0+0 = 3. Bar
      //     starts at 0/3 again. ✓
      //   - During batch 2: done grows from 0→3 (relative to
      //     baseline=5). Bar shows 3/6 = 50% as it fills. ✓
      //   - When batch 2 completes: baseline bumps to 5+3 = 8.
      //     Bar collapses again. ✓
      //
      // We only bump on the TRANSITION from in-flight to idle so
      // a long-idle queue doesn't keep adding to the baseline on
      // every poll.
      const finishedThisBatch = qs.done + qs.failed
      const inFlight = qs.pending + qs.processing
      if (inFlight === 0 && finishedThisBatch > completedBaselineRef.current) {
        // Batch has just finished (or we're catching up to a
        // previously-finished batch on first page mount). Snap
        // baseline up to the current done+failed total.
        completedBaselineRef.current = finishedThisBatch
      }
      // Note: we never DECREASE the baseline. If rows are deleted
      // from the queue externally, the visible counters may
      // temporarily show as "already finished" which is benign.
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

  // Live refresh — poll the validation data every 10s while the
  // tab is open. Why polling instead of Supabase Realtime?
  //   1. Zero infra cost: no realtime publication changes, no new
  //      channel subscriptions, no RLS filter wiring.
  //   2. ~10s latency is invisible for the use case here — the
  //      discover worker itself takes ~2-3 min per card, so by
  //      the time a row changes, 10s lag is noise.
  //   3. The page is already doing 3 parallel queries on mount;
  //      running that same load() on a timer reuses everything.
  //
  // Cost: ~18 queries/minute while the tab is open (3 queries ×
  // 6 polls). Free tier allows ~unlimited REST calls; this is
  // trivial.
  //
  // We pause polling when:
  //   - the tab is hidden (browsers throttle setInterval anyway,
  //     but visibilitychange lets us stop the DB load entirely
  //     when the user is on another tab)
  //   - the page is loading (no need to fire while a load is
  //     already in flight)
  useEffect(() => {
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      if (document.hidden) return
      if (loading) return
      void load()
    }
    const id = window.setInterval(tick, 10_000)
    const onVisibility = () => {
      if (!document.hidden) tick() // catch up immediately on focus
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load, loading])

  // When load() finds new pending-discovery rows, automatically
  // enqueue them via the discover-trigger Edge Function. The
  // .github/workflows/discover.yml cron picks them up within 5
  // minutes and runs scripts/discover_snkrdunk_apparel_ids.py.
  //
  // Why fire-and-forget from the page? Two reasons:
  //   1. Discover-script logic (Playwright + Pillow) doesn't fit in
  //      a Deno Edge Function sandbox, so it must run elsewhere.
  //   2. The page is the natural signal source — it's the only
  //      place that already knows which cards lack apparel_ids.
  //
  // We only fire once per page mount (gated by `discoverEnqueued`).
  // Refreshing the page resets the gate so a new batch gets
  // re-enqueued (the Edge Function dedupes via the partial unique
  // index, so this is idempotent).
  useEffect(() => {
    if (discoverEnqueued) return
    if (pendingDiscoveryIds.length === 0) return
    setDiscoverEnqueued(true)
    void triggerDiscover(pendingDiscoveryIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDiscoveryIds, discoverEnqueued])

  // ─── Filter pipeline ──────────────────────────────────────────────────────
  // Each entry carries the card's original position in `rows` so the cursor
  // (which indexes `rows`, not `filtered`) stays stable across filter changes.
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return rows
      .map((r, originalIdx) => ({ r, originalIdx }))
      .filter(({ r }) => {
        if (filter === 'unverified' && r.verify_status !== null) return false
        if (filter === 'verified' && r.verify_status !== 'verified') return false
        if (filter === 'rejected' && r.verify_status !== 'rejected') return false
        if (!q) return true
        return (
          r.id.toLowerCase().includes(q) ||
          (r.card_name ?? '').toLowerCase().includes(q) ||
          (r.card_index ?? '').toLowerCase().includes(q) ||
          (r.card_rarity ?? '').toLowerCase().includes(q) ||
          (r.snkrdunk_apparel_id ?? '').includes(q)
        )
      })
  }, [rows, filter, searchTerm])

  // After the filter or rows change (e.g. user marked a card verified
  // so it dropped out of the "Unverified" filter), clamp the cursor to
  // a position that still passes the active filter. This keeps the
  // detail panel in sync — if the cursor's row is no longer in the
  // filtered list, jump to the first filtered row.
  useEffect(() => {
    if (filtered.length === 0) {
      if (cursor !== 0) setCursor(0)
      return
    }
    const cursorInFiltered = filtered.some(e => e.originalIdx === cursor)
    if (!cursorInFiltered) setCursor(filtered[0].originalIdx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, searchTerm, rows])

  // Tab counts — computed from the full `rows` so the count badges
  // always reflect totals regardless of the active filter. Defined
  // here (above the priority-pick effect) so the effect can read it.
  const counts = useMemo(() => {
    const c = { unverified: 0, verified: 0, rejected: 0 }
    for (const r of rows) {
      if (r.verify_status === null) c.unverified++
      else if (r.verify_status === 'verified') c.verified++
      else if (r.verify_status === 'rejected') c.rejected++
    }
    return c
  }, [rows])

  // Auto-pick the initial filter once the rows have loaded. Priority:
  // Unverified (still needs review) → Rejected (already inspected,
  // worth a second look). When the queue is empty of both, we keep
  // the default Unverified selection so the empty state renders.
  // Verified is intentionally omitted from the auto-pick — cards
  // already confirmed don't need to be the default view.
  //
  // We only auto-pick once per page mount (or after the rows are
  // wiped, e.g. logout/login) via the `filterChosen` flag. Any
  // explicit user click on a tab sets the flag and prevents this
  // effect from overriding the user's selection on subsequent
  // re-fetches (e.g. manual Refresh button).
  useEffect(() => {
    if (filterChosen) return
    if (loading) return
    if (rows.length === 0) return
    let next: typeof filter | null = null
    if (counts.unverified > 0) next = 'unverified'
    else if (counts.rejected > 0) next = 'rejected'
    // No "all" fallback any more — when the queue is empty of
    // unverified and rejected, fall through to the default
    // (unverified) which renders the empty state.
    if (next && next !== filter) setFilter(next)
    setFilterChosen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, counts.unverified, counts.rejected, loading, filterChosen])

  // ─── Fetch SNKRDUNK metadata for the current card (and warm-ahead)
  const warmAhead = (a: string) => {
    if (!metaCache[a] && !metaLoading.has(a)) {
      void prefetchMeta(a)
    }
  }
  const prefetchMeta = useCallback(async (apparelId: string) => {
    setMetaLoading(prev => new Set(prev).add(apparelId))
    try {
      const meta = await fetchSnkrdunkMeta(apparelId)
      setMetaCache(prev => ({ ...prev, [apparelId]: meta }))
    } finally {
      setMetaLoading(prev => {
        const n = new Set(prev)
        n.delete(apparelId)
        return n
      })
    }
  }, [])

  // Fetch the meta for the currently displayed card, and warm-ahead the
  // next one so navigation feels instant.
  // The card currently displayed in the detail panel. We derive it
  // from `filtered` (not `rows`) so the detail panel always respects
  // the active filter — when the user picks "Unverified" and no cards
  // match, the panel hides (currentCard === null) instead of showing a
  // verified/rejected card from the unfiltered rows. The cursor itself
  // stores an *index into rows*; we resolve it through filtered so the
  // visible card is always the row at cursor, IF that row passes the
  // current filter, else the first row that does.
  const currentFilteredEntry = useMemo(() => {
    if (filtered.length === 0) return null
    const byOriginalIdx = new Map(filtered.map(e => [e.originalIdx, e]))
    const direct = byOriginalIdx.get(cursor)
    if (direct) return direct
    // Cursor points at a card that's been filtered out (e.g. user
    // confirmed a card and the filter is "Unverified"). Fall back to
    // the first card in the filtered list.
    return filtered[0]
  }, [filtered, cursor])
  const currentCard = currentFilteredEntry?.r ?? null
  useEffect(() => {
    if (!currentCard?.snkrdunk_apparel_id) return
    if (!metaCache[currentCard.snkrdunk_apparel_id]) {
      void prefetchMeta(currentCard.snkrdunk_apparel_id)
    }
  }, [currentCard, metaCache, prefetchMeta])

  useEffect(() => {
    // Warm-ahead the next 3 cards
    if (filtered.length < 2) return
    const myIdx = filtered.findIndex(x => x.originalIdx === cursor)
    if (myIdx === -1) return
    for (let off = 1; off <= 3 && myIdx + off < filtered.length; off++) {
      const next = rows[filtered[myIdx + off].originalIdx]
      if (next?.snkrdunk_apparel_id) warmAhead(next.snkrdunk_apparel_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, filtered.length])

  const currentMeta =
    currentCard?.snkrdunk_apparel_id
      ? metaCache[currentCard.snkrdunk_apparel_id] ?? null
      : null
  const currentMetaLoading = currentCard?.snkrdunk_apparel_id
    ? metaLoading.has(currentCard.snkrdunk_apparel_id)
    : false

  // Aspect ratios (naturalWidth / naturalHeight) of the two card images.
// Stored as state so the parent can dynamically size the grid columns
// proportionally: a wider column for the landscape SNKRDUNK scan and a
// narrower one for the portrait yuyu-tei scan, so both images render at
// the SAME visual height inside their respective containers.
const [yuyuteiAspect, setYuyuteiAspect] = useState<number | null>(null)
const [snkrdunkAspect, setSnkrdunkAspect] = useState<number | null>(null)

// Reset all measurements when we move to a different card, so the next
// card's measurements start fresh and the SNKRDUNK side doesn't briefly
// show stale values.
useEffect(() => {
  setYuyuteiAspect(null)
  setSnkrdunkAspect(null)
}, [currentCard?.id, currentCard?.url_yuyutei, currentCard?.snkrdunk_apparel_id])

const reportImageMetrics = useCallback(
  (img: HTMLImageElement, side: 'yuyutei' | 'snkrdunk') => {
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return
    const aspect = w / h
    if (side === 'yuyutei') {
      setYuyuteiAspect(aspect)
    } else {
      setSnkrdunkAspect(aspect)
    }
  },
  [])

// Compute the grid column template. Each column gets a flex fraction
// proportional to its image's aspect ratio, so a portrait (yuyu-tei)
// and a landscape (SNKRDUNK) image both end up at the same visual
// height. Fall back to equal columns when neither aspect is known yet.
const gridTemplateColumns =
  yuyuteiAspect && snkrdunkAspect
    ? `${yuyuteiAspect}fr ${snkrdunkAspect}fr`
    : 'minmax(0, 1fr) minmax(0, 1fr)'

  // ─── Verdict actions (PATCH via Supabase REST)
  // Both the side-by-side detail panel and the Verified-table view
  // need to mutate a card's verify_status. To avoid duplicating the
  // optimistic-update + Supabase call, we centralize it here. Pass
  // the target card explicitly; if omitted, falls back to the
  // currently-displayed card (the detail-panel workflow).
  async function setVerdict(
    status: 'verified' | 'rejected' | null,
    card?: CardRow,
  ) {
    const target = card ?? currentCard
    if (!target) return
    if (status === null) {
      // "Clear verdict" — reset both columns; falls back to the
      // queue so the user can re-review.
      const r = await supabase
        .from('master_table')
        .update({ verify_status: null, verified_at: null })
        .eq('id', target.id)
      if (r.error) {
        setError(r.error.message)
        return
      }
    } else {
      const r = await supabase
        .from('master_table')
        .update({
          verify_status: status,
          verified_at: new Date().toISOString(),
        })
        .eq('id', target.id)
      if (r.error) {
        setError(r.error.message)
        return
      }
    }
    // Optimistic local update — we don't want to wait for a re-fetch
    // just to advance the cursor.
    setRows(prev =>
      prev.map(r =>
        r.id === target.id
          ? {
              ...r,
              verify_status: status,
              verified_at: status === null ? null : new Date().toISOString(),
            }
          : r,
      ),
    )
    // Only the detail-panel workflow auto-advances; the table view
    // just lets the row disappear from the filtered list (since
    // `verify_status === null` no longer matches the filter).
    if (!card) {
      // Brief sleep so the user feels the action registered before we
      // jump to the next card. 250ms is short enough to feel snappy.
      await SLEEP_MS(250)
      goToNextUnverified()
    }
  }

  async function reassignApparelId(newId: string) {
    if (!currentCard) return
    if (!/^\d{4,7}$/.test(newId.trim())) {
      setError('SNKRDUNK apparel_id must be a 4-7 digit number')
      return
    }
    const r = await supabase
      .from('master_table')
      .update({ snkrdunk_apparel_id: newId.trim(), verify_status: null, verified_at: null })
      .eq('id', currentCard.id)
    if (r.error) {
      setError(r.error.message)
      return
    }
    setRows(prev =>
      prev.map(r =>
        r.id === currentCard.id
          ? {
              ...r,
              snkrdunk_apparel_id: newId.trim(),
              verify_status: null,
              verified_at: null,
            }
          : r,
      ),
    )
    setMetaCache(prev => {
      const n = { ...prev }
      delete n[currentCard.snkrdunk_apparel_id ?? '']
      return n
    })
    void prefetchMeta(newId.trim())
  }

  function goTo(delta: number) {
    if (filtered.length === 0) return
    const myIdx = filtered.findIndex(x => x.originalIdx === cursor)
    const base = myIdx === -1 ? 0 : myIdx
    const nextIdx = Math.min(filtered.length - 1, Math.max(0, base + delta))
    setCursor(filtered[nextIdx].originalIdx)
  }

  function goToNextUnverified() {
    if (filtered.length === 0) return
    const myIdx = filtered.findIndex(x => x.originalIdx === cursor)
    const base = myIdx === -1 ? -1 : myIdx
    for (let off = 1; base + off < filtered.length; off++) {
      const cand = rows[filtered[base + off].originalIdx]
      if (cand.verify_status === null) {
        setCursor(filtered[base + off].originalIdx)
        return
      }
    }
    // No more unverified in the current filter; just advance by 1.
    if (base + 1 < filtered.length) setCursor(filtered[base + 1].originalIdx)
  }

  // ─── Render helpers ───────────────────────────────────────────────────────
  // Note: `counts` is defined earlier (above the priority-pick effect)
  // so the auto-filter logic can read it. We reuse the same memo here
  // for the tab badges.

  return (
    <>
      <div className="page-header">
        <div>
          <h2 className="page-title">Validation</h2>
          <p className="page-subtitle">
            Sanity-check each card's SNKRDUNK apparel_id by comparing the
            yuyu-tei product image with the SNKRDUNK product page. Mark
            a card as verified or rejected; the daily scraper skips
            cards you've already vetted.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh"
          title="Refresh"
          style={{ padding: '0.4rem 0.6rem', fontSize: '1rem' }}
        >
          ↻
        </button>
      </div>

      {/* Filter / progress strip */}
      <div
        className="lp-card"
        style={{
          marginBottom: '1rem',
          padding: '0.625rem 0.75rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        {/* Segmented filter: a single bordered pill group, not four full
            buttons. Quieter, less button-noise. */}
        <div
          role="tablist"
          aria-label="Filter validation queue"
          style={{
            display: 'inline-flex',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: 2,
            gap: 2,
            background: 'var(--bg-primary)',
          }}
        >
          {(['unverified', 'verified', 'rejected'] as const).map(f => {
            const active = filter === f
            const count =
              f === 'unverified' ? counts.unverified
              : f === 'verified' ? counts.verified
              : counts.rejected
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                className="btn"
                onClick={() => {
                  setFilter(f)
                  setFilterChosen(true)
                }}
                style={{
                  padding: '0.25rem 0.7rem',
                  borderRadius: 999,
                  border: 'none',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#fff' : 'var(--text-secondary)',
                  boxShadow: 'none',
                  textTransform: 'capitalize',
                }}
              >
                {f}
                <span style={{ opacity: 0.7, marginLeft: 4 }}>{count}</span>
              </button>
            )
          })}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <input
            type="search"
            className="form-input"
            placeholder="Filter by id / name / index / rarity / apparel_id…"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            aria-label="Filter validation queue"
          />
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {filtered.length === 0
            ? 'no matches'
            : filter === 'verified'
              ? `${filtered.length} card${filtered.length === 1 ? '' : 's'}`
              : `${filtered.findIndex(x => x.originalIdx === cursor) + 1} / ${filtered.length}`}
        </div>
      </div>

      {error && (
        <div className="form-alert form-alert--error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Pending-discovery banner — surfaces cards that exist in
          master_table but have no SNKRDUNK apparel_id yet. When the
          page detects new pending rows, it auto-enqueues them via
          the discover-trigger Edge Function; the GitHub Actions cron
          (`.github/workflows/discover.yml`) picks them up within 5
          minutes.

          The banner follows the site's warm-coral theme:
            - `lp-card` shell with `::before` gradient bar (matches
              other cards on the page)
            - status pill chips matching the existing `.tag` style
              (ptcg / opcg / buy / sell)
            - progress bar with the same rounded radius and shadow
              treatment as `.btn`
            - a soft @keyframes pulse on the spinner icon while
              discovery is actively running
            - status colors via `--success` / `--danger` so done rows
              read green and failed rows read coral-red. */}
      {!loading && pendingDiscoveryCount > 0 && (() => {
        // Aggregate: the "active batch" is everything that's been
        // touched by the worker (pending + processing + done +
        // failed). The progress is `done / (done + failed)` since
        // pending/processing aren't finished yet — but we display
        // total coverage as done+failed over the active batch size
        // so the bar fills monotonically as cards finish.
        //
        // Subtract completedBaselineRef from done+failed so the
        // bar only tracks the CURRENT batch. Without this, the
        // first batch's done rows stay in the queue forever (audit
        // trail) and the bar would never reset — every subsequent
        // batch would show as a tiny slice of an ever-growing
        // total, making the user think the worker is "still
        // finding old cards".
        const baseline = completedBaselineRef.current
        const visibleDone = Math.max(0, queueStatus.done - baseline)
        const visibleFailed = Math.max(0, queueStatus.failed - baseline)
        const total = queueStatus.pending + queueStatus.processing +
          visibleDone + visibleFailed
        const finished = visibleDone + visibleFailed
        const pct = total > 0 ? Math.round((finished / total) * 100) : 0
        const pctDone = total > 0 ? Math.round((visibleDone / total) * 100) : 0
        const pctFailed = total > 0 ? Math.round((visibleFailed / total) * 100) : 0
        const pctActive = 100 - pctDone - pctFailed
        return (
          <div
            className="lp-card"
            style={{
              marginBottom: '1rem',
              padding: '1rem 1.1rem',
              borderColor: 'var(--accent)',
            }}
          >
            {/* Header row: icon + status text + Discover-now button */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: total > 0 ? '0.85rem' : 0,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  fontSize: '1.25rem',
                  lineHeight: 1,
                  display: 'inline-flex',
                  width: '2rem',
                  height: '2rem',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '50%',
                  background: 'var(--accent-light)',
                  animation:
                    queueStatus.processing > 0
                      ? 'lp-pulse 1.4s ease-in-out infinite'
                      : undefined,
                }}
              >
                {queueStatus.processing > 0 ? '⚙️' : '⏳'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                  }}
                >
                  {discoverEnqueued
                    ? queueStatus.processing > 0
                      ? `Discovering ${total} card${total === 1 ? '' : 's'} on SNKRDUNK…`
                      : `Queued ${pendingDiscoveryCount} card${pendingDiscoveryCount === 1 ? '' : 's'} for SNKRDUNK lookup`
                    : `${pendingDiscoveryCount} card${pendingDiscoveryCount === 1 ? '' : 's'} need SNKRDUNK lookup`}
                </div>
                <div
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.78rem',
                    marginTop: 2,
                  }}
                >
                  These cards have no <code>snkrdunk_apparel_id</code> yet.
                  The GitHub Actions worker runs{' '}
                  <code>scripts/discover_snkrdunk_apparel_ids.py</code>{' '}
                  on them. They&rsquo;ll appear in the Unverified tab
                  automatically once matched.
                </div>
              </div>
              {!discoverEnqueued && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setDiscoverEnqueued(true)
                    void triggerDiscover(pendingDiscoveryIds)
                  }}
                  style={{
                    fontSize: '0.8rem',
                    padding: '0.45rem 0.85rem',
                    flexShrink: 0,
                  }}
                  title="Enqueue these card_ids so the GitHub Actions worker will discover their SNKRDUNK apparel_id"
                >
                  Discover now
                </button>
              )}
            </div>

            {/* Progress bar + status chips — only when there's a queue */}
            {total > 0 && (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                    marginBottom: '0.4rem',
                    fontSize: '0.78rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <span>
                    <strong
                      style={{
                        color: 'var(--text-primary)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {finished}
                    </strong>{' '}
                    of {total} processed ({pct}%)
                  </span>
                  <span
                    style={{
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      color: 'var(--accent)',
                    }}
                  >
                    {visibleDone}/{total} matched
                  </span>
                </div>

                {/* Progress track. The bar is built as a 3-segment
                    fill: green (done) | coral (active) | red
                    (failed), so failed cards visibly subtract from
                    the green portion even if the user is focused
                    on the matched count. */}
                <div
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${finished} of ${total} cards processed`}
                  style={{
                    position: 'relative',
                    height: 8,
                    borderRadius: 999,
                    background: 'var(--bg-primary)',
                    overflow: 'hidden',
                    boxShadow: 'inset 0 1px 2px rgba(74,63,56,0.06)',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${pctDone}%`,
                      background:
                        'linear-gradient(90deg, var(--success), color-mix(in srgb, var(--success) 75%, var(--accent)))',
                      transition: 'width 400ms cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${pctDone}%`,
                      top: 0,
                      bottom: 0,
                      width: `${pctActive}%`,
                      background:
                        'linear-gradient(90deg, color-mix(in srgb, var(--accent) 35%, transparent), color-mix(in srgb, var(--accent) 60%, transparent))',
                      backgroundSize: '16px 100%',
                      animation:
                        queueStatus.processing > 0
                          ? 'lp-progress-stripes 1.2s linear infinite'
                          : undefined,
                      transition: 'width 400ms cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: `${pctFailed}%`,
                      background:
                        'linear-gradient(90deg, color-mix(in srgb, var(--danger) 75%, transparent), var(--danger))',
                      transition: 'width 400ms cubic-bezier(0.4,0,0.2,1)',
                    }}
                  />
                </div>

                {/* Status chips. Same shape as the existing
                    .tag / .tag-ptcg etc. classes so they read as
                    native to the design system. */}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.4rem',
                    marginTop: '0.7rem',
                  }}
                >
                  <span className="tag" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                    pending {queueStatus.pending}
                  </span>
                  {queueStatus.processing > 0 && (
                    <span className="tag" style={{ background: 'rgba(212,160,92,0.18)', color: 'var(--warning)' }}>
                      processing {queueStatus.processing}
                    </span>
                  )}
                  <span className="tag" style={{ background: 'rgba(124,184,140,0.18)', color: 'var(--success)' }}>
                    matched {visibleDone}
                  </span>
                  {visibleFailed > 0 && (
                    <span className="tag" style={{ background: 'rgba(212,120,120,0.18)', color: 'var(--danger)' }}>
                      failed {visibleFailed}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        )
      })()}

      {/* Empty state — different messages per filter so the user
          knows whether the queue is genuinely empty vs. just
          filtered out by their search term. Verified/Rejected
          tabs say so plainly when there are simply no cards in
          that bucket. */}
      {!loading && filtered.length === 0 && (
        <div className="lp-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ margin: 0 }}>
            {rows.length === 0
              ? 'No cards have a snkrdunk_apparel_id yet. Run scripts/discover_snkrdunk_apparel_ids.py first.'
              : searchTerm.trim()
                ? 'No cards match this filter.'
                : filter === 'unverified'
                  ? 'No cards waiting to be verified'
                  : filter === 'rejected'
                    ? 'No cards is rejected'
                    : filter === 'verified'
                      ? 'No cards have been verified yet'
                      : 'No cards match this filter.'}
          </p>
        </div>
      )}

      {/* Verified queue: table view of all confirmed cards. The
          side-by-side comparison is overkill here — once a card is
          marked verified there's nothing to decide, only to audit.
          So we render a single table with one row per card, showing
          card identity, SNKRDUNK apparel_id, status badge, and the
          verified_at timestamp. */}
      {filter === 'verified' && filtered.length > 0 && !loading && (
        <div
          className="lp-card"
          style={{ padding: 0, marginBottom: '1rem', overflowX: 'auto' }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.85rem',
              minWidth: 720,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                }}
              >
                <th style={{ padding: '0.65rem 0.75rem' }}>Card</th>
                <th style={{ padding: '0.65rem 0.75rem' }}>SNKRDUNK</th>
                <th style={{ padding: '0.65rem 0.75rem' }}>Status</th>
                <th style={{ padding: '0.65rem 0.75rem' }}>Verified at</th>
                <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(({ r }) => (
                <tr
                  key={r.id}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    verticalAlign: 'middle',
                  }}
                >
                  <td style={{ padding: '0.55rem 0.75rem' }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        minWidth: 0,
                      }}
                    >
                      <img
                        src={yuyuteiImageUrl(r)}
                        alt={r.card_name || r.id}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        style={{
                          width: 40,
                          height: 56,
                          objectFit: 'contain',
                          borderRadius: 4,
                          background: '#fff',
                          flex: '0 0 auto',
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {r.card_name || r.id}
                        </div>
                        <div
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--text-secondary)',
                            fontFamily: 'ui-monospace, monospace',
                          }}
                        >
                          {r.tcg_type} · {r.card_series} · {r.card_index || '—'} ·{' '}
                          {r.card_rarity || '—'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '0.55rem 0.75rem' }}>
                    {r.snkrdunk_apparel_id ? (
                      <a
                        href={snkrdunkProductUrl(r.snkrdunk_apparel_id)}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontFamily: 'ui-monospace, monospace',
                          color: 'var(--accent)',
                          textDecoration: 'none',
                        }}
                      >
                        {r.snkrdunk_apparel_id}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '0.55rem 0.75rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.55rem',
                        borderRadius: 999,
                        background:
                          r.verify_status === 'verified'
                            ? 'color-mix(in srgb, var(--accent) 18%, transparent)'
                            : 'color-mix(in srgb, #c0392b 18%, transparent)',
                        color:
                          r.verify_status === 'verified'
                            ? 'var(--accent)'
                            : '#c0392b',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        letterSpacing: '0.03em',
                        textTransform: 'uppercase',
                      }}
                    >
                      {r.verify_status ?? 'unverified'}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 0.75rem',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.verified_at
                      ? new Date(r.verified_at).toLocaleString()
                      : '—'}
                  </td>
                  <td
                    style={{
                      padding: '0.55rem 0.75rem',
                      textAlign: 'right',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => void setVerdict(null, r)}
                      style={{
                        fontSize: '0.75rem',
                        padding: '0.25rem 0.55rem',
                      }}
                      title="Reset this card to unverified"
                    >
                      clear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel — only shown for Unverified / Rejected queues.
          The Verified queue uses the table view above. */}
      {filter !== 'verified' && currentCard && (
        <div className="lp-card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          {/* Header: id + counter (skip / prev/next merged into the action bar below) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', minWidth: 0 }}>
              <code
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  fontFamily: 'ui-monospace, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentCard.id}
              </code>
              {currentCard.verify_status !== null && (
                <button
                  type="button"
                  onClick={() => void setVerdict(null)}
                  className="btn"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                  title="Reset this card to unverified"
                >
                  clear verdict
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goTo(-1)}
                disabled={filtered.findIndex(x => x.originalIdx === cursor) <= 0}
                aria-label="Previous card"
                title="Previous card"
                style={{ padding: '0.3rem 0.55rem' }}
              >
                ←
              </button>
              <span
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.8rem',
                  padding: '0 0.35rem',
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 48,
                  textAlign: 'center',
                }}
              >
                {filtered.length === 0
                  ? '0 / 0'
                  : `${filtered.findIndex(x => x.originalIdx === cursor) + 1} / ${filtered.length}`}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goTo(1)}
                disabled={
                  filtered.findIndex(x => x.originalIdx === cursor) >= filtered.length - 1
                }
                aria-label="Next card"
                title="Next card"
                style={{ padding: '0.3rem 0.55rem' }}
              >
                →
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns,
              gap: '1rem',
              alignItems: 'start',
            }}
          >
            {/* LEFT: master_table card image + meta */}
            <CardSide
              title="master_table"
              metaLines={[
                ['TCG', currentCard.tcg_type],
                ['Series', currentCard.card_series],
                ['Index', currentCard.card_index],
                ['Rarity', currentCard.card_rarity],
                ['Name', currentCard.card_name || '—'],
              ]}
              imageUrl={yuyuteiImageUrl(currentCard)}
              imageLabel="yuyu-tei front scan"
              fallbackHint={`card.yuyu-tei.jp/.../${currentCard.card_series}/${(currentCard.url_yuyutei ?? '').split('/').pop()}`}
              onImageLoad={img => reportImageMetrics(img, 'yuyutei')}
            />

            {/* RIGHT: SNKRDUNK card image + meta */}
            <CardSide
              title="SNKRDUNK"
              metaLines={[
                ['apparel_id', currentCard.snkrdunk_apparel_id ?? '—'],
                [
                  'Title',
                  currentMeta?.title || (currentMetaLoading ? 'loading…' : '—'),
                ],
                [
                  'Status',
                  currentCard.verify_status
                    ? currentCard.verify_status.toUpperCase()
                    : 'unverified',
                ],
                [
                  'Verified at',
                  currentCard.verified_at
                    ? new Date(currentCard.verified_at).toLocaleString()
                    : '—',
                ],
              ]}
              imageUrl={currentMeta?.image ? snkrdunkProxiedImageUrl(currentMeta.image) : ''}
              imageLabel="SNKRDUNK product image"
              fallbackHint={`snkrdunk.com/apparels/${currentCard.snkrdunk_apparel_id}`}
              href={
                currentCard.snkrdunk_apparel_id
                  ? snkrdunkProductUrl(currentCard.snkrdunk_apparel_id)
                  : undefined
              }
              loading={currentMetaLoading}
              cropWhite
              onImageLoad={img => reportImageMetrics(img, 'snkrdunk')}
            />
          </div>

          {/* Action bar — three zones:
                [secondary] Reassign · Refresh SNKRDUNK · Skip to next unverified
                [spacer]
                [primary]   Reject · Confirm  */}
          <div
            style={{
              marginTop: '1.25rem',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border)',
            }}
          >
            <ReassignControl
              current={currentCard.snkrdunk_apparel_id ?? ''}
              onApply={a => void reassignApparelId(a)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                if (currentCard.snkrdunk_apparel_id) {
                  setMetaCache(prev => {
                    const n = { ...prev }
                    delete n[currentCard.snkrdunk_apparel_id ?? '']
                    return n
                  })
                  void prefetchMeta(currentCard.snkrdunk_apparel_id)
                }
              }}
              disabled={!currentCard.snkrdunk_apparel_id}
              title="Discard cached SNKRDUNK metadata and re-fetch"
            >
              {currentMetaLoading ? 'Refreshing…' : '↻ Refresh image'}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => goToNextUnverified()}
              title="Skip to next unverified card"
            >
              Skip unverified →
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void setVerdict('rejected')}
              disabled={currentCard.verify_status === 'rejected'}
              style={{ minWidth: 110 }}
            >
              ✖ Reject
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void setVerdict('verified')}
              disabled={currentCard.verify_status === 'verified'}
              style={{ minWidth: 110 }}
            >
              ✓ Confirm
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function CardSide({
  title,
  metaLines,
  imageUrl,
  imageLabel,
  fallbackHint,
  href,
  loading,
  cropWhite = false,
  onImageLoad,
}: {
  title: string
  metaLines: [string, string][]
  imageUrl: string
  imageLabel: string
  fallbackHint: string
  href?: string
  loading?: boolean
  /**
   * When true, the image is post-processed client-side to trim any pure-
   * white border on all four sides. The crop is performed after the
   * <img> loads: we draw it to an offscreen canvas, walk inward from
   * each edge until we hit a non-white pixel, and replace the displayed
   * src with a cropped data URL. Used for the SNKRDUNK side, whose
   * upload_bg_removed product scans ship with sizable white padding.
   */
  cropWhite?: boolean
  /**
   * Fires after the <img> loads (before any crop is applied). The
   * parent uses this to read the image's natural aspect ratio so it
   * can size the two grid columns proportionally and make both
   * images render at the same visual height.
   */
  onImageLoad?: (img: HTMLImageElement) => void
}) {
  // Memoized cache of original-URL → cropped data URL, so the crop only
  // runs once per distinct image (not on every render). Keyed by the
  // *original* URL so re-mounts with the same image skip the work.
  const [croppedSrc, setCroppedSrc] = useState<string | null>(null)
  const [cropping, setCropping] = useState(false)

  // Reset the cropped cache whenever the source changes.
  useEffect(() => {
    setCroppedSrc(null)
    setCropping(false)
  }, [imageUrl])

  // Run the crop after the image finishes loading. We piggyback on the
  // <img>'s onLoad below — no second network request.
  const handleImageLoaded = useCallback(
    async (img: HTMLImageElement) => {
      // Notify the parent first so it can capture the aspect ratio
      // (and any other metrics) before we hand off to cropping.
      onImageLoad?.(img)
      if (!cropWhite) return
      if (cropping) return
      try {
        setCropping(true)
        const dataUrl = await trimWhiteBorders(img)
        if (dataUrl) setCroppedSrc(dataUrl)
      } catch {
        // Swallow — fall back to the original src. We don't want a
        // canvas/CORS quirk to break the page.
      } finally {
        setCropping(false)
      }
    },
    [cropWhite, cropping, onImageLoad],
  )

  // Pick the effective src: a cropped data URL if we have one, else the
  // original. While the crop is in-flight we keep showing the original
  // (the image element below already triggered onLoad for it).
  const effectiveSrc = croppedSrc ?? imageUrl

  const inner = (
    <div
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '0.875rem',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div
        style={{
          width: '100%',
          // Square container — the parent grid column is sized to the
          // image's aspect ratio, so the image fills it edge-to-edge
          // with object-fit: contain. The result: both images render
          // at the same visual height regardless of aspect.
          aspectRatio: '1 / 1',
          background: '#fff',
          borderRadius: 8,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {effectiveSrc ? (
          <img
            src={effectiveSrc}
            alt={imageLabel}
            loading="lazy"
            // `crossOrigin: 'anonymous'` opts the <img> into CORS mode
            // so the browser will reject the response unless the
            // server returns a matching Access-Control-Allow-Origin
            // header. Without this, drawing the image to a canvas
            // taints it (SecurityError on getImageData) — which is
            // exactly what happens when we try to crop a
            // cross-origin image without CORS headers. We only set it
            // when we actually need to read pixel data (cropWhite).
            // Yuyu-tei's CDN already serves CORS-clean images, so
            // there's no downside — but for safety we keep it scoped.
            {...(cropWhite ? { crossOrigin: 'anonymous' as const } : {})}
            referrerPolicy="no-referrer"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              transition: 'opacity 200ms',
              opacity: loading ? 0.4 : 1,
            }}
            onLoad={e => void handleImageLoaded(e.currentTarget)}
            onError={e => {
              const t = e.currentTarget
              t.style.display = 'none'
              const placeholder = t.nextElementSibling as HTMLElement | null
              if (placeholder) placeholder.style.display = 'flex'
            }}
          />
        ) : null}

        <div
          style={{
            display: effectiveSrc ? 'none' : 'flex',
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 4,
            color: 'var(--text-secondary)',
            padding: '1rem',
            textAlign: 'center',
            fontSize: '0.85rem',
          }}
        >
          {loading ? 'fetching…' : 'no image'}
          <code
            style={{ fontSize: '0.7rem', opacity: 0.7, wordBreak: 'break-all' }}
          >
            {fallbackHint}
          </code>
        </div>
      </div>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: '70px 1fr',
          gap: '0.25rem 0.75rem',
          fontSize: '0.85rem',
        }}
      >
        {metaLines.map(([k, v]) => (
          <FragmentRow key={k} k={k} v={v} />
        ))}
      </dl>
    </div>
  )
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      {inner}
    </a>
  ) : (
    inner
  )
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={{ color: 'var(--text-secondary)' }}>{k}</dt>
      <dd
        style={{
          margin: 0,
          wordBreak: 'break-word',
          fontFamily: k === 'apparel_id' || k === 'Index' ? 'ui-monospace, monospace' : undefined,
        }}
      >
        {v}
      </dd>
    </>
  )
}

function ReassignControl({
  current,
  onApply,
}: {
  current: string
  onApply: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState(current)
  useEffect(() => setVal(current), [current])
  if (!open) {
    return (
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setVal(current)
          setOpen(true)
        }}
      >
        Reassign…
      </button>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: '0.375rem', alignItems: 'center' }}>
      <input
        type="text"
        className="form-input"
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="new apparel_id"
        style={{ width: 110 }}
        aria-label="New SNKRDUNK apparel_id"
        autoFocus
      />
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => onApply(val)}
        disabled={val === current}
      >
        Apply
      </button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </span>
  )
}
