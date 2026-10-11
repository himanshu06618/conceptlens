import React from 'react';

/**
 * NeutralSkeleton: Calm, glass-styled placeholder rendered on route "/"
 * while the authentication session check is resolving.
 * Ensures a logged-in user never sees the guest landing page flash before first paint.
 */
export default function NeutralSkeleton() {
  return (
    <div className="planner-container skeleton-container" aria-busy="true" aria-label="Loading dashboard...">
      <style>{`
        @keyframes skeletonPulse {
          0%, 100% { opacity: 0.45; }
          50% { opacity: 0.85; }
        }
        .skeleton-block {
          background: var(--planner-card-bg, rgba(255, 255, 255, 0.5));
          border: 1px solid var(--planner-card-border, rgba(255, 255, 255, 0.4));
          border-radius: var(--planner-radius-md, 14px);
          animation: skeletonPulse 1.8s ease-in-out infinite;
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
        }
        .skeleton-header-line {
          height: 38px;
          width: 320px;
          border-radius: 8px;
          margin-bottom: 12px;
        }
        .skeleton-sub-line {
          height: 18px;
          width: 480px;
          max-width: 90%;
          border-radius: 6px;
          margin-bottom: 24px;
        }
        .skeleton-stat-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }
        @media (max-width: 900px) {
          .skeleton-stat-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (max-width: 540px) {
          .skeleton-stat-grid {
            grid-template-columns: 1fr;
          }
        }
        .skeleton-stat-card {
          height: 104px;
        }
        .skeleton-upload-card {
          height: 160px;
          margin-bottom: 24px;
          width: 100%;
        }
        .skeleton-main-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }
        @media (max-width: 980px) {
          .skeleton-main-grid {
            grid-template-columns: 1fr;
          }
        }
        .skeleton-left-card {
          height: 480px;
        }
        .skeleton-right-stack {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .skeleton-right-card {
          height: 140px;
        }
      `}</style>

      {/* Greeting & Date Header */}
      <div>
        <div className="skeleton-block skeleton-header-line" />
        <div className="skeleton-block skeleton-sub-line" />
      </div>

      {/* 4 Stat Cards */}
      <div className="skeleton-stat-grid">
        <div className="skeleton-block skeleton-stat-card" />
        <div className="skeleton-block skeleton-stat-card" />
        <div className="skeleton-block skeleton-stat-card" />
        <div className="skeleton-block skeleton-stat-card" />
      </div>

      {/* Compact Upload Card Placeholder */}
      <div className="skeleton-block skeleton-upload-card" />

      {/* Main 2-Column Layout */}
      <div className="skeleton-main-grid">
        <div className="skeleton-block skeleton-left-card" />
        <div className="skeleton-right-stack">
          <div className="skeleton-block skeleton-right-card" />
          <div className="skeleton-block skeleton-right-card" />
          <div className="skeleton-block skeleton-right-card" />
        </div>
      </div>
    </div>
  );
}
