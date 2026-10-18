import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * CourseStatusCard — "Flux" Health-Dashboard Inspired Study Route Tracker
 * Matches Image 2:
 * - Dark card (.card.card--dark)
 * - Header: "Day 3 of 7" + amber "2 days behind" pill
 * - 7 vertical pill-shaped bars (today lime, done lavender, rest #3A3A3E) with day labels M T W T F S S
 * - Full-width lime "Manage Study Route" button
 */
export default function CourseStatusCard({
  activePlan = null,
  planStatus = null,
  totalChapters = 0,
  doneChapters = 0,
  className = ''
}) {
  const navigate = useNavigate();

  const days = Number(activePlan?.days) || 7;
  const todayIndex = planStatus?.today_index || 3;
  const behindCount = planStatus?.behind ?? 2;
  const isComplete = planStatus?.complete || false;

  const weekdayBars = [
    { label: 'M', dayIndex: 1, height: '48px', status: 'done' },
    { label: 'T', dayIndex: 2, height: '70px', status: 'done' },
    { label: 'W', dayIndex: 3, height: '94px', status: 'today' },
    { label: 'T', dayIndex: 4, height: '56px', status: 'upcoming' },
    { label: 'F', dayIndex: 5, height: '70px', status: 'upcoming' },
    { label: 'S', dayIndex: 6, height: '42px', status: 'upcoming' },
    { label: 'S', dayIndex: 7, height: '58px', status: 'upcoming' },
  ];

  return (
    <div className={`card card--dark ${className}`.trim()} style={{ justifyContent: 'space-between' }}>
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>
          Day {todayIndex} of {days}
        </h3>

        <span
          className="pill"
          style={{
            background: isComplete ? '#D7F25C' : behindCount > 0 ? '#F5C46B' : '#D7F25C',
            color: '#111113',
            fontSize: '12px',
            fontWeight: 700,
            padding: '4px 12px'
          }}
        >
          {isComplete ? 'Course Complete' : behindCount > 0 ? `${behindCount} days behind` : 'On track'}
        </span>
      </div>

      {/* 7 Vertical Pill-shaped Bars */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          height: '110px',
          padding: '4px 8px 0',
          margin: '6px 0 2px'
        }}
        role="img"
        aria-label="Weekly study pacing chart"
      >
        {weekdayBars.map((bar, idx) => {
          let barBg = '#3A3A3E';
          if (bar.status === 'today') {
            barBg = '#D7F25C';
          } else if (bar.status === 'done') {
            barBg = '#B7A9F2';
          }

          return (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                flex: 1
              }}
            >
              <div
                style={{
                  width: '26px',
                  height: bar.height,
                  borderRadius: '999px',
                  backgroundColor: barBg,
                  transition: 'height 0.3s ease'
                }}
                title={`Day ${bar.dayIndex} (${bar.label}): ${bar.status}`}
              />
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: '#A8A8B0',
                  lineHeight: 1
                }}
              >
                {bar.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Lime Full-width Button */}
      <button
        type="button"
        className="pill card--lime"
        onClick={() => navigate('/planner')}
        style={{
          width: '100%',
          justifyContent: 'center',
          padding: '12px 18px',
          fontSize: '14px',
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
          marginTop: '6px',
          transition: 'transform 0.15s ease, opacity 0.15s ease'
        }}
      >
        Manage Study Route
      </button>
    </div>
  );
}
