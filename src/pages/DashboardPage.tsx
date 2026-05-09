import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { WatchlistItem, PriceRecord } from '../lib/types'

interface ChartData {
  card_name: string
  card_id: string
  data: { date: string; price: number }[]
}

const CHART_COLORS = ['#e08860', '#7cb88c', '#d4a05c', '#d47878', '#b8a4c8', '#7ec4c4', '#d4c898', '#d4a0a0']

const STAT_GRADIENTS = [
  'linear-gradient(135deg, #e08860, #d47850)',
  'linear-gradient(135deg, #7ec4c4, #68b4b4)',
  'linear-gradient(135deg, #b8a4c8, #a894b8)',
]
const STAT_ICONS = ['◈', '¥', '⟳']

export default function DashboardPage() {
  const { user } = useAuth()
  const [charts, setCharts] = useState<ChartData[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ totalCards: 0, totalValue: 0, avgChange: 0 })

  useEffect(() => {
    if (!user) return
    loadDashboard()
  }, [user])

  async function loadDashboard() {
    setLoading(true)

    // Get watchlist items
    const { data: watchlist } = await supabase
      .from('watchlist')
      .select('*, card:cards(*)')
      .eq('user_id', user!.id)

    if (!watchlist || watchlist.length === 0) {
      setLoading(false)
      return
    }

    const cardIds = watchlist.map((w: WatchlistItem) => w.card_id)

    // Get price history for watched cards (last 30 days)
    const { data: prices } = await supabase
      .from('price_history')
      .select('*')
      .in('card_id', cardIds)
      .order('scraped_at', { ascending: true })

    if (prices) {
      const grouped: Record<string, ChartData> = {}
      for (const w of watchlist as (WatchlistItem & { card: { name_jp: string } })[]) {
        grouped[w.card_id] = {
          card_name: w.card?.name_jp || w.card_id,
          card_id: w.card_id,
          data: []
        }
      }

      for (const p of prices as PriceRecord[]) {
        if (grouped[p.card_id]) {
          grouped[p.card_id].data.push({
            date: new Date(p.scraped_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            price: p.price
          })
        }
      }

      setCharts(Object.values(grouped).filter(c => c.data.length > 0))

      // Compute stats
      const latestPrices = prices.reduce<Record<string, number>>((acc, p: PriceRecord) => {
        acc[p.card_id] = p.price
        return acc
      }, {})
      const totalValue = Object.values(latestPrices).reduce((s, p) => s + p, 0)
      setStats({ totalCards: watchlist.length, totalValue, avgChange: 0 })
    }

    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Loading dashboard...</div>
      </div>
    )
  }

  const statLabels = ['Watched Cards', 'Total Tracked Value', 'Last Scrape']
  const statValues = [String(stats.totalCards), `¥${stats.totalValue.toLocaleString()}`, '—']

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      {/* Isometric Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        {statLabels.map((label, i) => (
          <div key={label} className="lp-card stat-card" style={{
            padding: '1.25rem 1.5rem',
            borderTop: 'none',
            overflow: 'visible',
          }}>
            {/* Colored icon badge */}
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: STAT_GRADIENTS[i],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '0.75rem',
              boxShadow: `0 4px 12px ${['rgba(224,136,96,0.25)', 'rgba(126,196,196,0.25)', 'rgba(184,164,200,0.25)'][i]}`,
            }}>
              <span style={{ color: '#fff', fontSize: '1rem' }}>{STAT_ICONS[i]}</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.25rem' }}>{label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{statValues[i]}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      {charts.length === 0 ? (
        <div className="lp-card empty-state">
          <div className="empty-state-icon">◇</div>
          <div className="empty-state-text">
            No price data yet. Add cards to your watchlist and wait for the scraper to run.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1rem' }}>
          {charts.map((chart, i) => (
            <div key={chart.card_id} className="lp-card">
              <div style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '1rem', color: 'var(--text-primary)' }}>{chart.card_name}</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chart.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                      borderRadius: 10, boxShadow: 'var(--shadow-md)',
                      fontFamily: 'Nunito'
                    }}
                    labelStyle={{ color: 'var(--text-primary)', fontWeight: 700 }}
                    formatter={(value: any) => [`¥${Number(value).toLocaleString()}`, 'Price']}
                  />
                  <Line type="monotone" dataKey="price" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
