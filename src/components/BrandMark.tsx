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
        <rect x="4.35" y="5.1" width="10.7" height="13.1" rx="2.35" transform="rotate(-10 9.7 11.65)" fill="none" stroke="#4a3f38" strokeWidth="0.7" opacity="0.28" />
        <rect x="7.1" y="4.2" width="11.1" height="13.8" rx="2.5" transform="rotate(10 12.65 11.1)" fill="none" stroke="#4a3f38" strokeWidth="0.95" />

        <circle cx="12.35" cy="12.2" r="5.45" fill="none" stroke="#4a3f38" strokeWidth="0.9" />
        <path d="M6.9 12.2a5.45 5.45 0 0 0 10.9 0v5.15H6.9z" fill="#fff8f2" stroke="#4a3f38" strokeWidth="0.8" strokeLinejoin="round" />
        <rect x="7.05" y="11.82" width="10.6" height="0.75" rx="0.375" fill="#4a3f38" />
        <circle cx="12.35" cy="12.2" r="1.7" fill="#fff8f2" stroke="#4a3f38" strokeWidth="0.8" />
        <circle cx="12.35" cy="12.2" r="0.72" fill="#4a3f38" />
      </svg>
    </div>
  )
}