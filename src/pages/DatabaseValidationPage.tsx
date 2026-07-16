import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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

/** Fetch the SNKRDUNK og:image + og:title for an apparel_id. We hit
 * the public HTML page (no auth required) and parse the OG tags.
 * If the fetch fails, the page degrades gracefully to a "no image"
 * placeholder. */
async function fetchSnkrdunkMeta(apparel_id: string): Promise<SnkrdunkMetadata> {
  const url = snkrdunkProductUrl(apparel_id)
  try {
    const r = await fetch(url, {
      headers: { Accept: 'text/html' },
      // No credentials. Public page.
      cache: 'no-store',
    })
    if (!r.ok) {
      return { apparel_id, title: '', image: '', brand: '', fetched: false }
    }
    const html = await r.text()
    const ogTitle =
      html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ??
      ''
    const ogImage =
      html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] ??
      ''
    const ogSite =
      html.match(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i)?.[1] ??
      ''
    return {
      apparel_id,
      title: ogTitle || '',
      image: ogImage || '',
      brand: ogSite || '',
      fetched: true,
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
  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return rows
      .filter(r => {
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
      .map((r, i) => ({ r, i: rows.indexOf(r) })) // preserve original idx for cursor
      .map(x => x)
  }, [rows, filter, searchTerm])

  // After filter changes, clamp the cursor to a valid position.
  useEffect(() => {
    if (filtered.length === 0) {
      if (cursor !== 0) setCursor(0)
      return
    }
    const currentInFiltered = filtered.findIndex(x => x.i === cursor)
    if (currentInFiltered === -1) setCursor(filtered[0].i)
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
    const myIdx = filtered.findIndex(x => x.i === cursor)
    if (myIdx === -1) return
    for (let off = 1; off <= 3 && myIdx + off < filtered.length; off++) {
      const next = rows[filtered[myIdx + off].i]
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
    const myIdx = filtered.findIndex(x => x.i === cursor)
    const base = myIdx === -1 ? 0 : myIdx
    const nextIdx = Math.min(filtered.length - 1, Math.max(0, base + delta))
    setCursor(filtered[nextIdx].i)
  }

  function goToNextUnverified() {
    if (filtered.length === 0) return
    const myIdx = filtered.findIndex(x => x.i === cursor)
    const base = myIdx === -1 ? -1 : myIdx
    for (let off = 1; base + off < filtered.length; off++) {
      const cand = rows[filtered[base + off].i]
      if (cand.verify_status === null) {
        setCursor(filtered[base + off].i)
        return
      }
    }
    // No more unverified in the current filter; just advance by 1.
    if (base + 1 < filtered.length) setCursor(filtered[base + 1].i)
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
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link to="/database" className="btn btn-ghost">← Database</Link>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filter / progress strip */}
      <div
        className="lp-card"
        style={{
          marginBottom: '1rem',
          padding: '0.875rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {(['unverified', 'verified', 'rejected', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              className={`btn ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f)}
            >
              {f === 'unverified'
                ? `Unverified (${counts.unverified})`
                : f === 'verified'
                  ? `Verified (${counts.verified})`
                  : f === 'rejected'
                    ? `Rejected (${counts.rejected})`
                    : `All (${rows.length})`}
            </button>
          ))}
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
            : `${filtered.findIndex(x => x.i === cursor) + 1} / ${filtered.length}`}
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
          {/* Header: id + navigation */}
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
            <code
              style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {currentCard.id}
            </code>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goTo(-1)}
                disabled={filtered.findIndex(x => x.i === cursor) <= 0}
              >
                ←
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goToNextUnverified()}
                title="Skip to next unverified"
              >
                Next unverified »
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goTo(1)}
                disabled={
                  filtered.findIndex(x => x.i === cursor) >= filtered.length - 1
                }
              >
                »
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
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
              imageUrl={currentMeta?.image || ''}
              imageLabel="SNKRDUNK product image"
              fallbackHint={`snkrdunk.com/apparels/${currentCard.snkrdunk_apparel_id}`}
              href={
                currentCard.snkrdunk_apparel_id
                  ? snkrdunkProductUrl(currentCard.snkrdunk_apparel_id)
                  : undefined
              }
              loading={currentMetaLoading}
            />
          </div>

          {/* Action bar */}
          <div
            className="form-actions"
            style={{
              marginTop: '1.25rem',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}
          >
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => goTo(-1)}
            >
              ← Prev
            </button>
            <div style={{ flex: 1 }} />
            {currentCard.snkrdunk_apparel_id && (
              <a
                href={snkrdunkProductUrl(currentCard.snkrdunk_apparel_id)}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-ghost"
              >
                Open SNKRDUNK ↗
              </a>
            )}
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
            >
              {currentMetaLoading ? 'Refreshing…' : 'Re-fetch SNKRDUNK'}
            </button>
            {currentCard.verify_status !== null && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void setVerdict(null)}
              >
                Clear verdict
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void setVerdict('rejected')}
              disabled={currentCard.verify_status === 'rejected'}
            >
              ✖ Reject
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void setVerdict('verified')}
              disabled={currentCard.verify_status === 'verified'}
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
}: {
  title: string
  metaLines: [string, string][]
  imageUrl: string
  imageLabel: string
  fallbackHint: string
  href?: string
  loading?: boolean
}) {
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
        {imageUrl ? (
          <img
            src={imageUrl}
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
            display: imageUrl ? 'none' : 'flex',
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
