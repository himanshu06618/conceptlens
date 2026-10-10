import React from 'react';

/**
 * ProgressRing
 * SVG circular progress indicator with smooth stroke dashoffset transition
 */
export default function ProgressRing({
  progress = 0, // 0 to 100
  size = 48,
  strokeWidth = 4,
  className = '',
  color = 'var(--gold)',
  trackColor = 'var(--surface-2)'
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(100, Math.max(0, progress)) / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      className={`progress-ring ${className}`.trim()}
      viewBox={`0 0 ${size} ${size}`}
      aria-valuenow={progress}
      aria-valuemin="0"
      aria-valuemax="100"
      role="progressbar"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="transparent"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="transparent"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={strokeDashoffset}
        strokeLinecap="round"
        style={{
          transition: 'stroke-dashoffset 400ms ease',
          transform: 'rotate(-90deg)',
          transformOrigin: '50% 50%'
        }}
      />
    </svg>
  );
}
