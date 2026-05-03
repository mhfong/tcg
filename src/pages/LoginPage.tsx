import { useState } from 'react'
import { useAuth } from '../lib/auth'
import LowPolyBackground from '../components/LowPolyBackground'
import BrandMark from '../components/BrandMark'

export default function LoginPage() {
  const { signIn, signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    const { error, session } = isSignUp
      ? await signUp(email, password)
      : await signIn(email, password)

    if (error) {
      setError(error.message)
    } else if (isSignUp) {
      setMessage(session ? 'Account created.' : 'Account created. Please sign in.')
    }
    setLoading(false)
  }

  return (
    <>
      <LowPolyBackground />
      <div style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        zIndex: 10,
        background: 'rgba(245,237,227,0.4)',
      }}>
        <div className="lp-card" style={{
          width: 400, padding: '2.5rem',
          borderRadius: 18,
          background: 'rgba(255,248,242,0.92)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 12px 40px rgba(74,63,56,0.12), 0 4px 12px rgba(74,63,56,0.06)',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <BrandMark size={64} iconSize={38} style={{ margin: '0 auto 0.75rem' }} />
            <h1 style={{ fontSize: '1.375rem', fontWeight: 800, color: 'var(--text-primary)' }}>TCG Market Intelligence</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem', fontWeight: 600 }}>
              Japanese PTCG & OPCG Tracker
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <input
              type="email"
              className="input"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <input
              type="password"
              className="input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
            />

            {error && (
              <div style={{
                color: 'var(--danger)', fontSize: '0.8rem', padding: '0.625rem 0.75rem',
                background: 'rgba(212,120,120,0.1)', borderRadius: 10, fontWeight: 600
              }}>
                {error}
              </div>
            )}
            {message && (
              <div style={{
                color: 'var(--success)', fontSize: '0.8rem', padding: '0.625rem 0.75rem',
                background: 'rgba(124,184,140,0.1)', borderRadius: 10, fontWeight: 600
              }}>
                {message}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{
              width: '100%', justifyContent: 'center', padding: '0.75rem',
              fontSize: '0.9rem', borderRadius: 12
            }} disabled={loading}>
              {loading ? '...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '1.25rem' }}>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }}
              style={{
                background: 'none', border: 'none', color: 'var(--accent)',
                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
                fontFamily: 'inherit'
              }}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
