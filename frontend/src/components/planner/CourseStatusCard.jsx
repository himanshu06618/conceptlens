import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * CourseStatusCard — "Flux" Health-Dashboard Inspired Study Route Tracker
 * 
 * Features:
 * - Dynamic activation when user starts a plan (7 days / 15 days / 1 month)
 * - Header: "Day X of Y" + status pill ("On track", "X days behind", "Course Complete")
 * - 7 vertical pill-shaped bars representing Monday through Sunday of current week
 * - Dynamically tracks daily concept completion rate:
 *   - 0 concepts completed: bar remains at bottom (8px)
 *   - 1 concept completed: bar goes up (28px)
 *   - 2, 3, ... N concepts completed: bar goes up proportionally (up to 94px)
 *   - Today is highlighted in vibrant lime (#D7F25C)
 *   - Past completed days are soft lavender (#B7A9F2)
 *   - Days with 0 completed concepts remain at bottom in dark gray (#3A3A3E)
 * - Lime full-width "Manage Study Route" button
 */
export default function CourseStatusCard({
  activePlan = null,
  planStatus = null,
  activeTimestamps = [],
  completedConceptsCount = 0,
  totalChapters = 0,
  doneChapters = 0,
  subtitle = null,
  className = ''
}) {
  const navigate = useNavigate();

  const hasActivePlan = Boolean(activePlan && (activePlan.id || activePlan.days));
  const days = Number(activePlan?.days) || Number(planStatus?.total_days) || 7;
  const todayIndex = Number(planStatus?.today_index) || 1;
  const behindCount = Number(planStatus?.behind) || 0;
  const isComplete = Boolean(planStatus?.complete);

  // Determine current week (Monday to Sunday) in user's local timezone
  const now = new Date();
  // In JS getDay(): 0 is Sunday, 1 is Monday ... 6 is Saturday
  const currentDayOfWeek = (now.getDay() + 6) % 7; // 0 for Monday, ..., 6 for Sunday

  const monday = new Date(now);
  monday.setDate(now.getDate() - currentDayOfWeek);
  monday.setHours(0, 0, 0, 0);

  // Group active timestamps by local YYYY-MM-DD
  const completionCounts = useMemo(() => {
    const counts = new Map();
    if (Array.isArray(activeTimestamps) && activeTimestamps.length > 0) {
      activeTimestamps.forEach((ts) => {
        if (!ts) return;
        try {
          const d = new Date(ts);
          if (!isNaN(d.getTime())) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            counts.set(key, (counts.get(key) || 0) + 1);
          }
        } catch {}
      });
    }
    return counts;
  }, [activeTimestamps]);

  // Fallback: If completedConceptsCount > 0 but completionCounts is empty, attribute to today
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (completionCounts.size === 0 && Number(completedConceptsCount) > 0) {
    completionCounts.set(todayKey, Number(completedConceptsCount));
  }

  const weekdays = [
    { label: 'M', name: 'Monday' },
    { label: 'T', name: 'Tuesday' },
    { label: 'W', name: 'Wednesday' },
    { label: 'T', name: 'Thursday' },
    { label: 'F', name: 'Friday' },
    { label: 'S', name: 'Saturday' },
    { label: 'S', name: 'Sunday' }
  ];

  // Compute weekday bars data
  const weekdayBars = weekdays.map((day, idx) => {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + idx);
    const dateKey = `${dayDate.getFullYear()}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
    
    // Concept completion count for this day
    const count = hasActivePlan ? (completionCounts.get(dateKey) || 0) : 0;
    const isToday = idx === currentDayOfWeek;
    const isPast = idx < currentDayOfWeek;

    // Height calculation:
    // 0 concepts: remains at bottom (8px)
    // 1 concept: 28px
    // 2 concepts: 44px
    // 3 concepts: 60px
    // 4 concepts: 76px
    // 5+ concepts: up to 94px max
    let heightPx = 8;
    if (count > 0) {
      heightPx = Math.min(94, 28 + (count - 1) * 16);
    }

    // Colors:
    // Today with completions: vibrant lime (#D7F25C)
    // Today with 0 completions: dim lime (#D7F25C at low opacity, or 8px)
    // Past with completions: lavender (#B7A9F2)
    // 0 completions: dark gray (#3A3A3E)
    let barBg = '#3A3A3E';
    let opacity = 1;

    if (isToday) {
      barBg = '#D7F25C';
      if (count === 0) {
        opacity = 0.55;
      }
    } else if (isPast && count > 0) {
      barBg = '#B7A9F2';
    }

    const tooltip = isToday
      ? `${day.name} (Today): ${count} concept${count === 1 ? '' : 's'} completed`
      : `${day.name}: ${count} concept${count === 1 ? '' : 's'} completed`;

    return {
      label: day.label,
      fullName: day.name,
      dayIndex: idx + 1,
      height: `${heightPx}px`,
      count,
      barBg,
      opacity,
      isToday,
      tooltip
    };
  });

  return (
    <div
      className={`card card--dark ${className}`.trim()}
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
      {/* Top Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>
            {hasActivePlan ? `Day ${todayIndex} of ${days}` : 'No Active Plan'}
          </h3>

          <span
            className="pill"
            style={{
              background: !hasActivePlan
                ? 'rgba(255, 255, 255, 0.12)'
                : isComplete
                ? '#D7F25C'
                : behindCount > 0
                ? '#F5C46B'
                : '#D7F25C',
              color: !hasActivePlan ? '#A8A8B0' : '#111113',
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 12px'
            }}
          >
            {!hasActivePlan
              ? 'Inactive'
              : isComplete
              ? 'Course Complete'
              : behindCount > 0
              ? `${behindCount} days behind`
              : 'On track'}
          </span>
        </div>
        <p style={{ fontSize: '13px', color: '#A8A8B0', margin: '4px 0 0 0' }}>
          {hasActivePlan
            ? (subtitle || 'Study plan for this file')
            : 'Start a 7, 15, or 30-day plan in Study Planner to track daily pace'}
        </p>
      </div>

      {/* 7 Vertical Pill-shaped Bars */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          height: '110px',
          padding: '6px 4px 0',
          margin: '12px 0 6px'
        }}
        role="img"
        aria-label="Weekly study pacing chart"
      >
        {weekdayBars.map((bar, idx) => (
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
                width: '24px',
                height: bar.height,
                borderRadius: '999px',
                backgroundColor: bar.barBg,
                opacity: bar.opacity,
                transition: 'height 0.35s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease',
                boxShadow: bar.isToday && bar.count > 0 ? '0 0 12px rgba(215, 242, 92, 0.45)' : 'none'
              }}
              title={bar.tooltip}
            />
            <span
              style={{
                fontSize: '11px',
                fontWeight: bar.isToday ? 800 : 600,
                color: bar.isToday ? '#D7F25C' : '#A8A8B0',
                lineHeight: 1
              }}
            >
              {bar.label}
            </span>
          </div>
        ))}
      </div>

      {/* Full-width Button */}
      <button
        type="button"
        className="pill card--lime"
        onClick={() => navigate('/planner')}
        style={{
          width: '100%',
          justifyContent: 'center',
          height: '44px',
          padding: '0 18px',
          fontSize: '14px',
          fontWeight: 700,
          border: 'none',
          cursor: 'pointer',
          marginTop: '8px',
          display: 'flex',
          alignItems: 'center',
          transition: 'transform 0.15s ease, opacity 0.15s ease'
        }}
      >
        {hasActivePlan ? 'Manage Study Route' : 'Start Study Plan'}
      </button>
    </div>
  );
}
