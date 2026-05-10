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
        {/* Crossbones — back layer */}
        {/* Bone 1: top-left → bottom-right */}
        <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="3.9" cy="5.1" r="1.15" fill="rgba(255,255,255,0.3)" />
        <circle cx="5.1" cy="3.9" r="1.15" fill="rgba(255,255,255,0.3)" />
        <circle cx="18.9" cy="20.1" r="1.15" fill="rgba(255,255,255,0.3)" />
        <circle cx="20.1" cy="18.9" r="1.15" fill="rgba(255,255,255,0.3)" />
        {/* Bone 2: top-right → bottom-left */}
        <line x1="19.5" y1="4.5" x2="4.5" y2="19.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="20.1" cy="5.1" r="1.15" fill="rgba(255,255,255,0.3)" />
        <circle cx="18.9" cy="3.9" r="1.15" fill="rgba(255,255,255,0.3)" />
        <circle cx="5.1" cy="20.1" r="1.15" fill="rgba(255,255,255,0.3)" />
        <circle cx="3.9" cy="18.9" r="1.15" fill="rgba(255,255,255,0.3)" />
        {/* Outer ring */}
        <circle cx="12" cy="12" r="9.2" stroke="#fff" strokeWidth="2.1" fill="none" />
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