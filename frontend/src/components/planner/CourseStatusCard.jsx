import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, CheckCircle2, AlertCircle, Award, MapPin, ArrowRight, MoreHorizontal } from 'lucide-react';

/**
 * CourseStatusCard — "Flux" Health-Dashboard Inspired Study Route Tracker
 * DARK card (#1B1B1D) with pill-shaped bars per day:
 * - Today: Lime (#D7F25C)
 * - Done: Lavender (#B7A9F2)
 * - Upcoming: Dim / hatched (#2E2E34)
 * - Status pill: Amber "2 days behind" or Lime "On track"
 * - CTA: Lime "Manage Study Route" button
 */
export default function CourseStatusCard({
  activePlan = null,
  planStatus = null,
  totalChapters = 0,
  doneChapters = 0
}) {
  const navigate = useNavigate();

  if (!activePlan) {
    return (
      <div className="flux-card flux-card-dark course-status-card">
        <div className="course-status-dark-header">
          <div className="course-status-title-group">
            <div className="flux-card-icon-chip" style={{ background: 'rgba(215, 242, 92, 0.16)', color: 'var(--accent-lime)' }}>
              <Target size={18} strokeWidth={2} />
            </div>
            <div>
              <h3 className="course-status-card-title">Study Route</h3>
              <span className="course-status-card-subtitle">Daily pacing & milestones</span>
            </div>
          </div>
          <button type="button" className="flux-stat-menu-btn on-dark" aria-label="Route options">
            <MoreHorizontal size={17} />
          </button>
        </div>

        <div className="course-status-empty-dark">
          <p className="course-status-empty-text">
            No active study plan started yet. Generate an adaptive study schedule to balance your milestones.
          </p>
          <button
            type="button"
            className="flux-btn btn-lime btn-sm"
            onClick={() => navigate('/planner')}
          >
            <MapPin size={14} />
            <span>Set Study Route</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  const days = Number(activePlan.days) || 7;
  const doneDays = activePlan.done_days || [];
  const todayIndex = planStatus?.today_index || 1;
  const behindCount = planStatus?.behind || 0;
  const isComplete = planStatus?.complete || doneDays.length >= days;
  const onTrack = planStatus?.on_track || (behindCount === 0 && !isComplete);

  const completionPct = Math.min(100, Math.round((doneDays.length / days) * 100));
  const todayItems = activePlan.route?.find((d) => d.day_index === todayIndex)?.items || [];

  return (
    <div className="flux-card flux-card-dark course-status-card">
      {/* Dark Header */}
      <div className="course-status-dark-header">
        <div>
          <div className="course-status-day-heading">
            {isComplete ? (
              <span className="complete-heading">
                <Award size={22} color="var(--accent-lime)" />
                Course Complete!
              </span>
            ) : (
              `Day ${todayIndex} of ${days}`
            )}
          </div>
          <span className="course-status-subhead">
            {isComplete ? 'All targets achieved' : `${days - todayIndex + 1} days remaining to target exam`}
          </span>
        </div>

        <div>
          {isComplete ? (
            <span className="flux-badge badge-lime">
              100% Done
            </span>
          ) : behindCount > 0 ? (
            <span className="flux-badge badge-amber">
              <AlertCircle size={12} style={{ display: 'inline', marginRight: 4 }} />
              {behindCount} {behindCount === 1 ? 'day' : 'days'} behind
            </span>
          ) : (
            <span className="flux-badge badge-lime">
              <CheckCircle2 size={12} style={{ display: 'inline', marginRight: 4 }} />
              On track
            </span>
          )}
        </div>
      </div>

      {/* Pill-shaped bars per day (today lime, done lavender, upcoming hatched/dim) */}
      <div className="course-day-pills-bar" role="progressbar" aria-valuenow={completionPct} aria-valuemin={0} aria-valuemax={100}>
        {Array.from({ length: days }).map((_, idx) => {
          const dayNum = idx + 1;
          const isDone = doneDays.includes(dayNum);
          const isToday = dayNum === todayIndex && !isComplete;
          const isUpcoming = dayNum > todayIndex && !isDone;

          let pillClass = 'day-pill-upcoming';
          if (isToday) pillClass = 'day-pill-today';
          else if (isDone) pillClass = 'day-pill-done';

          return (
            <div
              key={dayNum}
              className={`course-day-pill-segment ${pillClass}`}
              title={`Day ${dayNum}: ${isToday ? 'Today (Active)' : isDone ? 'Completed' : 'Upcoming'}`}
            >
              <span className="day-pill-label">D{dayNum}</span>
            </div>
          );
        })}
      </div>

      <div className="course-progress-meta-row">
        <span>{doneDays.length} of {days} days completed</span>
        <strong className="course-pct-label">{completionPct}%</strong>
      </div>

      {/* Today's Study Focus */}
      <div className="todays-focus-dark-box">
        <div className="todays-focus-header">
          <span>{isComplete ? "Milestones Achieved" : "Today's Study Focus"}</span>
          <span className="focus-target-pill">Target</span>
        </div>
        {todayItems.length > 0 ? (
          <div className="todays-focus-list">
            {todayItems.map((item, idx) => (
              <div key={idx} className="todays-focus-row">
                <span className="focus-chapter-name">{item.chapter}</span>
                <span className="focus-hours-tag">{item.hours}h</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="todays-focus-empty">
            {isComplete ? "Congratulations! You've finished your entire route." : "Review & flashcard revision day scheduled."}
          </div>
        )}
      </div>

      {/* Lime Manage Study Route Button */}
      <button
        type="button"
        className="flux-btn btn-lime course-manage-route-btn"
        onClick={() => navigate('/planner')}
        title="View full study schedule & route"
      >
        <MapPin size={15} />
        <span>Manage Study Route</span>
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
