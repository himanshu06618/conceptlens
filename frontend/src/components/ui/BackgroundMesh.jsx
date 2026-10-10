import React from 'react';

/**
 * BackgroundAtmosphere
 * Subtle 3% SVG feTurbulence noise overlay + soft ivory/midnight base
 * Disabled / static when prefers-reduced-motion is active.
 */
export default function BackgroundMesh() {
  return (
    <>
      {/* 3% SVG feTurbulence noise grain overlay */}
      <div className="noise-overlay" aria-hidden="true" />
      {/* Background container */}
      <div className="bg-atmosphere-container" aria-hidden="true">
        <div className="bg-atmosphere-base" />
      </div>
    </>
  );
}
