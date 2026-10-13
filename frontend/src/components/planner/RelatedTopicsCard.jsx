import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Layers,
  RotateCcw,
  GitBranch,
  ArrowRight,
  AlertTriangle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { getChapterRelations } from '../../api/client';

// 14px stroke 2.4 Stairs Icon (steps going up)
export const StairsIcon = ({ size = 14, className = '', strokeWidth = 2.4 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M4 19h4v-4h4v-4h4V7h4" />
  </svg>
);

// 14px stroke 2.4 Chain-link Icon
export const ChainIcon = ({ size = 14, className = '', strokeWidth = 2.4 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export default function RelatedTopicsCard({
  chapters = [],
  selectedChapterId = null,
  onSelectChapter = () => {},
  onOpenConceptInResults = () => {},
  activePlan = null,
  initialRelationsData = null
}) {
  const [currentChapterId, setCurrentChapterId] = useState(
    selectedChapterId || (chapters[0]?.id || '')
  );
  const [relationsData, setRelationsData] = useState(initialRelationsData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);

  // Filter: 'all' | 'prereq' | 'related'
  const [filter, setFilter] = useState('all');

  // Inline expansion: single concept opened at a time
  const [expandedConceptName, setExpandedConceptName] = useState(null);

  // Progressive rendering for smooth scrolling with > 100 concepts
  const [visibleLimit, setVisibleLimit] = useState(80);
  const listContainerRef = useRef(null);

  // Sync currentChapterId with prop
  useEffect(() => {
    if (selectedChapterId) {
      setCurrentChapterId(selectedChapterId);
    } else if (chapters.length > 0 && !currentChapterId) {
      setCurrentChapterId(chapters[0].id);
    }
  }, [selectedChapterId, chapters]);

  // Sync with initialRelationsData if available
  useEffect(() => {
    if (initialRelationsData && (!relationsData || initialRelationsData.chapter?.id === currentChapterId)) {
      setRelationsData(initialRelationsData);
    }
  }, [initialRelationsData, currentChapterId]);

  // Fetch relations for currentChapterId with 15s timeout
  useEffect(() => {
    if (!currentChapterId) return;

    // If initialRelationsData matches this chapter, avoid redundant fetch
    if (initialRelationsData?.chapter?.id === currentChapterId && initialRelationsData?.clusters?.length > 0) {
      setRelationsData(initialRelationsData);
      setLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setError(null);

    // 15-second timeout guards against hanging requests
    const timeoutId = setTimeout(() => {
      if (!isCancelled) {
        setLoading(false);
        setError('Loading topic relationships timed out. Please check your network and retry.');
      }
    }, 15000);

    getChapterRelations(currentChapterId)
      .then((data) => {
        if (!isCancelled) {
          clearTimeout(timeoutId);
          setRelationsData(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          clearTimeout(timeoutId);
          console.error('Failed to load topic relationships:', err);
          setError(err?.message || 'Could not load topic relationships for this chapter.');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
    };
  }, [currentChapterId, retryKey]);

  // Reset pagination limit when chapter or filter changes
  useEffect(() => {
    setVisibleLimit(80);
  }, [currentChapterId, filter]);

  const rawClusters = relationsData?.clusters || [];

  // Filter topics within clusters according to active segmented filter
  const filteredClusters = useMemo(() => {
    return rawClusters
      .map((cluster) => {
        const topics = (cluster.topics || []).filter((topic) => {
          const hasPrereqs = Array.isArray(topic.prerequisites) && topic.prerequisites.length > 0;
          const hasRelated = Array.isArray(topic.related) && topic.related.length > 0;
          if (filter === 'prereq') return hasPrereqs;
          if (filter === 'related') return hasRelated;
          return true; // 'all'
        });
        return {
          ...cluster,
          topics
        };
      })
      .filter((cluster) => cluster.topics.length > 0);
  }, [rawClusters, filter]);

  // Total concept counts
  const totalConceptsCount = useMemo(() => {
    return filteredClusters.reduce((sum, c) => sum + c.topics.length, 0);
  }, [filteredClusters]);

  const totalRawConceptsCount = useMemo(() => {
    return rawClusters.reduce((sum, c) => sum + (c.topics?.length || 0), 0);
  }, [rawClusters]);

  // Progressive rendering slices across clusters
  const displayedClusters = useMemo(() => {
    if (totalConceptsCount <= 100) {
      return filteredClusters;
    }
    let count = 0;
    const result = [];
    for (const cluster of filteredClusters) {
      if (count >= visibleLimit) break;
      const remainingSlots = visibleLimit - count;
      if (cluster.topics.length <= remainingSlots) {
        result.push(cluster);
        count += cluster.topics.length;
      } else {
        result.push({
          ...cluster,
          topics: cluster.topics.slice(0, remainingSlots)
        });
        count += remainingSlots;
        break;
      }
    }
    return result;
  }, [filteredClusters, totalConceptsCount, visibleLimit]);

  const displayedConceptsCount = useMemo(() => {
    return displayedClusters.reduce((sum, c) => sum + c.topics.length, 0);
  }, [displayedClusters]);

  // Handle scroll inside card to load more items when > 100 concepts
  const handleScroll = useCallback((e) => {
    if (totalConceptsCount <= 100) return;
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      setVisibleLimit((prev) => Math.min(totalConceptsCount, prev + 40));
    }
  }, [totalConceptsCount]);

  // Toggle or set expanded concept
  const handleRowClick = (topicName) => {
    setExpandedConceptName((prev) => (prev === topicName ? null : topicName));
  };

  const handleRowKeyDown = (e, topicName) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick(topicName);
    }
  };

  // Chip click selects/expands that concept
  const handleChipClick = (targetName) => {
    setExpandedConceptName(targetName);
    // Attempt smooth scroll to row if rendered
    setTimeout(() => {
      const rowEl = document.querySelector(`[data-concept-row="${CSS.escape(targetName)}"]`);
      if (rowEl) {
        rowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 50);
  };

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
  };

  const currentChapter = chapters.find((c) => c.id === currentChapterId);

  return (
    <div className="planner-section-card related-topics-container" role="region" aria-label="Related Topics and Learning Clusters">
      {/* 1. Header with Stack icon, Title and responsive Document Dropdown */}
      <div className="related-topics-header">
        <div className="related-topics-title-wrap">
          <Layers size={22} className="related-topics-title-icon" aria-hidden="true" />
          <h2 className="related-topics-title">
            Related Topics & Learning Clusters
          </h2>
        </div>

        {chapters.length > 0 && (
          <div className="related-topics-select-wrap">
            <select
              className="planner-select related-topics-dropdown"
              value={currentChapterId}
              onChange={(e) => {
                const newId = e.target.value;
                setCurrentChapterId(newId);
                onSelectChapter(newId);
                setExpandedConceptName(null);
              }}
              aria-label="Select document or chapter"
            >
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.bookFilename && ch.name !== ch.bookFilename
                    ? `${ch.bookFilename} — ${ch.name}`
                    : ch.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 2. Segmented Filter & Legend Key Line */}
      <div className="related-topics-controls-row">
        {/* Segmented Filter */}
        <div
          className="related-topics-filter-group"
          role="tablist"
          aria-label="Filter concepts by relation type"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`related-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'prereq'}
            className={`related-filter-btn ${filter === 'prereq' ? 'active' : ''}`}
            onClick={() => setFilter('prereq')}
          >
            <StairsIcon size={14} />
            <span>Prerequisite</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'related'}
            className={`related-filter-btn ${filter === 'related' ? 'active' : ''}`}
            onClick={() => setFilter('related')}
          >
            <ChainIcon size={14} />
            <span>Related</span>
          </button>
        </div>

        {/* Legend Key Line */}
        <div className="related-topics-legend-key" aria-hidden="true">
          <span className="legend-key-item">
            <span className="legend-key-icon-wrap prereq">
              <StairsIcon size={13} />
            </span>
            <span>Learn first (prerequisite)</span>
          </span>
          <span className="legend-key-divider">·</span>
          <span className="legend-key-item">
            <span className="legend-key-icon-wrap related">
              <ChainIcon size={13} />
            </span>
            <span>Study together (related)</span>
          </span>
        </div>
      </div>

      {/* 8. Loading Skeleton State (at most 6 rows of 44px) */}
      {loading ? (
        <div
          className="related-topics-skeleton-list"
          aria-busy="true"
          aria-label="Loading topic relationships"
        >
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <div key={idx} className="related-row-skeleton">
              <div className="skeleton-bar-name" />
              <div className="skeleton-badges-wrap">
                <div className="skeleton-pill pill-lime" />
                <div className="skeleton-pill pill-white" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        /* 8. Error State with Retry Button */
        <div className="related-topics-error-state" role="alert">
          <div className="related-error-content">
            <AlertTriangle size={24} className="related-error-icon" aria-hidden="true" />
            <div>
              <div className="related-error-title">Could not load relationships</div>
              <div className="related-error-msg">{error}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="related-retry-btn"
            aria-label="Retry loading topic relationships"
          >
            <RotateCcw size={15} />
            <span>Retry</span>
          </button>
        </div>
      ) : rawClusters.length === 0 || totalRawConceptsCount === 0 ? (
        /* 8. Empty State */
        <div className="related-topics-empty-state">
          <p className="related-empty-text">
            No topic links found for this document yet. Try Re-analyse on the document.
          </p>
        </div>
      ) : filteredClusters.length === 0 ? (
        /* Empty State for current filter */
        <div className="related-topics-empty-state">
          <p className="related-empty-text">
            No concepts match the "{filter === 'prereq' ? 'Prerequisite' : 'Related'}" filter.
          </p>
          <button
            type="button"
            className="related-reset-filter-btn"
            onClick={() => setFilter('all')}
          >
            Show all concepts
          </button>
        </div>
      ) : (
        /* 3 & 4. Scrollable Container with Sticky Headers and 44px Concept Rows */
        <>
          <div
            ref={listContainerRef}
            className="related-topics-scroll-list"
            tabIndex={0}
            role="region"
            aria-label="Learning clusters and related concepts list"
            onScroll={handleScroll}
          >
            {displayedClusters.map((cluster, cIdx) => {
              const clusterName = cluster.name || `Cluster ${cIdx + 1}`;
              const clusterTopics = cluster.topics || [];

              return (
                <section key={clusterName} className="cluster-group-section">
                  {/* Sticky Group Header */}
                  <div className="cluster-sticky-header">
                    <span className="cluster-sticky-title">
                      {clusterName}
                    </span>
                    <span className="cluster-sticky-count">
                      {clusterTopics.length} {clusterTopics.length === 1 ? 'concept' : 'concepts'}
                    </span>
                  </div>

                  {/* Concept Rows inside cluster */}
                  <div className="cluster-topics-list">
                    {clusterTopics.map((topic) => {
                      const topicName = topic.name;
                      const prereqs = Array.isArray(topic.prerequisites) ? topic.prerequisites : [];
                      const related = Array.isArray(topic.related) ? topic.related : [];
                      const prereqCount = prereqs.length;
                      const relatedCount = related.length;

                      // Row expands inline; in filtered mode, open concepts match the active filter
                      const isExpanded = expandedConceptName === topicName;

                      return (
                        <div
                          key={topic.id || topicName}
                          data-concept-row={topicName}
                          className={`concept-row-wrapper ${isExpanded ? 'expanded' : ''}`}
                        >
                          {/* Row Header Button */}
                          <div
                            className="concept-row"
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            aria-label={`${topicName}. ${prereqCount} to learn first. ${relatedCount} to study together.`}
                            onClick={() => handleRowClick(topicName)}
                            onKeyDown={(e) => handleRowKeyDown(e, topicName)}
                          >
                            {/* Truncated Name */}
                            <span className="concept-row-name" title={topicName}>
                              {topicName}
                            </span>

                            {/* Badges on the right */}
                            <div className="concept-row-badges">
                              {/* Prerequisite badge: stairs icon + count, solid lime */}
                              <span
                                className="rel-badge rel-badge-prereq"
                                aria-label={`${prereqCount} to learn first`}
                                title={`${prereqCount} to learn first`}
                              >
                                <StairsIcon size={14} />
                                <span className="rel-badge-count">{prereqCount}</span>
                              </span>

                              {/* Related badge: chain-link icon + count, white outlined */}
                              <span
                                className="rel-badge rel-badge-related"
                                aria-label={`${relatedCount} to study together`}
                                title={`${relatedCount} to study together`}
                              >
                                <ChainIcon size={14} />
                                <span className="rel-badge-count">{relatedCount}</span>
                              </span>

                              {/* Expansion chevron indicator */}
                              <span className="row-expand-chevron" aria-hidden="true">
                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                              </span>
                            </div>
                          </div>

                          {/* 5. Inline Expansion Content (one open at a time) */}
                          {isExpanded && (
                            <div className="concept-expanded-body" role="region" aria-label={`Details for ${topicName}`}>
                              {/* Learn first (prerequisites) section */}
                              {(filter === 'all' || filter === 'prereq') && prereqs.length > 0 && (
                                <div className="expanded-rel-group">
                                  <div className="expanded-rel-heading">
                                    <StairsIcon size={14} />
                                    <span>Learn first ({prereqs.length}):</span>
                                  </div>
                                  <div className="expanded-chips-flow">
                                    {prereqs.map((pName, pIdx) => (
                                      <button
                                        key={pIdx}
                                        type="button"
                                        className="expanded-chip chip-solid-lime"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleChipClick(pName);
                                        }}
                                        title={`View prerequisite "${pName}"`}
                                        aria-label={`Select prerequisite concept ${pName}`}
                                      >
                                        <StairsIcon size={12} />
                                        <span>{pName}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Study together (related) section */}
                              {(filter === 'all' || filter === 'related') && related.length > 0 && (
                                <div className="expanded-rel-group">
                                  <div className="expanded-rel-heading">
                                    <ChainIcon size={14} />
                                    <span>Study together ({related.length}):</span>
                                  </div>
                                  <div className="expanded-chips-flow">
                                    {related.map((rName, rIdx) => (
                                      <button
                                        key={rIdx}
                                        type="button"
                                        className="expanded-chip chip-white-outline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleChipClick(rName);
                                        }}
                                        title={`View related topic "${rName}"`}
                                        aria-label={`Select related concept ${rName}`}
                                      >
                                        <ChainIcon size={12} />
                                        <span>{rName}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* When neither prereqs nor related are present */}
                              {prereqs.length === 0 && related.length === 0 && (
                                <div className="expanded-empty-notice">
                                  Foundational concept with no prerequisites or related links.
                                </div>
                              )}

                              {/* "View in results" action button */}
                              <div className="expanded-action-bar">
                                <button
                                  type="button"
                                  className="view-in-results-action-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onOpenConceptInResults(currentChapterId, topicName);
                                  }}
                                  aria-label={`View ${topicName} in results panel Concept Tree`}
                                >
                                  <GitBranch size={15} />
                                  <span>View in results</span>
                                  <ArrowRight size={14} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>

          {/* 7. Footer line with concept counts */}
          <div className="related-topics-footer" aria-live="polite">
            {totalConceptsCount > 100 && displayedConceptsCount < totalConceptsCount ? (
              <span>
                Showing {displayedConceptsCount} of {totalConceptsCount} concepts · scroll for more
              </span>
            ) : (
              <span>
                Showing {displayedConceptsCount} of {totalConceptsCount} concepts
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
