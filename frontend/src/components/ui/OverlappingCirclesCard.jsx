import React from 'react';

/**
 * OverlappingCirclesCard — "Flux" Health-Dashboard Inspired Mastery Overview
 * Fixed-height (210px) relative overflow-hidden container with 3 overlapping circles:
 * - 54% Lavender (#B7A9F2)
 * - 32% Near-Black (#1B1B1D)
 * - 14% Lime (#D7F25C)
 */
export default function OverlappingCirclesCard({
  corePercent = 54,
  prereqPercent = 32,
  recallPercent = 14,
  className = ''
}) {
  return (
    <div className={`card ${className}`.trim()}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          Mastery Overview
        </h3>
        <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
          Retention by knowledge tier
        </p>
      </div>

      <div
        style={{
          height: '210px',
          position: 'relative',
          overflow: 'hidden',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        aria-hidden="true"
      >
        <div style={{ position: 'relative', width: '280px', height: '190px' }}>
          {/* Lavender Circle (left, large) */}
          <div
            style={{
              position: 'absolute',
              left: '10px',
              top: '15px',
              width: '136px',
              height: '136px',
              borderRadius: '50%',
              backgroundColor: '#B7A9F2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#111113',
              fontSize: '26px',
              fontWeight: 700,
              zIndex: 1,
              userSelect: 'none'
            }}
          >
            {corePercent}%
          </div>

          {/* Near-Black Circle (right, medium) */}
          <div
            style={{
              position: 'absolute',
              left: '115px',
              top: '28px',
              width: '120px',
              height: '120px',
              borderRadius: '50%',
              backgroundColor: '#1B1B1D',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              fontSize: '22px',
              fontWeight: 700,
              zIndex: 2,
              userSelect: 'none'
            }}
          >
            {prereqPercent}%
          </div>

          {/* Lime Circle (bottom-center, overlapping) */}
          <div
            style={{
              position: 'absolute',
              left: '78px',
              top: '96px',
              width: '88px',
              height: '88px',
              borderRadius: '50%',
              backgroundColor: '#D7F25C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#111113',
              fontSize: '18px',
              fontWeight: 700,
              zIndex: 3,
              userSelect: 'none'
            }}
          >
            {recallPercent}%
          </div>
        </div>
      </div>
    </div>
  );
}
