import React from 'react';

/**
 * Standardized Card — "Flux" Design System
 * Variants:
 *  - 'light': White card (#FFFFFF) with 26px radius, soft contrast separation
 *  - 'dark': Inset dark surface (#1B1B1D) with crisp contrast
 *  - 'lime': Vibrant Lime (#D7F25C) with dark text
 */
export default function Card({
  children,
  variant = 'light', // 'light' | 'dark' | 'lime'
  className = '',
  hoverable = false,
  elevation = 'none', // 'none' | 'soft' | 'elevated'
  onClick,
  ...props
}) {
  const variantClass = `flux-card-${variant}`;
  const hoverClass = hoverable ? 'flux-card-hoverable' : '';
  const elevationClass = elevation !== 'none' ? `flux-elevation-${elevation}` : '';

  return (
    <div
      className={`flux-card ${variantClass} ${hoverClass} ${elevationClass} ${className}`.trim()}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
}
