import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { CardDefinition } from '../lib/types'
import { PTCG_SERIES, OPCG_SERIES, PTCG_RARITIES, OPCG_RARITIES } from '../lib/types'
import { makeCardId } from '../lib/cardId'

type TcgType = 'PTCG' | 'OPCG'

interface PreviewCard {
  tcg_type: TcgType
  card_series: string
  card_index: string
  card_name: string
  card_rarity: string
  url_yuyutei: string
  image_url: string
}

type Stage = 'input' | 'preview'

function isValidYuyuteiUrl(url: string): boolean {
  if (!url) return false
  try {
    const u = new URL(url)
    return u.hostname.endsWith('yuyu-tei.jp')
  } catch {
    return false
  }
}

// Local dev fallback so you can test the flow without deploying the Edge Function.
// Set VITE_YUYUTEI_PARSE_URL to your deployed function URL, e.g.
//   VITE_YUYUTEI_PARSE_URL=https://<project>.supabase.co/functions/v1/yuyutei-parse
const PARSE_URL = import.meta.env.VITE_YUYUTEI_PARSE_URL as string | undefined

export default function DatabasePage() {
  const { user } = useAuth()
  const [cards, setCards] = useState<CardDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [stage, setStage] = useState<Stage>('input')
  const [url, setUrl] = useState('')
  const [preview, setPreview] = useState<PreviewCard | null>(null)
  const [batch, setBatch] = useState<PreviewCard[]>([])
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTcg, setFilterTcg] = useState<'all' | TcgType>('all')

  useEffect(() => {
    if (!user) return
    loadCards()
  }, [user])

  async function loadCards() {
    setLoading(true)
    const { data, error: e } = await supabase
      .from('master_table')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (e) setError(e.message)
    if (data) setCards(data as CardDefinition[])
    setLoading(false)
  }

  function startOver() {
    setStage('input')
    setUrl('')
    setPreview(null)
    setBatch([])
    setError(null)
    setSuccess(null)
  }

  async function handleFetch() {
    setError(null)
    setSuccess(null)

    if (!isValidYuyuteiUrl(url)) {
      setError('Please paste a valid yuyu-tei.jp URL')
      return
    }

    setParsing(true)
    try {
      let result: PreviewCard
      if (PARSE_URL) {
        const r = await fetch(PARSE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
        result = data as PreviewCard
      } else {
        // Dev fallback: use the Python parser via a tiny relative endpoint,
        // or if neither is available, fall back to URL-only extraction.
        result = await parseLocally(url)
      }
      setPreview(result)
      setStage('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setParsing(false)
    }
  }

  function addToBatch() {
    if (!preview) return
    setError(null)
    // Add the current edit to the batch and return to the input form.
    // The batch preview table is shown inline at the bottom of the form.
    setBatch(prev => [...prev, preview])
    setPreview(null)
    setUrl('')
    setStage('input')
  }

  function removeFromBatch(idx: number) {
    setBatch(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleAddToDb() {
    if (batch.length === 0) return
    setError(null)
    setSubmitting(true)

    const rows = batch.map(c => ({
      id: makeCardId({
        tcg_type: c.tcg_type,
        card_series: c.card_series,
        card_index: c.card_index,
        card_rarity: c.card_rarity,
        url_yuyutei: c.url_yuyutei,
      }),
      tcg_type: c.tcg_type,
      card_series: c.card_series,
      card_index: c.card_index,
      card_name: c.card_name,
      card_rarity: c.card_rarity,
      url_yuyutei: c.url_yuyutei,
    }))

    const { error: insertError } = await supabase.from('master_table').insert(rows)

    setSubmitting(false)
    if (insertError) {
      setError(insertError.message)
      return
    }
    const count = batch.length
    setSuccess(
      `Added ${count} card${count === 1 ? '' : 's'} to the master database.`,
    )
    setBatch([])
    await loadCards()
  }

  function updatePreview(patch: Partial<PreviewCard>) {
    setPreview(prev => (prev ? { ...prev, ...patch } : prev))
  }

  const rarities = preview
    ? preview.tcg_type === 'PTCG' ? PTCG_RARITIES : OPCG_RARITIES
    : PTCG_RARITIES
  const seriesList = preview
    ? preview.tcg_type === 'PTCG' ? PTCG_SERIES : OPCG_SERIES
    : PTCG_SERIES

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase()
    return cards.filter(c => {
      if (filterTcg !== 'all' && c.tcg_type !== filterTcg) return false
      if (!q) return true
      return (
        c.card_series.toLowerCase().includes(q) ||
        c.card_index.toLowerCase().includes(q) ||
        c.card_name.toLowerCase().includes(q) ||
        c.card_rarity.toLowerCase().includes(q)
      )
    })
  }, [cards, searchTerm, filterTcg])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Card Database</h1>
          <p className="page-subtitle">
            Add new cards to the master list by pasting a yuyu-tei.jp product URL.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowForm(s => !s)
            startOver()
          }}
        >
          {showForm ? 'Cancel' : '+ Add Card'}
        </button>
      </div>

      {showForm && (
        <>
        <div className="lp-card" style={{ marginBottom: '1rem' }}>
          {stage === 'input' && (
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
              onSubmit={(e) => {
                e.preventDefault()
                if (!parsing && url) handleFetch()
              }}
            >
              <div className="form-field">
                <label className="form-label">Yuyutei URL</label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://yuyu-tei.jp/sell/poc/card/s12a/10262"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !parsing && url) {
                      e.preventDefault()
                      handleFetch()
                    }
                  }}
                />
                <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  Tip: open any product page on yuyu-tei.jp and copy its URL. Press <kbd>Enter</kbd> to fetch.
                </p>
              </div>
              {error && <div className="form-alert form-alert--error">{error}</div>}
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={parsing || !url}
                >
                  {parsing ? 'Fetching…' : 'Fetch Details'}
                </button>
              </div>
            </form>
          )}

          {stage === 'preview' && preview && (
            <form
              style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
              onSubmit={(e) => { e.preventDefault(); addToBatch() }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="tag tag-ptcg" style={{ background: 'rgba(124,184,140,0.18)', color: 'var(--success)' }}>
                  ✓ Found
                </span>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Review the details below, edit if needed, then add to the batch.
                  {batch.length > 0 && ` (${batch.length} already in batch)`}
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '1rem' }}>
                <div
                  style={{
                    width: 160,
                    height: 224,
                    borderRadius: 12,
                    background: 'var(--bg-primary)',
                    border: '1.5px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={preview.image_url}
                    alt="card preview"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => {
                      ;(e.currentTarget as HTMLImageElement).style.display = 'none'
                    }}
                  />
                </div>

                <div className="form-grid">
                  <div className="form-field">
                    <label className="form-label">TCG</label>
                    <select
                      className="input"
                      value={preview.tcg_type}
                      onChange={e => updatePreview({ tcg_type: e.target.value as TcgType, card_series: '', card_rarity: '' })}
                    >
                      <option value="PTCG">PTCG</option>
                      <option value="OPCG">OPCG</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Series</label>
                    <input
                      list="series-options"
                      className="input"
                      value={preview.card_series}
                      onChange={e => updatePreview({ card_series: e.target.value })}
                    />
                    <datalist id="series-options">
                      {seriesList.map(s => <option key={s} value={s} />)}
                    </datalist>
                  </div>
                  <div className="form-field">
                    <label className="form-label">Card #</label>
                    <input
                      className="input"
                      value={preview.card_index}
                      onChange={e => updatePreview({ card_index: e.target.value })}
                    />
                  </div>
                  <div className="form-field">
                    <label className="form-label">Rarity</label>
                    <input
                      list="rarity-options"
                      className="input"
                      value={preview.card_rarity}
                      onChange={e => updatePreview({ card_rarity: e.target.value })}
                    />
                    <datalist id="rarity-options">
                      {rarities.map(r => <option key={r} value={r} />)}
                    </datalist>
                  </div>
                  <div className="form-field form-field--full">
                    <label className="form-label">Card Name</label>
                    <input
                      className="input"
                      value={preview.card_name}
                      onChange={e => updatePreview({ card_name: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              {error && <div className="form-alert form-alert--error">{error}</div>}

              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={startOver}>
                  ← Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!preview.card_series || !preview.card_index || !preview.card_rarity}
                >
                  + Add to Batch
                </button>
              </div>
            </form>
          )}
        </div>

        {success && (
          <div
            className="form-alert form-alert--success"
            style={{
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>✓</span>
            <span style={{ flex: 1 }}>{success}</span>
            <button
              type="button"
              onClick={() => setSuccess(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                padding: '0.1rem 0.4rem',
              }}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}

        {batch.length > 0 && (
          <div
            className="lp-card"
            style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span
                className="tag"
                style={{
                  background: 'rgba(155, 184, 224, 0.18)',
                  color: 'var(--accent)',
                }}
              >
                Batch preview
              </span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {batch.length} card{batch.length === 1 ? '' : 's'} ready to add. Review below.
              </span>
            </div>

            <div
              className="lp-card table-card"
              style={{
                margin: 0,
                padding: 0,
                overflow: 'auto',
              }}
            >
              <table className="data-table" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th>TCG</th>
                    <th>Series</th>
                    <th>Card #</th>
                    <th>Rarity</th>
                    <th>Name</th>
                    <th>Generated ID</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {batch.map((c, idx) => {
                    const id = makeCardId({
                      tcg_type: c.tcg_type,
                      card_series: c.card_series,
                      card_index: c.card_index,
                      card_rarity: c.card_rarity,
                      url_yuyutei: c.url_yuyutei,
                    })
                    return (
                      <tr key={idx}>
                        <td>
                          <span className={`tag tag-${c.tcg_type.toLowerCase()}`}>
                            {c.tcg_type}
                          </span>
                        </td>
                        <td>{c.card_series}</td>
                        <td>{c.card_index}</td>
                        <td>{c.card_rarity}</td>
                        <td>{c.card_name || '—'}</td>
                        <td>
                          <code
                            style={{
                              fontSize: '0.72rem',
                              padding: '0.15rem 0.4rem',
                              borderRadius: 4,
                              background: 'var(--bg-primary)',
                              border: '1px solid var(--border)',
                              wordBreak: 'break-all',
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}
                          >
                            {id}
                          </code>
                        </td>
                        <td>
                          <button
                            type="button"
                            aria-label="Remove from batch"
                            title="Remove from batch"
                            onClick={() => removeFromBatch(idx)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: 'var(--text-secondary)',
                              cursor: 'pointer',
                              fontSize: '1rem',
                              padding: '0.25rem 0.4rem',
                              lineHeight: 1,
                            }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {error && <div className="form-alert form-alert--error">{error}</div>}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setBatch([])}
              >
                Clear batch
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={submitting || batch.length === 0}
                onClick={handleAddToDb}
              >
                {submitting
                  ? 'Saving…'
                  : `Add ${batch.length} card${batch.length === 1 ? '' : 's'} to database`}
              </button>
            </div>
          </div>
        )}
        </>
      )}

      <div className="toolbar">
        <input
          className="input toolbar__search"
          placeholder="Search by series, number, name, or rarity…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        <select
          className="input toolbar__filter"
          value={filterTcg}
          onChange={e => setFilterTcg(e.target.value as 'all' | TcgType)}
        >
          <option value="all">All TCG</option>
          <option value="PTCG">PTCG only</option>
          <option value="OPCG">OPCG only</option>
        </select>
      </div>

      {loading ? (
        <div className="lp-card empty-state">
          <div className="empty-state-text">Loading database…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="lp-card empty-state">
          <div className="empty-state-icon">◇</div>
          <div className="empty-state-text">
            {cards.length === 0
              ? 'No cards yet. Click "+ Add Card" to add the first one.'
              : 'No cards match your search.'}
          </div>
        </div>
      ) : (
        <div className="lp-card table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>TCG</th>
                <th>Series</th>
                <th>Card #</th>
                <th>Rarity</th>
                <th>Name</th>
                <th>Yuyutei</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>
                    <span className={`tag tag-${c.tcg_type.toLowerCase()}`}>
                      {c.tcg_type}
                    </span>
                  </td>
                  <td>{c.card_series}</td>
                  <td>{c.card_index}</td>
                  <td>{c.card_rarity}</td>
                  <td>{c.card_name || '—'}</td>
                  <td>
                    {c.url_yuyutei ? (
                      <a
                        href={c.url_yuyutei}
                        target="_blank"
                        rel="noreferrer"
                        className="link"
                      >
                        open ↗
                      </a>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-foot">
            Showing {filtered.length} of {cards.length} most recent cards
          </div>
        </div>
      )}
    </>
  )
}

// Used as a fallback when the Edge Function isn't deployed yet — does
// best-effort extraction from the URL alone. The user fills the rest in
// the preview form.
async function parseLocally(url: string): Promise<PreviewCard> {
  const u = new URL(url)
  const parts = u.pathname.split('/').filter(Boolean)
  const tcgMap: Record<string, TcgType> = { poc: 'PTCG', opc: 'OPCG' }
  const imgMap: Record<TcgType, string> = { PTCG: 'poc', OPCG: 'opc' }

  const tcg_code = (parts[1] || '').toLowerCase()
  const tcg_type: TcgType = tcgMap[tcg_code] ?? 'PTCG'
  const series = (parts[3] || '').toLowerCase()
  const slug_id = parts[4] || ''
  const image_url = `https://card.yuyu-tei.jp/${imgMap[tcg_type]}/front/${series}/${slug_id}.jpg`

  return {
    tcg_type,
    card_series: series,
    card_index: '',
    card_name: '',
    card_rarity: '',
    url_yuyutei: url,
    image_url,
  }
}