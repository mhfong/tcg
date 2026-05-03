import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import BrandMark from './BrandMark'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '⬡' },
  { to: '/watchlist', label: 'Watchlist', icon: '◈' },
  { to: '/transactions', label: 'Transactions', icon: '△' },
  { to: '/inventory', label: 'Inventory', icon: '◇' },
  { to: '/settings', label: 'Settings', icon: '⬢' },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()

  return (
    <aside style={{
      width: 230, minHeight: '100vh',
      background: 'rgba(255,248,242,0.85)',
      backdropFilter: 'blur(16px)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      position: 'relative', zIndex: 10,
      boxShadow: '4px 0 20px rgba(74,63,56,0.06)',
    }}>
      {/* Logo */}
      <div style={{ padding: '1.5rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <BrandMark size={36} iconSize={18} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>TCG Intel</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.05em' }}>PTCG / OPCG</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.875rem', borderRadius: 10,
              textDecoration: 'none', fontSize: '0.875rem', fontWeight: isActive ? 700 : 600,
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              background: isActive ? 'var(--accent-light)' : 'transparent',
              transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
              boxShadow: isActive ? '0 2px 8px rgba(224,136,96,0.12)' : 'none',
            })}
          >
            <span style={{ fontSize: '1rem', opacity: 0.8 }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div style={{
        padding: '1rem 1.25rem', borderTop: '1px solid var(--border)',
        fontSize: '0.75rem', color: 'var(--text-secondary)'
      }}>
        <div style={{
          marginBottom: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis',
          whiteSpace: 'nowrap', fontWeight: 600
        }}>
          {user?.email}
        </div>
        <button onClick={signOut} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: '0.75rem', padding: '0.375rem' }}>
          Sign Out
        </button>
      </div>
    </aside>
  )
}
