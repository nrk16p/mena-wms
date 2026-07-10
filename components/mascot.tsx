"use client"

export function Mascot({
  size = 88,
  wave = false,
  bubble,
  className = "",
}: {
  size?: number
  wave?: boolean
  bubble?: string
  className?: string
}) {
  return (
    <div className={`m-float relative inline-block ${className}`}>
      {bubble && (
        <div
          style={{
            position: "absolute",
            top: -16,
            left: 54,
            background: "#1B8C4B",
            color: "#fff",
            fontSize: 11,
            fontFamily: "'IBM Plex Sans Thai', sans-serif",
            fontWeight: 500,
            padding: "4px 11px",
            borderRadius: "12px 12px 12px 3px",
            whiteSpace: "nowrap",
            boxShadow: "0 3px 8px -2px rgba(27,140,75,.4)",
          }}
        >
          {bubble}
        </div>
      )}
      <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
        <ellipse cx="60" cy="110" rx="33" ry="6" fill="#1B8C4B" opacity="0.09" />
        <path d="M30 50 L18 30 L46 40 Z" fill="#dab686" />
        <path d="M90 50 L102 30 L74 40 Z" fill="#dab686" />
        <rect x="26" y="44" width="68" height="58" rx="11" fill="#ecca99" />
        <path d="M26 60 H94" stroke="#d3a96f" strokeWidth="2.4" />
        <path d="M60 44 V60" stroke="#d3a96f" strokeWidth="2.4" />
        <rect x="44" y="80" width="32" height="14" rx="4" fill="#1B8C4B" />
        <text x="60" y="90.5" fontSize="8" fill="#fff" textAnchor="middle" fontFamily="Mitr, sans-serif" fontWeight="600">MENA</text>
        <circle cx="48" cy="69" r="3.6" fill="#2b2b2b" />
        <circle cx="72" cy="69" r="3.6" fill="#2b2b2b" />
        <circle cx="49.3" cy="67.7" r="1" fill="#fff" />
        <circle cx="73.3" cy="67.7" r="1" fill="#fff" />
        <circle cx="40" cy="75" r="3" fill="#f3a98f" opacity="0.55" />
        <circle cx="80" cy="75" r="3" fill="#f3a98f" opacity="0.55" />
        <path d="M52 75 Q60 81 68 75" stroke="#2b2b2b" strokeWidth="2" strokeLinecap="round" fill="none" />
        {wave && (
          <g className="m-wave">
            <rect x="91" y="44" width="7" height="22" rx="3.5" fill="#e3bd8c" />
          </g>
        )}
      </svg>
    </div>
  )
}
