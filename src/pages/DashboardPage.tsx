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

const CHART_COLORS = ['#4fc3f7', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc', '#26c6da', '#ffee58', '#ec407a']

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
        <div style={{ color: 'var(--text-secondary)' }}>Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="lp-card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Watched Cards</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.totalCards}</div>
        </div>
        <div className="lp-card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Total Tracked Value</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>¥{stats.totalValue.toLocaleString()}</div>
        </div>
        <div className="lp-card">
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Last Scrape</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>—</div>
        </div>
      </div>

      {/* Charts */}
      {charts.length === 0 ? (
        <div className="lp-card" style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>◇</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            No price data yet. Add cards to your watchlist and wait for the scraper to run.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '1rem' }}>
          {charts.map((chart, i) => (
            <div key={chart.card_id} className="lp-card">
              <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>{chart.card_name}</div>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chart.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4 }}
                    labelStyle={{ color: 'var(--text-primary)' }}
                    formatter={(value) => [`¥${Number(value).toLocaleString()}`, 'Price']}
                  />
                  <Line type="monotone" dataKey="price" stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
