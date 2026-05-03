import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setMessage('')

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    // Verify current password by re-authenticating
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user!.email!,
      password: currentPassword,
    })

    if (signInError) {
      setError('Current password is incorrect.')
      setLoading(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (updateError) {
      setError(updateError.message)
    } else {
      setMessage('Password updated successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div style={{ maxWidth: 480 }}>
        <div className="lp-card">
          <h2 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--text-primary)' }}>Change Password</h2>

          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                Current Password
              </label>
              <input
                type="password"
                className="input"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                required
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                New Password
              </label>
              <input
                type="password"
                className="input"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem', display: 'block' }}>
                Confirm New Password
              </label>
              <input
                type="password"
                className="input"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.8rem', padding: '0.625rem 0.75rem', background: 'rgba(212,120,120,0.1)', borderRadius: 10, fontWeight: 600 }}>
                {error}
              </div>
            )}
            {message && (
              <div style={{ color: 'var(--success)', fontSize: '0.8rem', padding: '0.625rem 0.75rem', background: 'rgba(124,184,140,0.1)', borderRadius: 10, fontWeight: 600 }}>
                {message}
              </div>
            )}

            <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }} disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>

        <div className="lp-card" style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Account</h2>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Email:</strong> {user?.email}
          </div>
          <button type="button" onClick={signOut} className="btn btn-ghost" style={{ marginTop: '0.75rem' }}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  )
}
