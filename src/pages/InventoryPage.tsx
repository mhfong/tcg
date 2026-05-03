import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { InventoryItem, CardDefinition } from '../lib/types'

export default function InventoryPage() {
  const { user } = useAuth()
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadInventory()
  }, [user])

  async function loadInventory() {
    setLoading(true)

    // Get all transactions for user
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*, card:cards(*)')
      .eq('user_id', user!.id)
      .order('date', { ascending: true })

    if (!transactions || transactions.length === 0) {
      setLoading(false)
      return
    }

    // Aggregate inventory by card_id + condition
    const inv: Record<string, InventoryItem & { card: CardDefinition }> = {}

    for (const t of transactions) {
      const key = `${t.card_id}__${t.condition}`
      if (!inv[key]) {
        inv[key] = {
          card_id: t.card_id,
          card: t.card as CardDefinition,
          condition: t.condition,
          quantity: 0,
          avg_cost: 0,
          total_cost: 0,
          current_price: null,
          price_change_pct: null,
        }
      }
      if (t.type === 'buy') {
        inv[key].total_cost += t.price * t.quantity
        inv[key].quantity += t.quantity
      } else {
        inv[key].quantity -= t.quantity
      }
    }

    // Calculate average cost and filter out zero/negative quantities
    const items = Object.values(inv).filter(i => i.quantity > 0)
    for (const item of items) {
      item.avg_cost = item.quantity > 0 ? Math.round(item.total_cost / item.quantity) : 0
    }

    // Get latest prices
    const cardIds = [...new Set(items.map(i => i.card_id))]
    if (cardIds.length > 0) {
      const { data: prices } = await supabase
        .from('price_history')
        .select('*')
        .in('card_id', cardIds)
        .order('scraped_at', { ascending: false })

      if (prices) {
        const latestByCard: Record<string, number> = {}
        for (const p of prices) {
          if (!latestByCard[p.card_id]) {
            latestByCard[p.card_id] = p.price
          }
        }
        for (const item of items) {
          if (latestByCard[item.card_id]) {
            item.current_price = latestByCard[item.card_id]
            if (item.avg_cost > 0) {
              item.price_change_pct = ((item.current_price - item.avg_cost) / item.avg_cost) * 100
            }
          }
        }
      }
    }

    setInventory(items)
    setLoading(false)
  }

  const totals = inventory.reduce(
    (acc, item) => {
      acc.totalCost += item.total_cost
      acc.currentValue += (item.current_price ?? item.avg_cost) * item.quantity
      acc.totalCards += item.quantity
      return acc
    },
    { totalCost: 0, currentValue: 0, totalCards: 0 }
  )

  const overallChange = totals.totalCost > 0
    ? ((totals.currentValue - totals.totalCost) / totals.totalCost) * 100
    : 0

  const formatPct = (val: number | null) => {
    if (val === null) return '—'
    const cls = val >= 0 ? 'text-positive' : 'text-negative'
    return <span className={cls}>{val >= 0 ? '+' : ''}{val.toFixed(1)}%</span>
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-secondary)', fontWeight: 600 }}>Loading inventory...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Inventory</h1>
      </div>

      {/* Summary Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'Total Cards', value: String(totals.totalCards), gradient: 'linear-gradient(135deg, #e08860, #d47850)', shadow: 'rgba(224,136,96,0.25)', icon: '◇' },
          { label: 'Total Cost', value: `¥${totals.totalCost.toLocaleString()}`, gradient: 'linear-gradient(135deg, #d4a05c, #c4904c)', shadow: 'rgba(212,160,92,0.25)', icon: '¥' },
          { label: 'Current Value', value: `¥${totals.currentValue.toLocaleString()}`, gradient: 'linear-gradient(135deg, #7ec4c4, #68b4b4)', shadow: 'rgba(126,196,196,0.25)', icon: '◎' },
          { label: 'P/L', value: null, gradient: 'linear-gradient(135deg, #b8a4c8, #a894b8)', shadow: 'rgba(184,164,200,0.25)', icon: '▲' },
        ].map((s) => (
          <div key={s.label} className="lp-card stat-card" style={{ padding: '1.25rem 1.5rem', overflow: 'visible' }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: s.gradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '0.75rem',
              boxShadow: `0 4px 12px ${s.shadow}`,
            }}>
              <span style={{ color: '#fff', fontSize: '1rem' }}>{s.icon}</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{s.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>{s.value !== null ? s.value : formatPct(overallChange)}</div>
          </div>
        ))}
      </div>

      {/* Inventory Table */}
      {inventory.length === 0 ? (
        <div className="lp-card empty-state">
          <div className="empty-state-icon">▽</div>
          <div className="empty-state-text">No inventory. Add buy transactions to build your collection.</div>
        </div>
      ) : (
        <div className="lp-card" style={{ padding: 0, overflow: 'auto', borderRadius: 14 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Card</th>
                <th>Condition</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Avg Cost</th>
                <th style={{ textAlign: 'right' }}>Total Cost</th>
                <th style={{ textAlign: 'right' }}>Current Price</th>
                <th style={{ textAlign: 'right' }}>Current Value</th>
                <th style={{ textAlign: 'right' }}>P/L %</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map(item => (
                <tr key={`${item.card_id}__${item.condition}`}>
                  <td><span className={`tag ${item.card?.tcg_type === 'PTCG' ? 'tag-ptcg' : 'tag-opcg'}`}>{item.card?.tcg_type}</span></td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{item.card?.name_jp}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{item.card?.series} {item.card?.card_number} · {item.card?.rarity}</div>
                  </td>
                  <td>{item.condition === 'RAW_A' ? 'RAW (A)' : item.condition}</td>
                  <td style={{ textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ textAlign: 'right' }}>¥{item.avg_cost.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>¥{item.total_cost.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{item.current_price ? `¥${item.current_price.toLocaleString()}` : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>¥{((item.current_price ?? item.avg_cost) * item.quantity).toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{formatPct(item.price_change_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
