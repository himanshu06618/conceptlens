import React from 'react';
import BookshelfLoader from './BookshelfLoader';

/**
 * Premium Button
 * Variants:
 *  - 'primary' | 'gold': Orange primary style with a subtle highlight and dark charcoal text
 *  - 'outline' | 'secondary': White surface, strong border, dark text
 *  - 'ghost': Borderless, subtle hover tint
 *  - 'danger': Muted crimson red with white text
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
    return React.createElement(iconToRender, { size: size === 'sm' ? 16 : 18, strokeWidth: 1.8 });
  };

  const isGold = variant === 'primary' || variant === 'gold';
  const isOutline = variant === 'secondary' || variant === 'outline';
  const variantClass = isGold ? 'btn-primary' : isOutline ? 'btn-outline' : `btn-${variant}`;
  const sizeClass = `btn-${size}`;
  const widthClass = fullWidth ? 'btn-full-width' : '';

  return (
    <button
      type={type}
      className={`btn ${variantClass} ${sizeClass} ${widthClass} ${className}`.trim()}
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
            <span className="btn-icon">{renderIcon(Icon)}</span>
          )}
          {children && <span>{children}</span>}
          {Icon && iconPosition === 'right' && (
            <span className="btn-icon">{renderIcon(Icon)}</span>
          )}
        </>
      )}
    </button>
  );
}
