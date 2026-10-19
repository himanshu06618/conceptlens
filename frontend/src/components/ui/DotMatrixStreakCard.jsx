import React from 'react';

/**
 * DotMatrixStreakCard — "Flux" Health-Dashboard Inspired Activity & Momentum Matrix
 * Matches Target Design (PDF 1):
 * - Full white card (.card)
 * - Header: "Study Consistency" + "5-day streak active"
 * - Score: "9.2 / 10"
 * - Dot-matrix: 4 rows of lavender dots, pinned to the bottom
 */
export default function DotMatrixStreakCard({
  score = 9.2,
  maxScore = 10,
  streakDays = 5,
  className = ''
}) {
  // 4 rows x 12 dots in shades of lavender
  const rows = [
    ['#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#ECE8FC', '#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#DCD5F9', '#B7A9F2', '#C8BEF7'],
    ['#A492EE', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#C8BEF7', '#B7A9F2', '#ECE8FC', '#B7A9F2'],
    ['#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#B7A9F2', '#DCD5F9', '#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#C8BEF7', '#B7A9F2'],
    ['#C8BEF7', '#B7A9F2', '#A492EE', '#B7A9F2', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#C8BEF7', '#ECE8FC', '#B7A9F2', '#C8BEF7'],
  ];

  return (
    <div
      className={`card ${className}`.trim()}
      style={{
        borderRadius: '24px',
        padding: '24px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minWidth: 0,
        boxSizing: 'border-box',
        overflow: 'hidden'
      }}
    >
      {/* Top: Header & Score */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
            Study Consistency
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            {streakDays}-day streak active
          </p>
        </div>

        {/* Big Score */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginTop: '6px' }}>
          <span style={{ fontSize: '38px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
            {score}
          </span>
          <span style={{ fontSize: '16px', color: 'var(--muted)', fontWeight: 500 }}>
            / {maxScore}
          </span>
        </div>
      </div>

      {/* Bottom: Dot Matrix pinned to bottom right / bottom */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '7px',
          marginTop: 'auto',
          paddingTop: '16px',
          overflowX: 'auto',
          maxWidth: '100%'
        }}
        role="img"
        aria-label="Consistency dot matrix"
      >
        {rows.map((row, rIdx) => (
          <div key={rIdx} style={{ display: 'flex', gap: '7px' }}>
            {row.map((color, dIdx) => (
              <span
                key={dIdx}
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: color,
                  flexShrink: 0
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
