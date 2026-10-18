import React from 'react';
import { MoreHorizontal, Flame, Sparkles } from 'lucide-react';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/**
 * DotMatrixStreakCard — "Flux" Health-Dashboard Inspired Activity & Momentum Matrix
 * Inspired by the "Wellness Index" card with score + dot-matrix activity grid.
 */
export default function DotMatrixStreakCard({
  score = 9.2,
  maxScore = 10,
  streakDays = 5,
  growth = '+18%',
  className = '',
  onClickMenu = null
}) {
  // 4 rows x 7 days dot matrix: 0=rest, 1=light (lavender), 2=high (lime)
  const matrixData = [
    [1, 2, 2, 1, 2, 0, 1],
    [2, 2, 1, 2, 2, 2, 0],
    [1, 1, 2, 2, 1, 1, 2],
    [2, 2, 2, 2, 2, 1, 2], // Current week
  ];

  return (
    <div className={`flux-bento-card flux-dot-matrix-card ${className}`.trim()}>
      <div className="flux-card-header">
        <div className="flux-card-title-group">
          <div className="flux-card-icon-chip" style={{ background: 'rgba(183, 169, 242, 0.20)', color: 'var(--accent-lavender)' }}>
            <Flame size={18} strokeWidth={2} />
          </div>
          <div>
            <h3 className="flux-card-title">Study Consistency</h3>
            <span className="flux-card-subtitle">{streakDays}-day streak active</span>
          </div>
        </div>

        <button
          type="button"
          className="flux-stat-menu-btn"
          onClick={onClickMenu}
          aria-label="Study consistency options"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>

      <div className="flux-matrix-content">
        <div className="flux-matrix-score-block">
          <div className="flux-matrix-num-row">
            <span className="flux-matrix-big-num">{score}</span>
            <span className="flux-stat-unit">/ {maxScore}</span>
            <span className="flux-growth-badge positive">{growth}</span>
          </div>
          <div className="flux-matrix-tagline">
            <Sparkles size={13} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Consistent recall increases long-term retention
          </div>
        </div>

        {/* 7-column Dot-Matrix Grid */}
        <div className="flux-dot-matrix-grid" role="img" aria-label="Study consistency activity matrix">
          {/* Weekday labels */}
          <div className="flux-matrix-weekday-row">
            {WEEKDAYS.map((day, idx) => (
              <span key={idx} className="flux-matrix-day-label">{day}</span>
            ))}
          </div>

          {/* Dots */}
          <div className="flux-matrix-dots-body">
            {matrixData.map((week, wIdx) => (
              <div key={wIdx} className="flux-matrix-row">
                {week.map((level, dIdx) => {
                  const levelClass = level === 2 ? 'dot-high' : level === 1 ? 'dot-med' : 'dot-rest';
                  return (
                    <span
                      key={dIdx}
                      className={`flux-matrix-dot ${levelClass}`}
                      title={level === 2 ? 'Heavy study session' : level === 1 ? 'Review & flashcards' : 'Rest day'}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
