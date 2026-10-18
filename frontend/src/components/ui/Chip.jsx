import React from 'react';

/**
 * Filter Chip — "Flux" Design System
 * Pill-shaped toggle button (radius 9999px) with dark/lime active states.
 */
export default function Chip({
  children,
  active = false,
  count,
  onClick,
  icon: Icon,
  className = '',
  disabled = false,
  ...props
}) {
  const renderIcon = (iconToRender) => {
    if (!iconToRender) return null;
    if (React.isValidElement(iconToRender)) return iconToRender;
    return React.createElement(iconToRender, { size: 14, strokeWidth: 2 });
  };

  return (
    <button
      type="button"
      className={`flux-chip ${active ? 'flux-chip-active' : ''} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      {...props}
    >
      {Icon && <span className="flux-chip-icon" aria-hidden="true">{renderIcon(Icon)}</span>}
      <span className="flux-chip-label">{children}</span>
      {count !== undefined && <span className="flux-chip-count">{count}</span>}
    </button>
  );
}
