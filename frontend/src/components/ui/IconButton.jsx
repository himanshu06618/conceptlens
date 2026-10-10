import React from 'react';

/**
 * Clean Glassmorphic IconButton
 */
export default function IconButton({
  icon: Icon,
  variant = 'ghost',
  size = 'md',
  ariaLabel,
  'aria-label': ariaLabelAttr,
  title,
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  ...props
}) {
  const label = ariaLabelAttr || ariaLabel || title;

  const renderIcon = (iconToRender) => {
    if (!iconToRender) return null;
    if (React.isValidElement(iconToRender)) return iconToRender;
    const iconSize = size === 'sm' ? 18 : size === 'lg' ? 22 : 20;
    return React.createElement(iconToRender, { size: iconSize, strokeWidth: 1.75 });
  };

  return (
    <button
      type={type}
      className={`icon-btn icon-btn-${variant} icon-btn-${size} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title || label}
      {...props}
    >
      {renderIcon(Icon)}
    </button>
  );
}
