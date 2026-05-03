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
        <rect x="6.9" y="5.1" width="9.8" height="12.8" rx="2.2" transform="rotate(-12 11.8 11.5)" fill="rgba(255,255,255,0.35)" />
        <rect x="8.2" y="6" width="9.8" height="12.8" rx="2.2" transform="rotate(12 13.1 12.4)" fill="#fff" />
        <path d="M17.2 6.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="#fff8f2" />
      </svg>
    </div>
  )
}