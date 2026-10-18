import React from 'react';

/**
 * Standardized Pill Badge — "Flux" Design System
 * Fully rounded pill with crisp typography and high-contrast color fills.
 * Variants: 'lime' | 'lavender' | 'dark' | 'amber' | 'danger' | 'neutral'
 */
export default function Badge({
  children,
  variant = 'lime',
  size = 'md', // 'sm', 'md'
  icon: Icon,
  className = '',
  ...props
}) {
  const renderIcon = (iconToRender) => {
    if (!iconToRender) return null;
    if (React.isValidElement(iconToRender)) return iconToRender;
    return React.createElement(iconToRender, { size: size === 'sm' ? 12 : 14, strokeWidth: 2 });
  };

  // Map legacy color names
  let normalizedVariant = variant;
  if (variant === 'mint' || variant === 'green' || variant === 'gold' || variant === 'success') {
    normalizedVariant = 'lime';
  } else if (variant === 'sky' || variant === 'blue' || variant === 'violet') {
    normalizedVariant = 'lavender';
  } else if (variant === 'rose') {
    normalizedVariant = 'danger';
  }

  return (
    <span className={`flux-badge badge-${normalizedVariant} badge-${size} ${className}`.trim()} {...props}>
      {Icon && <span className="flux-badge-icon" aria-hidden="true">{renderIcon(Icon)}</span>}
      <span className="flux-badge-text">{children}</span>
    </span>
  );
}
