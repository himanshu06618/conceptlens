import React from 'react';

/**
 * Filter Chip
 * Pill-shaped toggle button (radius 999px)
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
    return React.createElement(iconToRender, { size: 14, strokeWidth: 1.75 });
  };

  return (
    <button
      type="button"
      className={`chip ${active ? 'chip-active' : ''} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      {...props}
    >
      {Icon && <span className="chip-icon">{renderIcon(Icon)}</span>}
      <span className="chip-label">{children}</span>
      {count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  );
}
