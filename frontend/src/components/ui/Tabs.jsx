import React from 'react';

/**
 * Clean Tabs with sliding indicator line
 */
export default function Tabs({
  tabs = [],
  activeTab,
  onChange,
  className = ''
}) {
  return (
    <div className={`tabs-container ${className}`.trim()} role="tablist">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`tab-btn ${isActive ? 'tab-btn-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && (
              <span className="tab-icon">
                {React.isValidElement(tab.icon) ? tab.icon : React.createElement(tab.icon, { size: 16, strokeWidth: 1.75 })}
              </span>
            )}
            <span className="tab-label">{tab.label}</span>
            {isActive && <div className="tab-indicator" layoutId="activeTabIndicator" />}
          </button>
        );
      })}
    </div>
  );
}
