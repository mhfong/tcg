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
        {/* Outer ring */}
        <circle cx="12" cy="12" r="9.2" stroke="#fff" strokeWidth="2.1" fill="none" />
        {/* X cross — back layer */}
        <line x1="5.8" y1="5.8" x2="18.2" y2="18.2" stroke="rgba(255,255,255,0.3)" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="18.2" y1="5.8" x2="5.8" y2="18.2" stroke="rgba(255,255,255,0.3)" strokeWidth="2.2" strokeLinecap="round" />
        {/* Equator band */}
        <line x1="2.6" y1="12" x2="21.4" y2="12" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
        {/* Center button ring */}
        <circle cx="12" cy="12" r="3.1" stroke="#fff" strokeWidth="2" fill="none" />
        {/* Center dot */}
        <circle cx="12" cy="12" r="1.25" fill="#fff" />
      </svg>
    </div>
  )
}