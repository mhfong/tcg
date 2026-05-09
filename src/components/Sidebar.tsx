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
  center?: boolean
}

function DashboardIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4.75 6h14.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H4.75a.75.75 0 0 1-.75-.75V6.75A.75.75 0 0 1 4.75 6Z" />
      <path d="M4 9.5h16" />
      <path d="M7 7.75h1.5" />
      <path d="M10 7.75h1.5" />
      <path d="M8.5 12.2h3.8" />
      <path d="M12.8 12.2v3.3" />
      <path d="M15.5 10.2v5.3" />
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

function MainPageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4.2" y="5.4" width="15.6" height="13.2" rx="2.8" />
      <path d="M4.2 9h15.6" />
      <circle cx="7.1" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="9.1" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="11.1" cy="7.2" r="0.7" fill="currentColor" stroke="none" />
      <path d="M8.4 15.2h3.2l1.6-2 1.6 1.2 2.1-3.1" />
      <path d="M15.5 11.3h0.01" />
    </svg>
  )
}

const desktopNavItems: NavItem[] = [
  { to: '/', label: 'Dashboard', Icon: DashboardIcon, end: true },
  { to: '/watchlist', label: 'Watchlist', Icon: WatchlistIcon },
  { to: '/transactions', label: 'Transactions', Icon: TransactionsIcon },
  { to: '/inventory', label: 'Inventory', Icon: InventoryIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

const mobileNavItems: NavItem[] = [
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
  { to: '/transactions', label: 'Transactions', Icon: TransactionsIcon },
  { to: '/', label: 'Dashboard', Icon: MainPageIcon, end: true, center: true },
  { to: '/watchlist', label: 'Watchlist', Icon: WatchlistIcon },
  { to: '/inventory', label: 'Inventory', Icon: InventoryIcon },
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
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>TCG Intel</div>
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
          {mobileNavItems.map(item => {
            if (item.center) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  aria-label={item.label}
                  className={({ isActive }) => `mobile-nav-link mobile-nav-link--dashboard${isActive ? ' is-active' : ''}`}
                >
                  <span className="mobile-nav-link__button">
                    <item.Icon aria-hidden="true" focusable="false" />
                  </span>
                  <span className="sr-only">{item.label}</span>
                </NavLink>
              )
            }

            return (
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
            )
          })}
        </nav>
      </div>
    </>
  )
}
