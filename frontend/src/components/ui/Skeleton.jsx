import React from 'react';

/**
 * Skeleton Loader
 * Soft shimmer placeholder
 */
export default function Skeleton({
  width = '100%',
  height = '20px',
  borderRadius = '8px',
  className = '',
  style = {}
}) {
  return (
    <div
      className={`skeleton-loader ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius,
        ...style
      }}
      aria-hidden="true"
    />
  );
}
