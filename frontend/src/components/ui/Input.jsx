import React, { forwardRef } from 'react';

/**
 * Standardized Input — "Flux" Design System
 * Pill-rounded surface with visible lime focus ring and high-contrast text.
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
    <div className={`flux-input-group ${className}`.trim()}>
      {label && (
        <label htmlFor={inputId} className="flux-input-label">
          {label}
        </label>
      )}
      <div className="flux-input-wrapper">
        {Icon && (
          <span className="flux-input-icon-prefix" aria-hidden="true">
            {React.isValidElement(Icon) ? Icon : React.createElement(Icon, { size: 18, strokeWidth: 2 })}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          type={type}
          className={`flux-input-field ${Icon ? 'has-icon-prefix' : ''} ${error ? 'has-error' : ''}`.trim()}
          {...props}
        />
      </div>
      {error && <span className="flux-input-error-msg">{error}</span>}
      {!error && helper && <span className="flux-input-helper-msg">{helper}</span>}
    </div>
  );
});

export default Input;
