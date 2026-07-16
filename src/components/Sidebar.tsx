import type { ComponentType, SVGProps } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import BrandMark from './BrandMark'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

type NavItem = {
  to: string
  label: string
  Icon: IconComponent
  end?: boolean
}

function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5.25 18.25h13.5" />
      <path d="M5.75 18.25V6.75" />
      <path d="m7.4 14.85 3.35-3.35 2.35 2.35 4.5-4.5" />
      <path d="M14.9 9.35h2.95v2.95" />
    </svg>
  )
}

function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 4.8v2.1M12 17.1v2.1M4.8 12h2.1M17.1 12h2.1M6.55 6.55l1.45 1.45M16 16l1.45 1.45M6.55 17.45l1.45-1.45M16 8l1.45-1.45" />
    </svg>
  )
}

function TransactionsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5.5 8h10l-2.2-2.2" />
      <path d="M13.3 5.8 15.5 8 13.3 10.2" />
      <path d="M18.5 16H8.5l2.2 2.2" />
      <path d="M10.7 18.2 8.5 16l2.2-2.2" />
    </svg>
  )
}

function WatchlistIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 20.75s-7.25-4.55-9.2-8.45c-1.35-2.7.25-6.3 3.8-6.3 2.05 0 3.55 1.05 4.4 2.25.85-1.2 2.35-2.25 4.4-2.25 3.55 0 5.15 3.6 3.8 6.3C19.25 16.2 12 20.75 12 20.75Z" />
    </svg>
  )
}

function InventoryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.8 8.4 12 5.4l7.2 3-7.2 3-7.2-3Z" />
      <path d="M4.8 8.4v7.1l7.2 3 7.2-3V8.4" />
      <path d="M12 11.4v7.1" />
    </svg>
  )
}

function DatabaseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <ellipse cx="12" cy="6" rx="7" ry="2.5" />
      <path d="M5 6v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />
      <path d="M5 12v6c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-6" />
    </svg>
  )
}

function ValidationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3.5 4.5 6.2v5.6c0 4.4 3.2 7.6 7.5 8.7 4.3-1.1 7.5-4.3 7.5-8.7V6.2L12 3.5Z" />
      <path d="m8.5 12.3 2.4 2.4 4.6-4.6" />
    </svg>
  )
}

const desktopNavItems: NavItem[] = [
  { to: '/', label: 'Dashboard', Icon: DashboardIcon, end: true },
  { to: '/watchlist', label: 'Watchlist', Icon: WatchlistIcon },
  { to: '/transactions', label: 'Transactions', Icon: TransactionsIcon },
  { to: '/inventory', label: 'Inventory', Icon: InventoryIcon },
  { to: '/database', label: 'Database', Icon: DatabaseIcon },
  { to: '/database/validation', label: 'Validation', Icon: ValidationIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

const mobileNavItems: NavItem[] = [
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
  { to: '/database', label: 'Database', Icon: DatabaseIcon },
  { to: '/database/validation', label: 'Validation', Icon: ValidationIcon },
  { to: '/transactions', label: 'Transactions', Icon: TransactionsIcon },
  { to: '/inventory', label: 'Inventory', Icon: InventoryIcon },
  { to: '/watchlist', label: 'Watchlist', Icon: WatchlistIcon },
  { to: '/', label: 'Dashboard', Icon: DashboardIcon, end: true },
]

export default function Sidebar() {
  const { user, signOut } = useAuth()

  return (
    <>
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar__brand">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <BrandMark size={36} iconSize={18} />
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>TCG Pro</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, letterSpacing: '0.05em' }}>PTCG / OPCG</div>
            </div>
          </div>
        </div>

        <nav className="desktop-sidebar__nav" aria-label="Primary navigation">
          {desktopNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `desktop-nav-link${isActive ? ' is-active' : ''}`}
            >
              <span className="desktop-nav-link__icon">
                <item.Icon aria-hidden="true" focusable="false" />
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="desktop-sidebar__footer">
          <div className="desktop-sidebar__email">
            {user?.email}
          </div>
          <button onClick={signOut} className="btn btn-ghost desktop-sidebar__signout" type="button">
            Sign Out
          </button>
        </div>
      </aside>

      <div className="mobile-bottom-nav" aria-label="Mobile navigation">
        <nav className="mobile-bottom-nav__rail">
          {mobileNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `mobile-nav-link${isActive ? ' is-active' : ''}`}
            >
              <span className="mobile-nav-link__icon">
                <item.Icon aria-hidden="true" focusable="false" />
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </>
  )
}
