import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [deleting, setDeleting] = useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTcg, setFilterTcg] = useState<'all' | TcgType>('all')

  // Import-from-yuyutei state
  const [importOpen, setImportOpen] = useState(false)
  // The detected TCG ('PTCG' or 'OPCG') for the currently loaded series.
  // Set automatically by the /set-rarities response (no longer user input).
  const [detectedTcg, setDetectedTcg] = useState<TcgType | null>(null)
  // The series slug as resolved by the backend. May differ from the user's
  // input if the slug was zero-padded (e.g. 'sv2a' -> 'sv02a'). All
  // downstream requests, image URLs, and the success message should use
  // this value rather than the original importSeries string.
  const [resolvedSeries, setResolvedSeries] = useState<string>('')
  const [importSeries, setImportSeries] = useState('')
  const [importRarities, setImportRarities] = useState<string[]>([])
  const [availableRarities, setAvailableRarities] = useState<string[]>([])
  const [importedCards, setImportedCards] = useState<PreviewCard[]>([])
  const [importing, setImporting] = useState(false)
  const [importStage, setImportStage] = useState<'select' | 'preview'>('select')
  const importDialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return
    loadCards()
  }, [user])

  // Ref for the delete-confirmation dialog so we can focus it when it opens
  const confirmDeleteRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (confirmDeleteOpen) {
      requestAnimationFrame(() => confirmDeleteRef.current?.focus())
    }
  }, [confirmDeleteOpen])

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

  // ---------- Import from yuyu-tei ----------

  function openImport() {
    setImportOpen(true)
    setImportStage('select')
    setImportSeries('')
    setResolvedSeries('')
    setDetectedTcg(null)
    setAvailableRarities([])
    setImportRarities([])
    setImportedCards([])
    setError(null)
  }

  function closeImport() {
    if (importing) return
    setImportOpen(false)
  }

  // The fetch helpers below all hit `VITE_YUYUTEI_PARSE_URL`. When the
  // browser can't reach the URL at all (server down, cross-device,
  // URL points to a not-yet-deployed host, etc.) the error is a generic
  // "Failed to fetch" / "Load failed" — replace those with a clear
  // message explaining what the user actually needs to do.
  function explainNetworkError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e)
    const looksLikeNetwork =
      /failed to fetch|load failed|networkerror|network request failed/i.test(raw) ||
      // `TypeError` is what `fetch()` throws on a connection failure.
      (e instanceof TypeError && !/json/i.test(raw))
    if (!looksLikeNetwork) return raw

    const url = PARSE_URL ?? '(not configured)'
    const isLocal = /127\.0\.0\.1|localhost/i.test(url)
    // Non-localhost URL that the browser can't reach is almost always
    // a "proxy not deployed yet" situation — give a more specific fix.
    const isPublicHost = !isLocal
    return (
      "Can't reach the yuyu-tei proxy at " +
      url +
      '. The Import from yuyu-tei feature needs a small proxy server ' +
      "because yuyu-tei blocks the deployed site's IP. " +
      (isPublicHost
        ? 'The URL in VITE_YUYUTEI_PARSE_URL points to a public host, ' +
          'but the proxy doesn\'t seem to be running there. ' +
          'If you haven\'t deployed yet, follow scripts/PROXY_DEPLOY.md ' +
          '(Fly.io / Render / VPS) to deploy it. '
        : 'To fix: (1) run `python scripts/parse_server.py` on the same ' +
          'machine as your browser, OR (2) deploy the proxy publicly and ' +
          'point VITE_YUYUTEI_PARSE_URL at it. See scripts/PROXY_DEPLOY.md. ')
    )
  }

  async function loadRaritiesForSeries() {
    if (!importSeries.trim()) {
      setError('Please enter a series slug (e.g. s12a, op15)')
      return
    }
    setError(null)
    setImporting(true)
    try {
      if (!PARSE_URL) {
        throw new Error(
          'VITE_YUYUTEI_PARSE_URL is not configured. ' +
            'Set it in .env (local) or rebuild with a public proxy URL.',
        )
      }
      // The backend auto-detects the TCG from the series slug; we just
      // pass the series and learn the TCG from the response.
      const r = await fetch(`${PARSE_URL.replace('/parse', '')}/set-rarities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: importSeries.trim() }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
      // Filter out raw "-" placeholder (the OPCG DON section header on
      // yuyu-tei) — the synthetic "GOLD-DON" entry replaces it for users.
      const rarities = (data.rarities ?? []).filter(
        (r: string) => r && r !== '-',
      )
      const tcg: TcgType = data.tcg === 'opc' ? 'OPCG' : 'PTCG'
      setDetectedTcg(tcg)
      // The backend may have zero-padded a single-digit run (e.g. sv2a
      // -> sv02a). Persist the slug it actually used so subsequent
      // /set-cards calls and image URLs match the real page.
      setResolvedSeries((data.series ?? importSeries.trim()).toLowerCase())
      setAvailableRarities(rarities)
      setImportRarities([]) // reset selection
    } catch (e) {
      setError(explainNetworkError(e))
      setAvailableRarities([])
      setDetectedTcg(null)
      setResolvedSeries('')
    } finally {
      setImporting(false)
    }
  }

  async function previewImportedCards() {
    if (importRarities.length === 0) {
      setError('Please select at least one rarity')
      return
    }
    if (!detectedTcg) {
      setError('Please load rarities first')
      return
    }
    setError(null)
    setImporting(true)
    setImportedCards([])
    try {
      if (!PARSE_URL) {
        throw new Error(
          'VITE_YUYUTEI_PARSE_URL is not configured. ' +
            'Set it in .env (local) or rebuild with a public proxy URL.',
        )
      }
      const tcg = detectedTcg
      // Use the resolved (possibly padded) series for everything below.
      const seriesSlug = resolvedSeries || importSeries.trim().toLowerCase()
      const collected: PreviewCard[] = []
      for (const rarity of importRarities) {
        const r = await fetch(`${PARSE_URL.replace('/parse', '')}/set-cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ series: seriesSlug, rarity }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`)
        for (const card of data.cards ?? []) {
          collected.push({
            tcg_type: tcg,
            card_series: seriesSlug,
            card_index: card.card_index,
            card_name: card.card_name,
            card_rarity: rarity,
            url_yuyutei: card.url_yuyutei,
            image_url: `https://card.yuyu-tei.jp/${tcg === 'PTCG' ? 'poc' : 'opc'}/front/${seriesSlug}/${card.url_yuyutei.split('/').pop()}.jpg`,
          })
        }
      }
      setImportedCards(collected)
      setImportStage('preview')
    } catch (e) {
      setError(explainNetworkError(e))
    } finally {
      setImporting(false)
    }
  }

  function toggleImportRarity(r: string) {
    setImportRarities(prev =>
      prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r],
    )
  }

  async function handleImportAll() {
    if (importedCards.length === 0) return
    setError(null)
    setImporting(true)
    try {
      const rows = importedCards.map(c => ({
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
      const { error: insertError } = await supabase
        .from('master_table')
        .insert(rows)
      setImporting(false)
      if (insertError) {
        const isDuplicate =
          insertError.code === '23505' ||
          /duplicate key value/i.test(insertError.message) ||
          /unique constraint/i.test(insertError.message)
        if (isDuplicate) {
          setError('Some of these cards already exist in the database!')
        } else {
          setError(insertError.message)
        }
        return
      }
      const count = importedCards.length
      setSuccess(
        `Imported ${count} card${count === 1 ? '' : 's'} from ${(resolvedSeries || importSeries).toUpperCase()}.`,
      )
      setImportOpen(false)
      await loadCards()
    } catch (e) {
      setImporting(false)
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function openConfirmDelete() {
    if (cards.length === 0) return
    setConfirmDeleteOpen(true)
  }

  function closeConfirmDelete() {
    if (deleting) return // can't close while in flight
    setConfirmDeleteOpen(false)
  }

  async function handleConfirmDelete() {
    const count = cards.length
    setConfirmDeleteOpen(false)
    setError(null)
    setSuccess(null)
    setDeleting(true)

    const { error: deleteError } = await supabase
      .from('master_table')
      .delete()
      .neq('id', '') // delete every row (id is never empty)

    setDeleting(false)
    if (deleteError) {
      setError(`Delete failed: ${deleteError.message}`)
      return
    }
    setSuccess(`Deleted ${count} card${count === 1 ? '' : 's'} from the master database.`)
    await loadCards()
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
      // Supabase returns code 23505 (unique_violation) for duplicate keys.
      // The message is something like:
      //   "duplicate key value violates unique constraint \"master_table_pkey\""
      // Translate that into a friendlier message for the user.
      const isDuplicate =
        insertError.code === '23505' ||
        /duplicate key value/i.test(insertError.message) ||
        /unique constraint/i.test(insertError.message)
      if (isDuplicate) {
        setError('This card already exists in the database!')
      } else {
        setError(insertError.message)
      }
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn btn-ghost"
            onClick={openImport}
            title="Bulk-import cards from a yuyu-tei set by series and rarity"
          >
            ⤓ Import from yuyu-tei
          </button>
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
        <button
          type="button"
          className="btn btn-danger"
          onClick={openConfirmDelete}
          disabled={cards.length === 0}
          title="Delete every card from the master database"
        >
          Delete all
        </button>
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

      {confirmDeleteOpen && (
        <div
          ref={confirmDeleteRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
            overflow: 'auto',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeConfirmDelete()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !deleting) {
              e.preventDefault()
              closeConfirmDelete()
            }
          }}
        >
          <div
            className="lp-card"
            style={{
              maxWidth: 440,
              width: '100%',
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              borderTop: '4px solid var(--danger)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: 'rgba(212, 120, 120, 0.18)',
                  color: 'var(--danger)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                ⚠
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '1.1rem',
                    color: 'var(--danger)',
                  }}
                >
                  Delete all cards?
                </h2>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  This is a destructive action
                </span>
              </div>
            </div>

            <div
              style={{
                padding: '0.85rem 1rem',
                borderRadius: 10,
                background: 'var(--bg-card)',
                border: '1.5px solid var(--border)',
                fontSize: '0.9rem',
                lineHeight: 1.5,
                color: 'var(--text-primary)',
              }}
            >
              You are about to permanently delete{' '}
              <strong style={{ color: 'var(--danger)' }}>
                {cards.length} card{cards.length === 1 ? '' : 's'}
              </strong>{' '}
              from the master database. This action{' '}
              <strong>cannot be undone</strong>.
            </div>

            {error && <div className="form-alert form-alert--error">{error}</div>}

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={closeConfirmDelete}
                disabled={deleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleConfirmDelete}
                disabled={deleting}
                autoFocus
              >
                {deleting ? 'Deleting…' : `Yes, delete all ${cards.length}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div
          ref={importDialogRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
            overflow: 'auto',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !importing) {
              e.preventDefault()
              closeImport()
            }
          }}
        >
          <div
            className="lp-card"
            style={{
              maxWidth: 720,
              width: '100%',
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                className="tag"
                style={{
                  background: 'rgba(155, 184, 224, 0.18)',
                  color: 'var(--accent)',
                }}
              >
                {importStage === 'select' ? 'Step 1' : 'Step 2'}
              </span>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  color: 'var(--text-primary)',
                }}
              >
                {importStage === 'select'
                  ? 'Import cards from yuyu-tei'
                  : `Review ${importedCards.length} card${importedCards.length === 1 ? '' : 's'}`}
              </h2>
            </div>

            {importStage === 'select' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                {PARSE_URL && /127\.0\.0\.1|localhost/i.test(PARSE_URL) && (
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-secondary)',
                      background: 'rgba(155, 184, 224, 0.08)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '0.5rem 0.75rem',
                      lineHeight: 1.4,
                    }}
                  >
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Local proxy required.
                    </strong>{' '}
                    The backend at <code>{PARSE_URL}</code> only works when
                    <code> scripts/parse_server.py</code> is running on the same
                    machine as your browser. If you opened this site on a phone or
                    another device, the import will fail. See{' '}
                    <code>scripts/PROXY_DEPLOY.md</code> for a public-deploy option.
                  </div>
                )}
                <div className="form-field">
                  <label className="form-label">Series slug</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. s12a, op15, s11a"
                    value={importSeries}
                    onChange={e => {
                      setImportSeries(e.target.value)
                      setAvailableRarities([])
                      setImportRarities([])
                      setDetectedTcg(null)
                      setResolvedSeries('')
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !importing) {
                        e.preventDefault()
                        loadRaritiesForSeries()
                      }
                    }}
                    autoFocus
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                    The short code from the yuyu-tei URL, e.g. <code>s12a</code> for
                    {' '}<a href="https://yuyu-tei.jp/sell/poc/s/s12a" target="_blank" rel="noreferrer">/sell/poc/s/s12a</a>.
                    The TCG is auto-detected from the slug. Single-digit series
                    like <code>sv2a</code> are auto-padded to <code>sv02a</code>.
                    Press <kbd>Enter</kbd> to load rarities.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={loadRaritiesForSeries}
                  disabled={importing || !importSeries.trim()}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {importing && availableRarities.length === 0
                    ? 'Loading…'
                    : 'Load rarities'}
                </button>

                {availableRarities.length > 0 && (
                  <div className="form-field">
                    <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>Select rarities to import</span>
                      {detectedTcg && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 700,
                            padding: '0.15rem 0.5rem',
                            borderRadius: 6,
                            background: detectedTcg === 'OPCG'
                              ? 'rgba(232, 134, 74, 0.18)'
                              : 'rgba(155, 184, 224, 0.18)',
                            color: detectedTcg === 'OPCG'
                              ? 'rgb(232, 134, 74)'
                              : 'var(--accent)',
                            border: `1px solid ${detectedTcg === 'OPCG' ? 'rgba(232, 134, 74, 0.4)' : 'var(--accent)'}`,
                          }}
                          title="Auto-detected from the series slug"
                        >
                          {detectedTcg}
                        </span>
                      )}
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {availableRarities.map(r => {
                        const selected = importRarities.includes(r)
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => toggleImportRarity(r)}
                            style={{
                              padding: '0.4rem 0.8rem',
                              borderRadius: 8,
                              border: selected
                                ? '2px solid var(--accent)'
                                : '1.5px solid var(--border)',
                              background: selected
                                ? 'rgba(155, 184, 224, 0.18)'
                                : 'var(--bg-primary)',
                              color: selected
                                ? 'var(--accent)'
                                : 'var(--text-primary)',
                              fontWeight: 700,
                              fontSize: '0.8rem',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            {r}
                          </button>
                        )
                      })}
                    </div>
                    {importRarities.length > 0 && (
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                        {importRarities.length} rarit{importRarities.length === 1 ? 'y' : 'ies'} selected
                      </p>
                    )}
                  </div>
                )}

                {error && <div className="form-alert form-alert--error">{error}</div>}

                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={closeImport} disabled={importing}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={previewImportedCards}
                    disabled={importing || importRarities.length === 0}
                  >
                    {importing ? 'Loading cards…' : 'Preview cards →'}
                  </button>
                </div>
              </div>
            )}

            {importStage === 'preview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                <div
                  className="lp-card table-card"
                  style={{ margin: 0, padding: 0, maxHeight: '50vh', overflow: 'auto' }}
                >
                  <table className="data-table" style={{ minWidth: 600 }}>
                    <thead>
                      <tr>
                        <th>TCG</th>
                        <th>Series</th>
                        <th>Card #</th>
                        <th>Rarity</th>
                        <th>Name</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importedCards.map((c, idx) => (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {error && <div className="form-alert form-alert--error">{error}</div>}

                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setImportStage('select')}
                    disabled={importing}
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleImportAll}
                    disabled={importing || importedCards.length === 0}
                  >
                    {importing
                      ? 'Importing…'
                      : `Import ${importedCards.length} card${importedCards.length === 1 ? '' : 's'} to database`}
                  </button>
                </div>
              </div>
            )}
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