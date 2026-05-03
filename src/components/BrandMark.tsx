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
          <clipPath id="brand-ball-clip">
            <circle cx="12.2" cy="12" r="4.95" />
          </clipPath>
        </defs>
        <rect x="5.1" y="4.8" width="11" height="13.6" rx="2.4" transform="rotate(-10 10.6 11.6)" fill="rgba(255,255,255,0.28)" />
        <rect x="7" y="4" width="11" height="13.6" rx="2.4" transform="rotate(10 12.5 10.8)" fill="#fff8f2" fillOpacity={0.92} />
        <g clipPath="url(#brand-ball-clip)">
          <rect x="7.25" y="7.05" width="9.9" height="4.95" fill="#e08860" />
          <rect x="7.25" y="12" width="9.9" height="4.95" fill="#fff8f2" />
        </g>
        <circle cx="12.2" cy="12" r="4.95" fill="none" stroke="#4a3f38" strokeWidth="0.95" />
        <rect x="7.05" y="11.55" width="10.3" height="0.9" rx="0.45" fill="#4a3f38" />
        <circle cx="12.2" cy="12" r="1.55" fill="#fff8f2" stroke="#4a3f38" strokeWidth="0.9" />
        <circle cx="12.2" cy="12" r="0.72" fill="#e08860" />
        <path d="M16.65 5.9l.55 1.2 1.2.55-1.2.55-.55 1.2-.55-1.2-1.2-.55 1.2-.55z" fill="#fff8f2" />
      </svg>
    </div>
  )
}