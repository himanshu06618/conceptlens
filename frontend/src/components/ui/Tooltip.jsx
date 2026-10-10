import React, { useState } from 'react';

/**
 * Clean Tooltip
 */
export default function Tooltip({
  children,
  text,
  position = 'top',
  className = ''
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div
      className={`tooltip-wrapper ${className}`.trim()}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      style={{ display: 'inline-flex', position: 'relative' }}
    >
      {children}
      {visible && text && (
        <div className={`tooltip-bubble tooltip-${position}`} role="tooltip">
          {text}
        </div>
      )}
    </div>
  );
}
