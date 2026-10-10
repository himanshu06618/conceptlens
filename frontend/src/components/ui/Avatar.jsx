import React from 'react';

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
  const getInitials = (n) => {
    if (!n) return 'CL';
    const parts = n.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

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
      title={name}
      aria-label={name}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span>{getInitials(name)}</span>
      )}
    </div>
  );
}
