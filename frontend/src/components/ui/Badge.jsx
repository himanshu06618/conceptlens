import React from 'react';

/**
 * Clean Badge
 * Soft tints (amber, sky, mint, rose, violet) with dark readable text in light mode
 * and light text in dark mode.
 */
export default function Badge({
  children,
  variant = 'amber', // 'amber', 'sky', 'mint', 'rose', 'violet', 'neutral'
  size = 'md', // 'sm', 'md'
  icon: Icon,
  className = '',
  ...props
}) {
  const renderIcon = (iconToRender) => {
    if (!iconToRender) return null;
    if (React.isValidElement(iconToRender)) return iconToRender;
    return React.createElement(iconToRender, { size: size === 'sm' ? 12 : 14, strokeWidth: 1.75 });
  };

  return (
    <span className={`badge badge-${variant} badge-${size} ${className}`.trim()} {...props}>
      {Icon && <span className="badge-icon">{renderIcon(Icon)}</span>}
      <span>{children}</span>
    </span>
  );
}
