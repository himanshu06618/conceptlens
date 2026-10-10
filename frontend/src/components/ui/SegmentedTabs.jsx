import React from 'react';
import { motion } from 'framer-motion';

/**
 * SegmentedTabs with Framer Motion Sliding Pill
 * Used for results switching: "Concept tree" (default), "All concepts", "Summary"
 */
export default function SegmentedTabs({
  tabs = [],
  activeTab,
  onChange,
  className = '',
  layoutId = 'segmentedPill'
}) {
  return (
    <div className={`segmented-tabs-container ${className}`.trim()} role="tablist">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`segmented-tab-btn ${isActive ? 'active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {isActive && (
              <motion.div
                layoutId={layoutId}
                className="segmented-tab-pill"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            <span className="segmented-tab-content">
              {tab.icon && (
                <span className="tab-icon">
                  {React.isValidElement(tab.icon)
                    ? tab.icon
                    : React.createElement(tab.icon, { size: 16, strokeWidth: 1.8 })}
                </span>
              )}
              <span className="tab-label">{tab.label}</span>
              {tab.count !== undefined && (
                <span className={`tab-count-badge ${isActive ? 'count-active' : ''}`}>
                  {tab.count}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
