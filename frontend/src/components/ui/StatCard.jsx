import React, { useState, useEffect } from 'react';

/**
 * StatCard — "Flux" Health-Dashboard Inspired KPI Card
 * Matches Image 2:
 * - Card wrapper: .card
 * - 40x40 icon chip (radius 14px)
 * - Lime growth badge
 * - Label: 13px muted
 * - Value: 38px/700
 * - Sub: 12px muted
 * - 8px rounded progress bar
 */
export default function StatCard({
  label,
  value,
  unit = '',
  icon: Icon,
  iconColor = '#111113',
  iconBg = '#D7F25C',
  growth = null,
  progress = 50,
  progressColor = '#111113',
  contextText = '',
  className = ''
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const numericValue = typeof value === 'number' ? value : parseFloat(value) || 0;
  const isFraction = typeof value === 'string' && value.includes('/');

  useEffect(() => {
    if (isFraction) return;
    let startTime = null;
    const duration = 500;
    const startVal = 0;
    const endVal = numericValue;

    const animateCount = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progressRatio = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progressRatio) * (1 - progressRatio);
      setDisplayValue(Math.round(startVal + (endVal - startVal) * eased));

      if (progressRatio < 1) {
        requestAnimationFrame(animateCount);
      } else {
        setDisplayValue(endVal);
      }
    };

    const animFrame = requestAnimationFrame(animateCount);
    return () => cancelAnimationFrame(animFrame);
  }, [numericValue, isFraction]);

  const renderedNumber = isFraction ? value : displayValue;

  return (
    <div className={`card ${className}`.trim()} style={{ gap: '10px' }}>
      {/* Top Row: Icon Chip + Growth Badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            minHeight: '40px',
            borderRadius: '14px',
            backgroundColor: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
          aria-hidden="true"
        >
          {Icon && <Icon size={20} strokeWidth={2} />}
        </div>

        {growth && (
          <span
            className="pill"
            style={{
              background: 'var(--lime)',
              color: '#111113',
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              marginLeft: 'auto'
            }}
          >
            {growth}
          </span>
        )}
      </div>

      {/* Label */}
      <div style={{ fontSize: '13px', color: 'var(--muted)', fontWeight: 500 }}>
        {label}
      </div>

      {/* Big Value Number */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
        <span style={{ fontSize: '38px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
          {renderedNumber}
        </span>
        {unit && (
          <span style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text)' }}>
            {unit}
          </span>
        )}
      </div>

      {/* Sub Context Text */}
      {contextText && (
        <div style={{ fontSize: '12px', color: 'var(--muted)', minHeight: '16px' }}>
          {contextText}
        </div>
      )}

      {/* 8px Rounded Progress Bar */}
      <div
        style={{
          width: '100%',
          height: '8px',
          borderRadius: '999px',
          backgroundColor: 'rgba(0, 0, 0, 0.06)',
          overflow: 'hidden',
          marginTop: 'auto'
        }}
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{
            height: '100%',
            borderRadius: '999px',
            backgroundColor: progressColor,
            width: `${Math.min(100, Math.max(0, progress))}%`,
            transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        />
      </div>
    </div>
  );
}
