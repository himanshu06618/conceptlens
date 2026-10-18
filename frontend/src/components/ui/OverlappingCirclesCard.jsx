import React from 'react';
import { MoreHorizontal, Layers } from 'lucide-react';

/**
 * OverlappingCirclesCard — "Flux" Health-Dashboard Inspired Mastery Overview
 * Visualizes concept mastery across 3 overlapping circles sized by retention:
 * - Core Concepts (Lime #D7F25C)
 * - Prerequisite Foundations (Lavender #B7A9F2)
 * - Active Recall (Dark Slate #1B1B1D / #2E2E34)
 */
export default function OverlappingCirclesCard({
  overallPercent = 84,
  corePercent = 54,
  prereqPercent = 32,
  recallPercent = 14,
  className = '',
  onClickMenu = null
}) {
  return (
    <div className={`flux-bento-card flux-mastery-circles-card ${className}`.trim()}>
      <div className="flux-card-header">
        <div className="flux-card-title-group">
          <div className="flux-card-icon-chip" style={{ background: 'rgba(215, 242, 92, 0.16)', color: 'var(--accent-lime)' }}>
            <Layers size={18} strokeWidth={2} />
          </div>
          <div>
            <h3 className="flux-card-title">Mastery Overview</h3>
            <span className="flux-card-subtitle">Retention by knowledge tier</span>
          </div>
        </div>

        <button
          type="button"
          className="flux-stat-menu-btn"
          onClick={onClickMenu}
          aria-label="Mastery overview options"
        >
          <MoreHorizontal size={17} />
        </button>
      </div>

      <div className="flux-circles-content">
        <div className="flux-circles-stat">
          <div className="flux-circles-number-row">
            <span className="flux-circles-huge-num">{overallPercent}%</span>
            <span className="flux-growth-badge positive">+14%</span>
          </div>
          <span className="flux-stat-unit">Overall concept retention</span>
        </div>

        <div className="flux-circles-stage" aria-hidden="true">
          <svg viewBox="0 0 160 120" className="flux-circles-svg">
            <defs>
              <filter id="circle-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="6" floodOpacity="0.08" />
              </filter>
            </defs>

            {/* Circle 1: Core Concepts (Lime, largest) */}
            <circle
              cx="58"
              cy="62"
              r="44"
              fill="#D7F25C"
              fillOpacity="0.88"
              filter="url(#circle-shadow)"
            />
            {/* Center label */}
            <text x="50" y="66" textAnchor="middle" fill="#111113" fontSize="13" fontWeight="700">
              {corePercent}%
            </text>

            {/* Circle 2: Prerequisite Foundations (Lavender, medium, overlapping) */}
            <circle
              cx="106"
              cy="52"
              r="34"
              fill="#B7A9F2"
              fillOpacity="0.85"
              filter="url(#circle-shadow)"
            />
            <text x="114" y="56" textAnchor="middle" fill="#111113" fontSize="12" fontWeight="700">
              {prereqPercent}%
            </text>

            {/* Circle 3: Active Recall (Dark Slate, smaller, overlapping base) */}
            <circle
              cx="82"
              cy="86"
              r="24"
              fill="#1B1B1D"
              fillOpacity="0.9"
              filter="url(#circle-shadow)"
            />
            <text x="82" y="90" textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="700">
              {recallPercent}%
            </text>
          </svg>
        </div>
      </div>

      <div className="flux-circles-legend">
        <div className="flux-legend-item">
          <span className="flux-legend-dot" style={{ background: '#D7F25C' }} />
          <span className="flux-legend-label">Core Notes</span>
        </div>
        <div className="flux-legend-item">
          <span className="flux-legend-dot" style={{ background: '#B7A9F2' }} />
          <span className="flux-legend-label">Prerequisites</span>
        </div>
        <div className="flux-legend-item">
          <span className="flux-legend-dot" style={{ background: '#1B1B1D' }} />
          <span className="flux-legend-label">Recall</span>
        </div>
      </div>
    </div>
  );
}
