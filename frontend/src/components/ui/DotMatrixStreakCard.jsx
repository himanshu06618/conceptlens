import React, { useMemo } from 'react';

/**
 * DotMatrixStreakCard — Monthly 31-Day Study Consistency Tracker
 * Features:
 * - Current Month Name badge (e.g. October 2026)
 * - Removed numeric rating (x/10)
 * - Exactly 31 circular shapes representing days 1 to 31
 * - Glowing circular shapes only when concepts are marked complete
 */
export default function DotMatrixStreakCard({
  completedConceptsCount = 0,
  activeDays = [],
  activeTimestamps = [],
  monthName = null,
  year = null,
  subtitle = null,
  className = ''
}) {
  const now = new Date();
  const currentMonth = monthName || now.toLocaleString('default', { month: 'long' });
  const currentYear = year || now.getFullYear();
  const currentMonthIdx = now.getMonth();
  const currentDay = now.getDate();

  // Condition: Consistency only works/glows when user has marked a concept complete
  const isConsistent = Number(completedConceptsCount) > 0;

  // Active days set for current month
  const activeDaysSet = useMemo(() => {
    if (!isConsistent) return new Set();

    const daysSet = new Set();

    // 1. Primary: If activeTimestamps are provided, convert each timestamp into the user's local browser timezone
    if (Array.isArray(activeTimestamps) && activeTimestamps.length > 0) {
      activeTimestamps.forEach((ts) => {
        if (!ts) return;
        try {
          const d = new Date(ts);
          if (!isNaN(d.getTime())) {
            // Check if matches the displayed month & year in user's local timezone
            if (d.getMonth() === currentMonthIdx && d.getFullYear() === currentYear) {
              const dayNum = d.getDate();
              if (dayNum >= 1 && dayNum <= 31) {
                daysSet.add(dayNum);
              }
            }
          }
        } catch {}
      });
    }

    if (daysSet.size > 0) {
      return daysSet;
    }

    // 2. Fallback: if activeDays was passed as numbers
    if (Array.isArray(activeDays) && activeDays.length > 0) {
      return new Set(activeDays.map(Number).filter((d) => d >= 1 && d <= 31));
    }

    // 3. Default to today in user's local timezone if concepts are completed
    return new Set([currentDay]);
  }, [isConsistent, activeTimestamps, activeDays, currentMonthIdx, currentYear, currentDay]);

  // Exactly 31 circular shapes representing all 31 days
  const days = useMemo(() => Array.from({ length: 31 }, (_, i) => i + 1), []);

  const activeDaysCount = activeDaysSet.size;

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
      {/* Top Header: Title, Subtitle, and Month Badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text)' }}>
            Study Consistency
          </h3>
          <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>
            {subtitle || (
              isConsistent
                ? `${completedConceptsCount} ${completedConceptsCount === 1 ? 'concept' : 'concepts'} completed · ${activeDaysCount} active ${activeDaysCount === 1 ? 'day' : 'days'}`
                : '0 concepts completed · Inactive'
            )}
          </p>
        </div>

        {/* Prominent Month Name Badge */}
        <span
          className="pill"
          style={{
            background: isConsistent ? 'var(--lime, #D7F25C)' : 'rgba(0, 0, 0, 0.06)',
            color: '#111113',
            fontSize: '12px',
            fontWeight: 700,
            padding: '4px 12px',
            borderRadius: '999px',
            letterSpacing: '0.02em',
            flexShrink: 0
          }}
        >
          {currentMonth} {currentYear}
        </span>
      </div>

      {/* Middle/Bottom: 31 Circular Shapes in 7-Column Calendar Layout */}
      <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
        {/* Weekday indicator row (M T W T F S S) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '8px',
            marginBottom: '6px',
            maxWidth: '300px'
          }}
          aria-hidden="true"
        >
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((dayChar, idx) => (
            <div
              key={idx}
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'var(--muted)',
                textAlign: 'center'
              }}
            >
              {dayChar}
            </div>
          ))}
        </div>

        {/* 31 Circular Shapes Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '8px',
            maxWidth: '300px'
          }}
          role="img"
          aria-label={`Study consistency for ${currentMonth}: ${activeDaysCount} active days out of 31`}
        >
          {days.map((dayNum) => {
            const isActive = activeDaysSet.has(dayNum);
            const isToday = dayNum === currentDay;

            return (
              <div
                key={dayNum}
                title={`${currentMonth} ${dayNum}${isActive ? ': Concepts completed (Active)' : ': No activity'}`}
                style={{
                  aspectRatio: '1',
                  width: '100%',
                  maxWidth: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: isActive ? 700 : 500,
                  transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                  backgroundColor: isActive
                    ? 'var(--lime, #D7F25C)'
                    : isToday
                      ? 'rgba(0, 0, 0, 0.08)'
                      : 'rgba(0, 0, 0, 0.04)',
                  color: isActive
                    ? '#111113'
                    : isToday
                      ? 'var(--text)'
                      : 'var(--muted)',
                  boxShadow: isActive
                    ? '0 0 10px rgba(215, 242, 92, 0.8), 0 0 4px rgba(183, 169, 242, 0.9)'
                    : 'none',
                  border: isToday && !isActive ? '1px dashed rgba(0, 0, 0, 0.3)' : 'none',
                  cursor: 'default',
                  userSelect: 'none'
                }}
              >
                {dayNum}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
