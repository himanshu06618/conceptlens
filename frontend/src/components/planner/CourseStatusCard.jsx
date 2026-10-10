import React from 'react';
import { Target, CheckCircle2, AlertCircle, Award } from 'lucide-react';

export default function CourseStatusCard({
  activePlan = null,
  planStatus = null,
  totalChapters = 0,
  doneChapters = 0
}) {
  if (!activePlan) {
    return (
      <div className="planner-section-card">
        <div className="planner-section-title">
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Target size={20} color="var(--planner-mint)" />
            Course Status
          </span>
        </div>
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--planner-text-muted)', background: 'var(--planner-chip-bg)', borderRadius: 'var(--planner-radius-sm)' }}>
          No active study plan selected. Choose a deadline above and click <strong>Start this plan</strong> to track your progress!
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

  // Find today's chapters from route snapshot
  const todayItems = activePlan.route?.find((d) => d.day_index === todayIndex)?.items || [];

  return (
    <div className="planner-section-card">
      <div className="course-status-header">
        <div className="course-status-day">
          {isComplete ? (
            <span style={{ color: 'var(--planner-mint)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Award size={26} />
              Course Complete!
            </span>
          ) : (
            `Day ${todayIndex} of ${days}`
          )}
        </div>

        <div>
          {isComplete ? (
            <span className="ontrack-chip chip-complete">
              100% Done
            </span>
          ) : behindCount > 0 ? (
            <span className="ontrack-chip chip-behind">
              <AlertCircle size={13} style={{ display: 'inline', marginRight: 4 }} />
              {behindCount} {behindCount === 1 ? 'day' : 'days'} behind
            </span>
          ) : (
            <span className="ontrack-chip chip-ontrack">
              <CheckCircle2 size={13} style={{ display: 'inline', marginRight: 4 }} />
              On track
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="course-progress-bar-wrap" role="progressbar" aria-valuenow={completionPct} aria-valuemin={0} aria-valuemax={100}>
        <div className="course-progress-fill" style={{ width: `${completionPct}%` }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--planner-text-muted)', marginBottom: '16px' }}>
        <span>{doneDays.length} of {days} days completed</span>
        <strong style={{ color: 'var(--planner-text-main)' }}>{completionPct}%</strong>
      </div>

      {/* Today's Chapters */}
      <div className="todays-chapters-box">
        <div className="todays-chapters-label">
          {isComplete ? "All Goals Met" : "Today's Study Focus"}
        </div>
        {todayItems.length > 0 ? (
          <div className="todays-chapters-list">
            {todayItems.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{item.chapter}</span>
                <span style={{ color: 'var(--planner-orange)', fontWeight: 600 }}>{item.hours}h</span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: 'var(--planner-text-muted)', fontSize: '0.88rem' }}>
            {isComplete ? "Congratulations! You've finished your entire route." : "Rest or revision day scheduled."}
          </div>
        )}
      </div>
    </div>
  );
}
