import React from 'react';

/**
 * LogoMark Component
 * Inline SVG magnifying scope with a refined green rim and polished glass.
 * Crisp from 16px to 512px on both light and dark themes.
 */
export default function LogoMark({ size = 34, className = '', idPrefix = 'scope', colorScheme = 'gold' }) {
  const isLarge = colorScheme === 'blue';
  const gradId = `${idPrefix}-gold-grad`;
  const glassGradId = `${idPrefix}-glass-grad`;
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
        {/* Bright Lime brand gradient */}
        <linearGradient id={gradId} x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#C4F560" />
          <stop offset="50%" stopColor="#9AE62E" />
          <stop offset="100%" stopColor="#6FC21A" />
        </linearGradient>

        {/* Soft Glass Interior Gradient */}
        <radialGradient id={glassGradId} cx="18" cy="18" r="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity={isLarge ? '0.85' : '0.65'} />
          <stop offset="65%" stopColor="#C4F560" stopOpacity={isLarge ? '0.45' : '0.30'} />
          <stop offset="100%" stopColor="#9AE62E" stopOpacity={isLarge ? '0.30' : '0.18'} />
        </radialGradient>

        {/* Subtle Lens Glow */}
        <filter id={shadowId} x="0" y="0" width="48" height="48" filterUnits="userSpaceOnUse">
          <feDropShadow dx="0" dy="1.5" stdDeviation={isLarge ? '2.2' : '1.8'} floodColor="#6FC21A" floodOpacity={isLarge ? '0.32' : '0.22'} />
        </filter>
      </defs>

      {/* Tapered Handle at Bottom-Right */}
      <path
        d="M30 30 L40.25 40.25"
        className="scope-lens-handle"
        stroke={`url(#${gradId})`}
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <circle className="scope-lens-handle-tip" cx="40.25" cy="40.25" r="1.7" fill="#3E7806" />

      {/* Scope Outer Circular Lens Ring */}
      <circle
        cx="20"
        cy="20"
        r="14"
        className="scope-lens-ring"
        stroke={`url(#${gradId})`}
        strokeWidth="2.7"
        filter={`url(#${shadowId})`}
      />

      {/* Soft Glass Fill */}
      <circle
        cx="20"
        cy="20"
        r="12"
        className="scope-lens-glass"
        fill={`url(#${glassGradId})`}
      />

      <path
        d="M12.2 20.3 A7.9 7.9 0 0 1 20.1 12.4"
        className="scope-lens-reflection"
        stroke="#FFFFFF"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeOpacity="0.72"
      />

      {/* Glass Highlight Arc (Upper-Left on the glass) */}
      <path
        d="M9.9 18.1 A 10.5 10.5 0 0 1 18.1 9.9"
        className="scope-lens-highlight"
        stroke="#FFFFFF"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeOpacity="0.88"
      />
    </svg>
  );
}
