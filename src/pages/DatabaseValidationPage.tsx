import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const slug = url.split('/').filter(Boolean).pop() ?? ''
  const tcgPath = card.tcg_type === 'PTCG' ? 'poc' : 'opc'
  return `https://card.yuyu-tei.jp/${tcgPath}/front/${card.card_series}/${slug}.jpg`
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

  // Index of the card currently displayed in the detail panel
  const [cursor, setCursor] = useState(0)
  const [filter, setFilter] = useState<'unverified' | 'verified' | 'rejected' | 'all'>('unverified')
  const [searchTerm, setSearchTerm] = useState('')

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const r = await supabase
        .from('master_table')
        .select(
          'id,tcg_type,card_series,card_index,card_name,card_rarity,url_yuyutei,snkrdunk_apparel_id,verified_at,verify_status',
        )
        .not('snkrdunk_apparel_id', 'is', null)
        .order('verify_status', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: true })
        .limit(500)
      if (r.error) throw r.error
      const data = (r.data ?? []) as CardRow[]
      setRows(data)
      setCursor(0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load])

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

  // After filter changes, clamp the cursor to a valid position.
  useEffect(() => {
    if (filtered.length === 0) {
      if (cursor !== 0) setCursor(0)
      return
    }
    const currentInFiltered = filtered.findIndex(x => x.originalIdx === cursor)
    if (currentInFiltered === -1) setCursor(filtered[0].originalIdx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, searchTerm])

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
  const currentCard = rows[cursor] ?? null
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
  async function setVerdict(status: 'verified' | 'rejected' | null) {
    if (!currentCard) return
    if (status === null) {
      // "Clear verdict" — reset both columns; falls back to the
      // queue so the user can re-review.
      const r = await supabase
        .from('master_table')
        .update({ verify_status: null, verified_at: null })
        .eq('id', currentCard.id)
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
        .eq('id', currentCard.id)
      if (r.error) {
        setError(r.error.message)
        return
      }
    }
    // Optimistic local update — we don't want to wait for a re-fetch
    // just to advance the cursor.
    setRows(prev =>
      prev.map(r =>
        r.id === currentCard.id
          ? {
              ...r,
              verify_status: status,
              verified_at: status === null ? null : new Date().toISOString(),
            }
          : r,
      ),
    )
    // Brief sleep so the user feels the action registered before we
    // jump to the next card. 250ms is short enough to feel snappy.
    await SLEEP_MS(250)
    goToNextUnverified()
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
  const counts = useMemo(() => {
    const c = { unverified: 0, verified: 0, rejected: 0 }
    for (const r of rows) {
      if (r.verify_status === null) c.unverified++
      else if (r.verify_status === 'verified') c.verified++
      else if (r.verify_status === 'rejected') c.rejected++
    }
    return c
  }, [rows])

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
          {(['unverified', 'verified', 'rejected', 'all'] as const).map(f => {
            const active = filter === f
            const count =
              f === 'unverified' ? counts.unverified
              : f === 'verified' ? counts.verified
              : f === 'rejected' ? counts.rejected
              : rows.length
            return (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={active}
                className="btn"
                onClick={() => setFilter(f)}
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
            : `${filtered.findIndex(x => x.originalIdx === cursor) + 1} / ${filtered.length}`}
        </div>
      </div>

      {error && (
        <div className="form-alert form-alert--error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="lp-card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ margin: 0 }}>
            {rows.length === 0
              ? 'No cards have a snkrdunk_apparel_id yet. Run scripts/discover_snkrdunk_apparel_ids.py first.'
              : 'No cards match this filter.'}
          </p>
        </div>
      )}

      {/* Detail panel */}
      {currentCard && (
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
