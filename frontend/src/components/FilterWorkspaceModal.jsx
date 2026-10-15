import React, { useRef } from 'react';
import { 
  X, 
  SlidersHorizontal, 
  ArrowUpDown, 
  Layers, 
  Star, 
  RotateCcw, 
  Check, 
  Sparkles,
  BookOpen
} from 'lucide-react';
import { cleanTopicHeading } from '../utils/textCleaner';
import { OverlayPortal, useOverlay } from './ui/Overlay';

/**
 * FilterWorkspaceModal Component
 * Luxury centered glassmorphic popup modal for concept filtering,
 * topic exploration, and sorting order. Rendered via OverlayPortal with focus trap.
 */
export default function FilterWorkspaceModal({
  isOpen,
  onClose,
  sortBy,
  setSortBy,
  selectedTopic,
  setSelectedTopic,
  minImportance,
  setMinImportance,
  cleanedTopics = [],
  totalConcepts = 0,
  matchingCount = 0,
  debouncedQuery = '',
  onResetFilters
}) {
  const cardRef = useRef(null);

  useOverlay({
    isOpen,
    onClose,
    containerRef: cardRef,
    lockScroll: true,
    closeOnEscape: true,
    focusTrap: true
  });

  if (!isOpen) return null;

  const isFilterActive = selectedTopic !== 'ALL' || minImportance > 0 || sortBy !== 'importance';

  const sortOptions = [
    ...(debouncedQuery.trim() ? [{ id: 'relevance', label: 'Relevance', icon: Sparkles, desc: 'Best search match' }] : []),
    { id: 'importance', label: 'Importance', icon: Star, desc: 'High to low rating' },
    { id: 'alpha', label: 'Alphabetical', icon: ArrowUpDown, desc: 'A to Z title order' },
    { id: 'page', label: 'Document Page', icon: BookOpen, desc: 'Sequential reading order' }
  ];

  const importanceOptions = [
    { val: 0, label: 'All Levels', stars: '1–5 ★', desc: 'Show all concepts' },
    { val: 3, label: 'Core', stars: '3+ ★', desc: 'Standard & major' },
    { val: 4, label: 'High Priority', stars: '4+ ★', desc: 'Essential knowledge' },
    { val: 5, label: 'Critical Only', stars: '5 ★', desc: 'Must-know definitions' }
  ];

  return (
    <OverlayPortal>
      <div 
        className="filter-modal-overlay" 
        onClick={onClose} 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="filter-workspace-title"
      >
        <div 
          ref={cardRef}
          className="filter-modal-card" 
          onClick={(e) => e.stopPropagation()}
        >
        {/* Workspace Header */}
        <div className="filter-modal-header">
          <div className="filter-modal-header-left">
            <div className="filter-modal-icon-badge">
              <SlidersHorizontal size={20} strokeWidth={2} />
            </div>
            <div>
              <h2 id="filter-workspace-title" className="filter-modal-title">
                Filter & Sort Concepts
              </h2>
              <p className="filter-modal-subtitle">
                Curate your concept workspace by priority, topic, and reading order
              </p>
            </div>
          </div>

          <button
            type="button"
            className="filter-modal-close-btn"
            onClick={onClose}
            aria-label="Close filter workspace"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Modal Scrollable Workspace Body */}
        <div className="filter-modal-body">
          {/* Section 1: Sort Order */}
          <div className="filter-workspace-section">
            <div className="filter-section-header">
              <ArrowUpDown size={15} strokeWidth={2} className="section-icon" />
              <span className="section-title">Sort Order</span>
            </div>

            <div className="sort-tiles-grid">
              {sortOptions.map((opt) => {
                const Icon = opt.icon;
                const isSelected = sortBy === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`sort-tile-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => setSortBy(opt.id)}
                  >
                    <div className="sort-tile-top">
                      <Icon size={16} strokeWidth={2} className="sort-tile-icon" />
                      <span className="sort-tile-label">{opt.label}</span>
                      {isSelected && <Check size={14} strokeWidth={2.6} className="tile-check" />}
                    </div>
                    <span className="sort-tile-desc">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Topics & Modules */}
          <div className="filter-workspace-section">
            <div className="filter-section-header">
              <Layers size={15} strokeWidth={2} className="section-icon" />
              <span className="section-title">Topic or Module</span>
              <span className="section-count-badge">
                {cleanedTopics.length + 1} topics
              </span>
            </div>

            <div className="topics-cloud-container">
              <button
                type="button"
                className={`workspace-topic-chip ${selectedTopic === 'ALL' ? 'active' : ''}`}
                onClick={() => setSelectedTopic('ALL')}
              >
                <span>All Topics</span>
                <span className="chip-badge">{totalConcepts}</span>
              </button>

              {cleanedTopics.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`workspace-topic-chip ${selectedTopic === t ? 'active' : ''}`}
                  onClick={() => setSelectedTopic(t)}
                  title={t}
                >
                  <span>{cleanTopicHeading(t, 28)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Section 3: Minimum Importance Threshold */}
          <div className="filter-workspace-section">
            <div className="filter-section-header">
              <Star size={15} strokeWidth={2} className="section-icon" />
              <span className="section-title">Minimum Importance</span>
            </div>

            <div className="importance-tiles-grid">
              {importanceOptions.map((opt) => {
                const isSelected = minImportance === opt.val;
                return (
                  <button
                    key={opt.val}
                    type="button"
                    className={`importance-tile-btn ${isSelected ? 'active' : ''}`}
                    onClick={() => setMinImportance(opt.val)}
                  >
                    <div className="importance-stars-row">
                      <span className="stars-label">{opt.stars}</span>
                      {isSelected && <Check size={13} strokeWidth={2.6} className="tile-check" />}
                    </div>
                    <span className="importance-tile-title">{opt.label}</span>
                    <span className="importance-tile-desc">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="filter-modal-footer">
          <div className="filter-modal-footer-stats">
            <span className="footer-matches-text">
              Showing <strong>{matchingCount}</strong> of <strong>{totalConcepts}</strong> concepts
            </span>
            {isFilterActive && (
              <button
                type="button"
                className="footer-reset-btn"
                onClick={onResetFilters}
              >
                <RotateCcw size={13} strokeWidth={2} />
                Reset filters
              </button>
            )}
          </div>

          <div className="filter-modal-footer-actions">
            <button
              type="button"
              className="filter-modal-apply-btn"
              onClick={onClose}
            >
              <Check size={16} strokeWidth={2.4} />
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  </OverlayPortal>
  );
}
