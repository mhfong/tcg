import type { CSSProperties } from 'react'

type BrandMarkProps = {
  size?: number
  iconSize?: number
  style?: CSSProperties
}

export default function BrandMark({ size = 56, iconSize = 26, style }: BrandMarkProps) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: Math.max(10, Math.round(size * 0.25)),
      background: 'linear-gradient(135deg, var(--accent), var(--lavender))',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 16px rgba(224,136,96,0.3)',
      ...style,
    }}>
      <svg viewBox="0 0 24 24" width={iconSize} height={iconSize} aria-hidden="true">
        <defs>
          <linearGradient id="bm-bg" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#e08860" />
            <stop offset="100%" stopColor="#b8a4c8" />
          </linearGradient>
        </defs>
        {/* Bone 1: top-left → bottom-right */}
        <line x1="1.0" y1="1.0" x2="23.0" y2="23.0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="0.2" cy="1.8" r="1.65" fill="#fff" />
        <circle cx="1.8" cy="0.2" r="1.65" fill="#fff" />
        <circle cx="22.2" cy="23.8" r="1.65" fill="#fff" />
        <circle cx="23.8" cy="22.2" r="1.65" fill="#fff" />
        {/* Bone 2: top-right → bottom-left */}
        <line x1="23.0" y1="1.0" x2="1.0" y2="23.0" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="23.8" cy="1.8" r="1.65" fill="#fff" />
        <circle cx="22.2" cy="0.2" r="1.65" fill="#fff" />
        <circle cx="1.8" cy="23.8" r="1.65" fill="#fff" />
        <circle cx="0.2" cy="22.2" r="1.65" fill="#fff" />
        {/* Gradient-filled mask hides bone interior, keeping pokéball clean */}
        <circle cx="12" cy="12" r="8.65" fill="url(#bm-bg)" />
        {/* Outer ring */}
        <circle cx="12" cy="12" r="9.2" stroke="#fff" strokeWidth="2.1" fill="none" />
        {/* Equator band */}
        <line x1="2.8" y1="12" x2="21.2" y2="12" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
        {/* Center button ring */}
        <circle cx="12" cy="12" r="3.1" stroke="#fff" strokeWidth="2" fill="url(#bm-bg)" />
        {/* Center dot */}
        <circle cx="12" cy="12" r="1.25" fill="#fff" />
      </svg>
    </div>
  )
}