import React from 'react';
import { getDisplayName, getInitials } from '../../utils/userUtils';

/**
 * Clean Avatar
 * Round or squircle avatar with initials or image, warm amber neutral tone.
 */
export default function Avatar({
  name = 'User',
  src = null,
  size = 36,
  className = '',
  style = {}
}) {
  const safeName = typeof name === 'string' ? name : getDisplayName(name);
  const initials = getInitials(safeName);

  return (
    <div
      className={`avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        minWidth: size,
        minHeight: size,
        borderRadius: '50%',
        backgroundColor: 'var(--accent-soft)',
        color: 'var(--text-on-amber)',
        border: '1.5px solid var(--glass-border)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: Math.max(12, Math.floor(size * 0.38)),
        userSelect: 'none',
        overflow: 'hidden',
        ...style
      }}
      title={safeName}
      aria-label={safeName}
    >
      {src ? (
        <img
          src={src}
          alt={safeName}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
