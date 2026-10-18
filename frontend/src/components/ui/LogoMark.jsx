import React from 'react';

/**
 * LogoMark Component — "Flux" Design System
 * Inline SVG magnifying scope with crisp lime ring (#D7F25C) and dark interior.
 */
export default function LogoMark({ size = 32, className = '', idPrefix = 'scope' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`conceptlens-logomark ${className}`.trim()}
      aria-hidden="true"
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      <circle cx="16" cy="16" r="16" fill="#D7F25C" />
      <circle cx="14" cy="14" r="5" stroke="#111113" strokeWidth="2.2" />
      <path d="M17.8 17.8L22 22" stroke="#111113" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
