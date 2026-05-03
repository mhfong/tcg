import { useState } from 'react'
import { useAuth } from '../lib/auth'
import LowPolyBackground from '../components/LowPolyBackground'

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

    const { error } = isSignUp
      ? await signUp(email, password)
      : await signIn(email, password)

    if (error) {
      setError(error.message)
    } else if (isSignUp) {
      setMessage('Check your email to confirm your account.')
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
        zIndex: 10
      }}>
        <div className="lp-card" style={{ width: 380, padding: '2rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
            <span style={{ fontSize: '2.5rem', color: 'var(--accent)' }}>◆</span>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.5rem' }}>TCG Market Intelligence</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Japanese PTCG & OPCG Tracker
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
              <div style={{ color: 'var(--danger)', fontSize: '0.8rem', padding: '0.5rem', background: 'rgba(239,83,80,0.1)', borderRadius: '4px' }}>
                {error}
              </div>
            )}
            {message && (
              <div style={{ color: 'var(--success)', fontSize: '0.8rem', padding: '0.5rem', background: 'rgba(102,187,106,0.1)', borderRadius: '4px' }}>
                {message}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '0.625rem' }} disabled={loading}>
              {loading ? '...' : isSignUp ? 'Create Account' : 'Sign In'}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
