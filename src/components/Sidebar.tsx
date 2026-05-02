import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '◈' },
  { to: '/watchlist', label: 'Watchlist', icon: '◇' },
  { to: '/transactions', label: 'Transactions', icon: '△' },
  { to: '/inventory', label: 'Inventory', icon: '▽' },
  { to: '/settings', label: 'Settings', icon: '⬡' },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()

  return (
    <aside style={{
      width: 220, minHeight: '100vh', background: 'var(--bg-secondary)',
      borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column',
      position: 'relative', zIndex: 10
    }}>
      <div style={{ padding: '1.5rem 1.25rem', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.5rem', color: 'var(--accent)' }}>◆</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem' }}>TCG Intel</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>PTCG / OPCG</div>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '1rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.625rem 0.75rem', borderRadius: '4px',
              textDecoration: 'none', fontSize: '0.875rem',
              color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              background: isActive ? 'rgba(79, 195, 247, 0.1)' : 'transparent',
              transition: 'all 0.15s',
            })}
          >
            <span style={{ fontSize: '1rem' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{
        padding: '1rem 1.25rem', borderTop: '1px solid var(--border)',
        fontSize: '0.75rem', color: 'var(--text-secondary)'
      }}>
        <div style={{ marginBottom: '0.5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.email}
        </div>
        <button onClick={signOut} className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: '0.75rem', padding: '0.375rem' }}>
          Sign Out
        </button>
      </div>
    </aside>
  )
}
