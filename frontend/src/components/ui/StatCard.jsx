import React, { useState, useEffect } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * StatCard — "Flux" Health-Dashboard Inspired KPI Card
 * - White card (or dark surface in dark mode)
 * - Icon chip top-left
 * - 3-dot menu top-right
 * - Big semi-bold number (36-48px) + small grey unit label
 * - Tiny lime growth badge
 * - Thick rounded progress bar with animated count-up
 */
export default function StatCard({
  label,
  value,
  unit = '',
  icon: Icon,
  iconColor = 'var(--accent-lime)',
  iconBg = 'rgba(215, 242, 92, 0.16)',
  growth = '+12%',
  growthType = 'positive', // 'positive' | 'neutral'
  progress = 65,
  progressColor = 'var(--accent-lime)',
  contextText = '',
  className = '',
  onClickMenu = null
}) {
  // Count-up animation for numeric values
  const [displayValue, setDisplayValue] = useState(0);
  const numericValue = typeof value === 'number' ? value : parseFloat(value) || 0;
  const isFraction = typeof value === 'string' && value.includes('/');

  useEffect(() => {
    if (isFraction) return;
    let startTime = null;
    const duration = 600; // ms
    const startVal = 0;
    const endVal = numericValue;

    const animateCount = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progressRatio = Math.min(elapsed / duration, 1);
      // Ease out quad
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
    <div className={`flux-stat-card ${className}`.trim()}>
      <div className="flux-stat-header">
        <div 
          className="flux-stat-icon-chip"
          style={{ background: iconBg, color: iconColor }}
          aria-hidden="true"
        >
          {Icon && <Icon size={20} strokeWidth={2} />}
        </div>

        <div className="flux-stat-header-actions">
          {growth && (
            <span className={`flux-growth-badge ${growthType}`}>
              {growth}
            </span>
          )}
          <button
            type="button"
            className="flux-stat-menu-btn"
            onClick={onClickMenu}
            aria-label={`Options for ${label}`}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      </div>

      <div className="flux-stat-label">{label}</div>

      <div className="flux-stat-number-row">
        <span className="flux-stat-big-number">{renderedNumber}</span>
        {unit && <span className="flux-stat-unit">{unit}</span>}
      </div>

      {contextText && <div className="flux-stat-context">{contextText}</div>}

      <div className="flux-stat-progress-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="flux-stat-progress-fill"
          style={{
            width: `${Math.min(100, Math.max(4, progress))}%`,
            background: progressColor
          }}
        />
      </div>
    </div>
  );
}
