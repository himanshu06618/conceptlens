import React from 'react';
import BookshelfLoader from './BookshelfLoader';

/**
 * Standardized Button — "Flux" Design System
 * Variants:
 *  - 'primary' | 'lime': Lime accent (#D7F25C) with crisp near-black ink (#111113) text
 *  - 'dark': Inset dark surface (#1B1B1D) with white text
 *  - 'secondary' | 'outline': Crisp card background, subtle border, dark text
 *  - 'ghost': Transparent background, subtle hover
 *  - 'danger': Soft muted red with white text
 */
export default function Button({
  children,
  variant = 'secondary',
  size = 'md', // 'sm', 'md', 'lg'
  icon: Icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  className = '',
  onClick,
  type = 'button',
  fullWidth = false,
  ...props
}) {
  const renderIcon = (iconToRender) => {
    if (!iconToRender) return null;
    if (React.isValidElement(iconToRender)) return iconToRender;
    return React.createElement(iconToRender, { size: size === 'sm' ? 16 : 18, strokeWidth: 2 });
  };

  const isLime = variant === 'primary' || variant === 'gold' || variant === 'lime';
  const isDark = variant === 'dark' || variant === 'black';
  const isOutline = variant === 'secondary' || variant === 'outline';
  
  const variantClass = isLime
    ? 'btn-lime'
    : isDark
    ? 'btn-dark'
    : isOutline
    ? 'btn-outline'
    : `btn-${variant}`;

  const sizeClass = `btn-${size}`;
  const widthClass = fullWidth ? 'btn-full-width' : '';

  return (
    <button
      type={type}
      className={`flux-btn ${variantClass} ${sizeClass} ${widthClass} ${className}`.trim()}
      onClick={onClick}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <BookshelfLoader size="sm" />
          {children && <span>{children}</span>}
        </>
      ) : (
        <>
          {Icon && iconPosition === 'left' && (
            <span className="flux-btn-icon" aria-hidden="true">{renderIcon(Icon)}</span>
          )}
          {children && <span className="flux-btn-text">{children}</span>}
          {Icon && iconPosition === 'right' && (
            <span className="flux-btn-icon" aria-hidden="true">{renderIcon(Icon)}</span>
          )}
        </>
      )}
    </button>
  );
}
