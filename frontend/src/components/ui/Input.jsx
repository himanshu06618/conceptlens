import React, { forwardRef } from 'react';

/**
 * Clean Glassmorphic Input
 * Visible control border, clear focus ring (2px offset).
 */
const Input = forwardRef(function Input({
  label,
  error,
  helper,
  icon: Icon,
  className = '',
  id,
  type = 'text',
  ...props
}, ref) {
  const inputId = id || (label ? `input-${label.toLowerCase().replace(/\s+/g, '-')}` : undefined);

  return (
    <div className={`input-group ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="input-label">
          {label}
        </label>
      )}
      <div className="input-wrapper">
        {Icon && (
          <span className="input-icon-prefix">
            {React.isValidElement(Icon) ? Icon : React.createElement(Icon, { size: 18, strokeWidth: 1.75 })}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          className={`input-field ${Icon ? 'has-icon-prefix' : ''} ${error ? 'has-error' : ''}`.trim()}
          {...props}
        />
      </div>
      {error && <span className="input-error-msg">{error}</span>}
      {!error && helper && <span className="input-helper-msg">{helper}</span>}
    </div>
  );
});

export default Input;
