import React from 'react';

/**
 * PaperSurface
 * Flat, high-contrast reading surface (#FFFFFF light / #202D26 dark)
 * Strict rule: All definitions, excerpts, forms, tables sit on this surface
 * with dark readable text (never on raw blurred backgrounds).
 */
export default function PaperSurface({
  children,
  className = '',
  elevation = 'none', // 'none', 'sm'
  bordered = true,
  onClick,
  ...props
}) {
  const borderClass = bordered ? 'paper-bordered' : '';
  const elevationClass = elevation === 'sm' ? 'shadow-sm' : '';

  return (
    <div
      className={`paper-surface ${borderClass} ${elevationClass} ${className}`.trim()}
      onClick={onClick}
      {...props}
    >
      {children}
    </div>
  );
}
