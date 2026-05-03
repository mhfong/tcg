import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { CardDefinition, WatchlistItem } from '../lib/types'

export default function WatchlistPage() {
  const { user } = useAuth()
  const [watchlist, setWatchlist] = useState<(WatchlistItem & { card: CardDefinition })[]>([])
  const [cards, setCards] = useState<CardDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTcg, setFilterTcg] = useState<string>('all')
  const [priceData, setPriceData] = useState<Record<string, {
    latest_price: number | null
    change_7d: number | null
    change_30d: number | null
    buyers_30d: number | null
  }>>({})

  useEffect(() => {
    if (!user) return
    loadWatchlist()
    loadCards()
  }, [user])

  async function loadWatchlist() {
    setLoading(true)
    const { data } = await supabase
      .from('watchlist')
      .select('*, card:cards(*)')
      .eq('user_id', user!.id)
      .order('created_at', { ascending: false })

    if (data) {
      setWatchlist(data as (WatchlistItem & { card: CardDefinition })[])
      // Load price data for each watched card
      const cardIds = data.map((w: WatchlistItem) => w.card_id)
      if (cardIds.length > 0) {
        const { data: prices } = await supabase
          .from('price_history')
          .select('*')
          .in('card_id', cardIds)
          .order('scraped_at', { ascending: false })

        if (prices) {
          const pd: typeof priceData = {}
          for (const cid of cardIds) {
            const cardPrices = prices.filter((p: { card_id: string }) => p.card_id === cid)
            const latest = cardPrices[0]
            const sevenDaysAgo = new Date()
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
            const thirtyDaysAgo = new Date()
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

            const price7d = cardPrices.find((p: { scraped_at: string }) => new Date(p.scraped_at) <= sevenDaysAgo)
            const price30d = cardPrices.find((p: { scraped_at: string }) => new Date(p.scraped_at) <= thirtyDaysAgo)
            const buyers30d = cardPrices
              .filter((p: { scraped_at: string }) => new Date(p.scraped_at) >= thirtyDaysAgo)
              .reduce((sum: number, p: { buyers_count: number }) => sum + (p.buyers_count || 0), 0)

            pd[cid] = {
              latest_price: latest?.price ?? null,
              change_7d: latest && price7d ? ((latest.price - price7d.price) / price7d.price) * 100 : null,
              change_30d: latest && price30d ? ((latest.price - price30d.price) / price30d.price) * 100 : null,
              buyers_30d: buyers30d || null
            }
          }
          setPriceData(pd)
        }
      }
    }
    setLoading(false)
  }

  async function loadCards() {
    const { data } = await supabase.from('cards').select('*').order('series').order('card_number')
    if (data) setCards(data as CardDefinition[])
  }

  async function addToWatchlist(cardId: string) {
    const { error } = await supabase.from('watchlist').insert({ user_id: user!.id, card_id: cardId })
    if (!error) {
      setShowAdd(false)
      setSearchTerm('')
      loadWatchlist()
    }
  }

  async function removeFromWatchlist(id: string) {
    await supabase.from('watchlist').delete().eq('id', id)
    loadWatchlist()
  }

  const watchlistIds = useMemo(() => new Set(watchlist.map(w => w.card_id)), [watchlist])

  const filteredCards = useMemo(() => {
    return cards.filter(c => {
      if (watchlistIds.has(c.id)) return false
      if (filterTcg !== 'all' && c.tcg_type !== filterTcg) return false
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        return c.name_jp.toLowerCase().includes(term) ||
          c.name_en.toLowerCase().includes(term) ||
          c.card_number.toLowerCase().includes(term) ||
          c.series.toLowerCase().includes(term)
      }
      return true
    })
  }, [cards, watchlistIds, filterTcg, searchTerm])

  const formatPct = (val: number | null) => {
    if (val === null) return '—'
    const cls = val >= 0 ? 'text-positive' : 'text-negative'
    return <span className={cls}>{val >= 0 ? '+' : ''}{val.toFixed(1)}%</span>
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-secondary)', fontWeight: 600 }}>Loading watchlist...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Watchlist</h1>
        <button className="btn btn-primary" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? '✕ Close' : '+ Add Card'}
        </button>
      </div>

      {/* Add Card Panel */}
      {showAdd && (
        <div className="lp-card" style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              className="input"
              placeholder="Search cards by name, number, series..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{ flex: 1 }}
            />
            <select className="input" style={{ width: 120 }} value={filterTcg} onChange={e => setFilterTcg(e.target.value)}>
              <option value="all">All TCGs</option>
              <option value="PTCG">PTCG</option>
              <option value="OPCG">OPCG</option>
            </select>
          </div>
          <div style={{ maxHeight: 250, overflowY: 'auto' }}>
            {filteredCards.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                {cards.length === 0 ? 'No cards in library. Run the scraper to populate.' : 'No matching cards found.'}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr><th>Type</th><th>Series</th><th>Number</th><th>Name</th><th>Rarity</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredCards.slice(0, 50).map(card => (
                    <tr key={card.id}>
                      <td><span className={`tag ${card.tcg_type === 'PTCG' ? 'tag-ptcg' : 'tag-opcg'}`}>{card.tcg_type}</span></td>
                      <td>{card.series}</td>
                      <td>{card.card_number}</td>
                      <td>{card.name_jp}</td>
                      <td>{card.rarity}</td>
                      <td><button className="btn btn-primary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => addToWatchlist(card.id)}>+ Add</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Watchlist Table */}
      {watchlist.length === 0 ? (
        <div className="lp-card empty-state">
          <div className="empty-state-icon">◇</div>
          <div className="empty-state-text">Your watchlist is empty. Add cards to track their prices.</div>
        </div>
      ) : (
        <div className="lp-card" style={{ padding: 0, overflow: 'auto', borderRadius: 14 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Series</th>
                <th>Card</th>
                <th>Rarity</th>
                <th style={{ textAlign: 'right' }}>Latest Price</th>
                <th style={{ textAlign: 'right' }}>7D Change</th>
                <th style={{ textAlign: 'right' }}>30D Change</th>
                <th style={{ textAlign: 'right' }}>30D Buyers</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map(w => {
                const pd = priceData[w.card_id]
                return (
                  <tr key={w.id}>
                    <td><span className={`tag ${w.card.tcg_type === 'PTCG' ? 'tag-ptcg' : 'tag-opcg'}`}>{w.card.tcg_type}</span></td>
                    <td>{w.card.series}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{w.card.name_jp}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{w.card.card_number}</div>
                    </td>
                    <td>{w.card.rarity}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{pd?.latest_price ? `¥${pd.latest_price.toLocaleString()}` : '—'}</td>
                    <td style={{ textAlign: 'right' }}>{formatPct(pd?.change_7d ?? null)}</td>
                    <td style={{ textAlign: 'right' }}>{formatPct(pd?.change_30d ?? null)}</td>
                    <td style={{ textAlign: 'right' }}>{pd?.buyers_30d ?? '—'}</td>
                    <td>
                      <button className="btn btn-danger" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }} onClick={() => removeFromWatchlist(w.id)}>Remove</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
