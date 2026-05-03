import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Transaction, CardDefinition } from '../lib/types'
import { CONDITIONS } from '../lib/types'

export default function TransactionPage() {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<(Transaction & { card: CardDefinition })[]>([])
  const [cards, setCards] = useState<CardDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    card_id: '', type: 'buy' as 'buy' | 'sell', condition: 'RAW_A' as typeof CONDITIONS[number],
    price: '', quantity: '1', date: new Date().toISOString().split('T')[0], notes: ''
  })

  useEffect(() => {
    if (!user) return
    loadTransactions()
    loadCards()
  }, [user])

  async function loadTransactions() {
    setLoading(true)
    const { data } = await supabase
      .from('transactions')
      .select('*, card:cards(*)')
      .eq('user_id', user!.id)
      .order('date', { ascending: false })
    if (data) setTransactions(data as (Transaction & { card: CardDefinition })[])
    setLoading(false)
  }

  async function loadCards() {
    const { data } = await supabase.from('cards').select('*').order('series').order('card_number')
    if (data) setCards(data as CardDefinition[])
  }

  function resetForm() {
    setForm({ card_id: '', type: 'buy', condition: 'RAW_A', price: '', quantity: '1', date: new Date().toISOString().split('T')[0], notes: '' })
    setEditingId(null)
    setShowForm(false)
  }

  function editTransaction(t: Transaction) {
    setForm({
      card_id: t.card_id, type: t.type, condition: t.condition,
      price: t.price.toString(), quantity: t.quantity.toString(),
      date: t.date, notes: t.notes || ''
    })
    setEditingId(t.id)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload = {
      user_id: user!.id,
      card_id: form.card_id,
      type: form.type,
      condition: form.condition,
      price: parseFloat(form.price),
      quantity: parseInt(form.quantity),
      date: form.date,
      notes: form.notes
    }

    if (editingId) {
      await supabase.from('transactions').update(payload).eq('id', editingId)
    } else {
      await supabase.from('transactions').insert(payload)
    }
    resetForm()
    loadTransactions()
  }

  async function deleteTransaction(id: string) {
    if (!confirm('Delete this transaction?')) return
    await supabase.from('transactions').delete().eq('id', id)
    loadTransactions()
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-secondary)', fontWeight: 600 }}>Loading transactions...</div>
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Transactions</h1>
        <button className="btn btn-primary" onClick={() => { if (showForm) resetForm(); else setShowForm(true) }}>
          {showForm ? '✕ Close' : '+ Add Transaction'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="lp-card" style={{ marginBottom: '1rem' }}>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Card</label>
              <select className="input" value={form.card_id} onChange={e => setForm({ ...form, card_id: e.target.value })} required>
                <option value="">Select a card...</option>
                {cards.map(c => (
                  <option key={c.id} value={c.id}>[{c.tcg_type}] {c.series} {c.card_number} - {c.name_jp} ({c.rarity})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Type</label>
              <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'buy' | 'sell' })}>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Condition</label>
              <select className="input" value={form.condition} onChange={e => setForm({ ...form, condition: e.target.value as typeof CONDITIONS[number] })}>
                {CONDITIONS.map(c => <option key={c} value={c}>{c === 'RAW_A' ? 'RAW (A)' : c}</option>)}
              </select>
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Price (¥)</label>
              <input className="input" type="number" min="0" step="1" placeholder="0" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} required />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Quantity</label>
              <input className="input" type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} required />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Date</label>
              <input className="input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} required />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>Notes</label>
              <input className="input" placeholder="Optional notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancel</button>
              <button type="submit" className="btn btn-primary">{editingId ? 'Update' : 'Add Transaction'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {transactions.length === 0 ? (
        <div className="lp-card empty-state">
          <div className="empty-state-icon">△</div>
          <div className="empty-state-text">No transactions yet. Record your first buy or sell.</div>
        </div>
      ) : (
        <div className="lp-card" style={{ padding: 0, overflow: 'auto', borderRadius: 14 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Card</th>
                <th>Condition</th>
                <th style={{ textAlign: 'right' }}>Price</th>
                <th style={{ textAlign: 'right' }}>Qty</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {transactions.map(t => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                  <td>
                    <span className={`tag ${t.type === 'buy' ? 'tag-buy' : 'tag-sell'}`}>
                      {t.type.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{t.card?.name_jp}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.card?.series} {t.card?.card_number}</div>
                  </td>
                  <td>{t.condition === 'RAW_A' ? 'RAW (A)' : t.condition}</td>
                  <td style={{ textAlign: 'right' }}>¥{t.price.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{t.quantity}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>¥{(t.price * t.quantity).toLocaleString()}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.notes}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="btn btn-ghost" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={() => editTransaction(t)}>Edit</button>
                      <button className="btn btn-danger" style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem' }} onClick={() => deleteTransaction(t.id)}>Del</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
