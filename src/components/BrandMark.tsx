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
        <rect x="6.2" y="4.5" width="11.1" height="14.2" rx="2.4" transform="rotate(-12 11.75 11.6)" fill="rgba(255,255,255,0.35)" />
        <rect x="7.2" y="5.1" width="11.1" height="14.2" rx="2.4" transform="rotate(12 12.75 12.2)" fill="#fff" />
        <path d="M17.5 5.9l.8 1.8 1.8.8-1.8.8-.8 1.8-.8-1.8-1.8-.8 1.8-.8z" fill="#fff8f2" />
      </svg>
    </div>
  )
}