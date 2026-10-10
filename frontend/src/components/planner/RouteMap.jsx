import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CheckCircle2, Clock, Calendar, ArrowRight } from 'lucide-react';

export default function RouteMap({
  route = [],
  subjectName = 'Core Curriculum',
  scopeChapterId = null,
  activePlan = null,
  todayIndex = 1,
  doneDays = [],
  onToggleDayDone = () => {},
  animationTrigger = 0
}) {
  const [hoveredDay, setHoveredDay] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [isAnimating, setIsAnimating] = useState(true);
  const containerRef = useRef(null);

  // Restart animation when triggers change
  useEffect(() => {
    setIsAnimating(true);
    const timer = setTimeout(() => setIsAnimating(false), 1200);
    return () => clearTimeout(timer);
  }, [animationTrigger, route]);

  // Extract distinct chapters present in the route in display order
  const chaptersInRoute = useMemo(() => {
    const map = new Map();
    route.forEach((d) => {
      d.items?.forEach((item) => {
        const id = item.chapter_id || item.chapter;
        if (!map.has(id)) {
          map.set(id, {
            id,
            name: item.chapter,
            days: []
          });
        }
        map.get(id).days.push({
          day_index: d.day_index,
          date: d.date,
          hours: item.hours,
          topics: item.topics || [],
          prerequisites: item.prerequisites_for_first_topic || [],
          next_topic: item.next_topic,
          cluster_name: item.cluster_name
        });
      });
    });
    return Array.from(map.values());
  }, [route]);

  // Layout sizing constants from specs
  const ROOT_W = 176;
  const ROOT_H = 64;
  const CH_W = 220;
  const CH_H = 44;
  const DAY_W = 160;
  const DAY_H = 78;
  const GAP = 30;
  const ROW_H = 92;
  const PAD_X = 28;
  const PAD_Y = 24;

  const totalChapters = Math.max(1, chaptersInRoute.length);
  const svgHeight = Math.max(220, totalChapters * ROW_H + PAD_Y * 2);

  // Maximum days on a single chapter branch
  const maxBranchDays = useMemo(() => {
    return chaptersInRoute.reduce((max, ch) => Math.max(max, ch.days.length), 0);
  }, [chaptersInRoute]);

  const svgWidth = Math.max(
    880,
    PAD_X + ROOT_W + GAP + CH_W + GAP + maxBranchDays * (DAY_W + GAP) + 40
  );

  const rootX = PAD_X;
  const rootY = svgHeight / 2 - ROOT_H / 2;
  const rootCenterY = rootY + ROOT_H / 2;
  const rootRight = rootX + ROOT_W;
  const chX = rootRight + GAP;

  const handleMouseEnter = (dayData, event) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({
      x: event.clientX - rect.left + 14,
      y: event.clientY - rect.top - 10
    });
    setHoveredDay(dayData);
  };

  const handleMouseMove = (event) => {
    if (!containerRef.current || !hoveredDay) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({
      x: event.clientX - rect.left + 14,
      y: event.clientY - rect.top - 10
    });
  };

  const handleMouseLeave = () => {
    setHoveredDay(null);
  };

  return (
    <div
      className={`routemap-scroll-wrapper ${isAnimating ? 'routemap-animating' : ''}`}
      ref={containerRef}
      onMouseMove={handleMouseMove}
      role="region"
      aria-label="Interactive study route tree"
    >
      <svg
        className="routemap-svg"
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        aria-label="Horizontal study route roadmap"
      >
        <defs>
          <filter id="boxShadow" x="-5%" y="-10%" width="115%" height="130%">
            <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#2f7d65" floodOpacity="0.08" />
          </filter>
          <linearGradient id="rootGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2f7d65" />
            <stop offset="100%" stopColor="#1e5444" />
          </linearGradient>
        </defs>

        {/* Root Box */}
        <g
          className="route-box-group root-box-group"
          style={{ animationDelay: '0ms' }}
          role="group"
          aria-label="Root Subject Node"
        >
          <rect
            x={rootX}
            y={rootY}
            width={ROOT_W}
            height={ROOT_H}
            rx={14}
            fill="url(#rootGrad)"
            filter="url(#boxShadow)"
          />
          <text
            x={rootX + ROOT_W / 2}
            y={rootY + 26}
            textAnchor="middle"
            fill="#ffffff"
            fontFamily="var(--planner-font-title)"
            fontSize="14"
            fontWeight="bold"
          >
            {subjectName.length > 18 ? `${subjectName.slice(0, 16)}…` : subjectName}
          </text>
          <text
            x={rootX + ROOT_W / 2}
            y={rootY + 46}
            textAnchor="middle"
            fill="#d0ede3"
            fontSize="11.5"
            fontFamily="var(--planner-font-body)"
          >
            {scopeChapterId ? '1 chapter route' : `${route.length}-day route`}
          </text>
        </g>

        {/* Branches per chapter */}
        {chaptersInRoute.map((chapter, chIdx) => {
          const rowY = PAD_Y + chIdx * ROW_H + (ROW_H - CH_H) / 2;
          const chCenterY = rowY + CH_H / 2;

          // S-shaped curved cubic line from root right to chapter left
          const midX = (rootRight + chX) / 2;
          const curvePath = `M ${rootRight} ${rootCenterY} C ${midX} ${rootCenterY}, ${midX} ${chCenterY}, ${chX} ${chCenterY}`;

          return (
            <g key={chapter.id} className="chapter-branch-group">
              {/* Branch curve */}
              <path
                d={curvePath}
                fill="none"
                stroke="var(--planner-mint-border)"
                strokeWidth="2.5"
                strokeLinecap="round"
                className="route-branch-path"
              />

              {/* Chapter Box */}
              <g
                className="route-box-group chapter-box-group"
                style={{ animationDelay: `${(chIdx + 1) * 60}ms` }}
                role="group"
                aria-label={`Chapter: ${chapter.name}`}
              >
                <rect
                  x={chX}
                  y={rowY}
                  width={CH_W}
                  height={CH_H}
                  rx={10}
                  fill="var(--planner-card-bg)"
                  stroke="var(--planner-mint)"
                  strokeWidth="1.8"
                  filter="url(#boxShadow)"
                />
                <text
                  x={chX + 16}
                  y={rowY + 26}
                  fill="var(--planner-text-main)"
                  fontFamily="var(--planner-font-title)"
                  fontSize="13"
                  fontWeight="600"
                >
                  {chapter.name.length > 24 ? `${chapter.name.slice(0, 22)}…` : chapter.name}
                </text>
              </g>

              {/* Day Boxes Chain */}
              {chapter.days.map((dayData, dayIdx) => {
                const dayX = chX + CH_W + GAP + dayIdx * (DAY_W + GAP);
                const dayY = chCenterY - DAY_H / 2;
                const prevX = dayIdx === 0 ? chX + CH_W : dayX - GAP;

                const isDone = doneDays.includes(dayData.day_index);
                const isToday = dayData.day_index === todayIndex;
                const canToggle = Boolean(activePlan);

                const firstTopic = dayData.topics[0] || 'Revise and practise';
                const secondTopic =
                  dayData.topics.length > 2
                    ? `+${dayData.topics.length - 1} more topics`
                    : dayData.topics[1] || '';

                return (
                  <g key={`${chapter.id}-d${dayData.day_index}`} className="day-box-node">
                    {/* Connecting straight line */}
                    <line
                      x1={prevX}
                      y1={chCenterY}
                      x2={dayX}
                      y2={chCenterY}
                      stroke="var(--planner-mint-border)"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      className="route-branch-path"
                    />

                    {/* Day Box */}
                    <g
                      className={`route-box-group day-box-group ${canToggle ? 'day-box-clickable' : ''} ${
                        isDone ? 'day-box-done' : ''
                      } ${isToday ? 'day-box-today' : ''}`}
                      style={{ animationDelay: `${(chIdx + dayIdx + 2) * 60}ms` }}
                      tabIndex={canToggle ? 0 : -1}
                      role="button"
                      aria-pressed={isDone}
                      aria-label={`Day ${dayData.day_index}: ${dayData.hours} hours. ${
                        isDone ? 'Completed' : 'Click to toggle done'
                      }`}
                      onClick={() => canToggle && onToggleDayDone(dayData.day_index)}
                      onKeyDown={(e) => {
                        if (canToggle && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onToggleDayDone(dayData.day_index);
                        }
                      }}
                      onMouseEnter={(e) => handleMouseEnter(dayData, e)}
                      onMouseLeave={handleMouseLeave}
                    >
                      <rect
                        x={dayX}
                        y={dayY}
                        width={DAY_W}
                        height={DAY_H}
                        rx={10}
                        fill="var(--planner-card-bg)"
                        stroke={isDone ? 'var(--planner-mint)' : isToday ? 'var(--planner-orange)' : 'var(--planner-card-border)'}
                        strokeWidth={isToday ? 2.8 : 1.5}
                        className="day-box-rect"
                      />

                      {/* Day Header */}
                      <text
                        x={dayX + 14}
                        y={dayY + 22}
                        fill={isDone ? 'var(--planner-mint)' : isToday ? 'var(--planner-orange)' : 'var(--planner-text-main)'}
                        fontFamily="var(--planner-font-title)"
                        fontSize="13"
                        fontWeight="700"
                      >
                        {`Day ${dayData.day_index}`}
                      </text>

                      {/* Date & Hours Badge */}
                      <text
                        x={dayX + DAY_W - 14}
                        y={dayY + 22}
                        textAnchor="end"
                        fill="var(--planner-text-muted)"
                        fontSize="10.5"
                        fontFamily="var(--planner-font-body)"
                      >
                        {`${dayData.hours}h`}
                      </text>

                      {/* Divider line inside card */}
                      <line
                        x1={dayX + 12}
                        y1={dayY + 29}
                        x2={dayX + DAY_W - 12}
                        y2={dayY + 29}
                        stroke="var(--planner-card-border)"
                        strokeWidth="1"
                      />

                      {/* Topics Preview Lines */}
                      <text
                        x={dayX + 14}
                        y={dayY + 46}
                        fill="var(--planner-text-main)"
                        fontSize="11"
                        fontFamily="var(--planner-font-body)"
                        fontWeight="500"
                      >
                        {firstTopic.length > 18 ? `${firstTopic.slice(0, 16)}…` : firstTopic}
                      </text>

                      {secondTopic && (
                        <text
                          x={dayX + 14}
                          y={dayY + 63}
                          fill="var(--planner-text-muted)"
                          fontSize="10"
                          fontFamily="var(--planner-font-body)"
                        >
                          {secondTopic.length > 20 ? `${secondTopic.slice(0, 18)}…` : secondTopic}
                        </text>
                      )}

                      {/* Completed checkmark badge */}
                      {isDone && (
                        <circle
                          cx={dayX + DAY_W - 16}
                          cy={dayY + 54}
                          r={7}
                          fill="var(--planner-mint)"
                        />
                      )}
                    </g>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Interactive Tooltip */}
      {hoveredDay && (
        <div
          className="routemap-tooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`
          }}
          role="tooltip"
        >
          <strong>
            {`Day ${hoveredDay.day_index}`} ({hoveredDay.date} • {hoveredDay.hours}h)
          </strong>
          {hoveredDay.cluster_name && (
            <div className="tt-sub">
              Cluster: <span className="tt-highlight">{hoveredDay.cluster_name}</span>
            </div>
          )}
          <div style={{ marginTop: '6px' }}>
            <span style={{ fontSize: '0.78rem', opacity: 0.85 }}>Topics:</span>
            <ul style={{ margin: '2px 0 0 16px', padding: 0, fontSize: '0.8rem' }}>
              {hoveredDay.topics.map((t, idx) => (
                <li key={idx}>{t}</li>
              ))}
            </ul>
          </div>
          {hoveredDay.prerequisites && hoveredDay.prerequisites.length > 0 && (
            <div className="tt-sub">
              Needs first:{' '}
              <span className="tt-highlight">
                {hoveredDay.prerequisites.join(', ')}
              </span>
            </div>
          )}
          {hoveredDay.next_topic && (
            <div className="tt-sub">
              Then start: <span className="tt-highlight">{hoveredDay.next_topic}</span>
            </div>
          )}
          {activePlan && (
            <div style={{ marginTop: '8px', fontSize: '0.75rem', opacity: 0.75 }}>
              Click to toggle completed
            </div>
          )}
        </div>
      )}
    </div>
  );
}
