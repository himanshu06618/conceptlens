import React from 'react';

/**
 * DotMatrixStreakCard — "Flux" Health-Dashboard Inspired Activity & Momentum Matrix
 * Matches Image 2:
 * - Full-width white card (.card)
 * - Header: "Study Consistency" + "5-day streak active"
 * - Big score: "9.2 / 10"
 * - Dot-matrix: 12px dots, 8px gap, lavender shades, responsive flex-wrap
 */
export default function DotMatrixStreakCard({
  score = 9.2,
  maxScore = 10,
  streakDays = 5,
  className = ''
}) {
  // 4 rows x 15 dots in shades of lavender
  const rows = [
    ['#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#ECE8FC', '#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#DCD5F9', '#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#DCD5F9'],
    ['#A492EE', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#C8BEF7', '#B7A9F2', '#ECE8FC', '#B7A9F2', '#C8BEF7', '#A492EE', '#ECE8FC'],
    ['#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#B7A9F2', '#DCD5F9', '#B7A9F2', '#C8BEF7', '#A492EE', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#B7A9F2', '#DCD5F9'],
    ['#C8BEF7', '#B7A9F2', '#A492EE', '#B7A9F2', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#C8BEF7', '#ECE8FC', '#B7A9F2', '#C8BEF7', '#B7A9F2', '#A492EE', '#B7A9F2'],
  ];

  return (
    <div className={`card ${className}`.trim()}>
      {/* Card Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          Study Consistency
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
          {streakDays}-day streak active
        </p>
      </div>

      {/* Content Row: Score Left, Dot Matrix Right */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '24px',
          flexWrap: 'wrap',
          marginTop: '6px'
        }}
      >
        {/* Big Score */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{ fontSize: '38px', fontWeight: 700, color: 'var(--text)', lineHeight: 1 }}>
            {score}
          </span>
          <span style={{ fontSize: '16px', color: 'var(--muted)', fontWeight: 500 }}>
            / {maxScore}
          </span>
        </div>

        {/* 4-row Dot Matrix in Lavender Shades */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxWidth: '100%',
            overflowX: 'auto',
            padding: '2px 0'
          }}
          role="img"
          aria-label="Consistency dot matrix"
        >
          {rows.map((row, rIdx) => (
            <div key={rIdx} style={{ display: 'flex', gap: '8px' }}>
              {row.map((color, dIdx) => (
                <span
                  key={dIdx}
                  style={{
                    width: '12px',
                    height: '12px',
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
    </div>
  );
}
