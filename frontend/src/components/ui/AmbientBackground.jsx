import React from 'react';

/**
 * AmbientBackground — "Flux" Solid/Clean Canvas
 * In the flux visual language, backgrounds are crisp solid canvas surfaces
 * (#E6E6E8 in light theme, #121214 in dark theme) without glassmorphic blur or purple gradients.
 */
export default function AmbientBackground() {
  return (
    <div
      className="flux-ambient-canvas"
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        background: 'var(--canvas)',
        transition: 'background var(--transition-normal)'
      }}
    />
  );
}
