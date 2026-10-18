import React from 'react';

/**
 * LogoMark Component — "Flux" Design System
 * Inline SVG magnifying scope with crisp lime ring (#D7F25C) and dark interior.
 */
export default function LogoMark({ size = 32, className = '', idPrefix = 'scope' }) {
  const gradId = `${idPrefix}-lime-grad`;
  const shadowId = `${idPrefix}-glow`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`conceptlens-logomark ${className}`.trim()}
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      <defs>
        {/* Crisp Lime brand gradient */}
        <linearGradient id={gradId} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#E2F77D" />
          <stop offset="100%" stopColor="#D7F25C" />
        </linearGradient>

        <filter id={shadowId} x="0" y="0" width="48" height="48" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#D7F25C" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* Scope Handle */}
      <path
        d="M30 30 L40.5 40.5"
        stroke="#111113"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle cx="40.5" cy="40.5" r="1.8" fill="var(--accent-lime)" />

      {/* Outer Lime Scope Ring */}
      <circle
        cx="20"
        cy="20"
        r="14"
        stroke={`url(#${gradId})`}
        strokeWidth="3"
        filter={`url(#${shadowId})`}
      />

      {/* Solid/Tinted Center Lens */}
      <circle
        cx="20"
        cy="20"
        r="11.5"
        fill="#1B1B1D"
      />

      {/* Lime Accent Spark Inside Lens */}
      <circle
        cx="17"
        cy="17"
        r="3.5"
        fill="var(--accent-lime)"
      />
      <circle
        cx="24"
        cy="23"
        r="1.8"
        fill="#B7A9F2"
      />
    </svg>
  );
}
