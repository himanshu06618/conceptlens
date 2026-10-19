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

    if (initialRelationsData?.chapter?.id === currentChapterId && initialRelationsData?.clusters?.length > 0) {
      setRelationsData(initialRelationsData);
      setLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setError(null);

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

  useEffect(() => {
    setVisibleLimit(80);
  }, [currentChapterId, filter]);

  const rawClusters = relationsData?.clusters || [];

  const filteredClusters = useMemo(() => {
    if (!rawClusters || rawClusters.length === 0) return [];
    if (filter === 'all') return rawClusters;

    return rawClusters
      .map((cluster) => {
        const topics = cluster.topics || [];
        const matchingTopics = topics.filter((topic) => {
          if (filter === 'prereq') {
            return Array.isArray(topic.prerequisites) && topic.prerequisites.length > 0;
          }
          if (filter === 'related') {
            return Array.isArray(topic.related) && topic.related.length > 0;
          }
          return true;
        });

        if (matchingTopics.length === 0) return null;
        return {
          ...cluster,
          topics: matchingTopics
        };
      })
      .filter(Boolean);
  }, [rawClusters, filter]);

  const totalRawConceptsCount = useMemo(() => {
    return rawClusters.reduce((acc, c) => acc + (c.topics?.length || 0), 0);
  }, [rawClusters]);

  const totalConceptsCount = useMemo(() => {
    return filteredClusters.reduce((acc, c) => acc + (c.topics?.length || 0), 0);
  }, [filteredClusters]);

  const { displayedClusters, displayedConceptsCount } = useMemo(() => {
    let count = 0;
    const result = [];

    for (const cluster of filteredClusters) {
      if (count >= visibleLimit) break;
      const remainingSlots = visibleLimit - count;
      const clusterTopics = cluster.topics || [];

      if (clusterTopics.length <= remainingSlots) {
        result.push(cluster);
        count += clusterTopics.length;
      } else {
        result.push({
          ...cluster,
          topics: clusterTopics.slice(0, remainingSlots)
        });
        count += remainingSlots;
        break;
      }
    }

    return { displayedClusters: result, displayedConceptsCount: count };
  }, [filteredClusters, visibleLimit]);

  const handleScroll = useCallback(() => {
    const el = listContainerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
      if (displayedConceptsCount < totalConceptsCount) {
        setVisibleLimit((prev) => prev + 50);
      }
    }
  }, [displayedConceptsCount, totalConceptsCount]);

  const handleRowClick = (conceptName) => {
    setExpandedConceptName((prev) => (prev === conceptName ? null : conceptName));
  };

  const handleRowKeyDown = (e, conceptName) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick(conceptName);
    }
  };

  const handleRetry = () => {
    setError(null);
    setLoading(true);
    setRetryKey((k) => k + 1);
  };

  return (
    <div
      className="card"
      style={{
        borderRadius: '24px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        overflow: 'hidden',
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'space-between'
      }}
      role="region"
      aria-label="Related Topics and Learning Clusters"
    >
      {/* 1. Header with lime icon chip, title and file dropdown pill */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              minWidth: '36px',
              minHeight: '36px',
              borderRadius: '10px',
              backgroundColor: '#D7F25C',
              color: '#111113',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
            aria-hidden="true"
          >
            <Layers size={18} strokeWidth={2.4} />
          </div>
          <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--text)', whiteSpace: 'nowrap' }}>
            Related Topics & Learning Clusters
          </h3>
        </div>

        {chapters.length > 0 && (
          <div style={{ maxWidth: '150px' }}>
            <select
              value={currentChapterId}
              onChange={(e) => {
                const newId = e.target.value;
                setCurrentChapterId(newId);
                onSelectChapter(newId);
                setExpandedConceptName(null);
              }}
              style={{
                background: 'var(--surface-subtle, #F0F0F2)',
                color: 'var(--text)',
                borderRadius: '9999px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                border: 'none',
                maxWidth: '150px',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                cursor: 'pointer',
                outline: 'none',
                fontFamily: 'inherit'
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

      {/* 2. Segmented Tabs: All | Prerequisite | Related */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div
          style={{
            display: 'inline-flex',
            background: 'var(--surface-subtle, #F0F0F2)',
            borderRadius: '9999px',
            padding: '3px',
            gap: '2px',
            width: 'fit-content'
          }}
          role="tablist"
          aria-label="Filter concepts by relation type"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            onClick={() => setFilter('all')}
            style={{
              height: '32px',
              padding: '0 16px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: filter === 'all' ? 700 : 500,
              border: 'none',
              cursor: 'pointer',
              background: filter === 'all' ? '#111113' : 'transparent',
              color: filter === 'all' ? '#FFFFFF' : 'var(--muted)',
              transition: 'all 0.15s ease'
            }}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'prereq'}
            onClick={() => setFilter('prereq')}
            style={{
              height: '32px',
              padding: '0 16px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: filter === 'prereq' ? 700 : 500,
              border: 'none',
              cursor: 'pointer',
              background: filter === 'prereq' ? '#111113' : 'transparent',
              color: filter === 'prereq' ? '#FFFFFF' : 'var(--muted)',
              transition: 'all 0.15s ease'
            }}
          >
            Prerequisite
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'related'}
            onClick={() => setFilter('related')}
            style={{
              height: '32px',
              padding: '0 16px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: filter === 'related' ? 700 : 500,
              border: 'none',
              cursor: 'pointer',
              background: filter === 'related' ? '#111113' : 'transparent',
              color: filter === 'related' ? '#FFFFFF' : 'var(--muted)',
              transition: 'all 0.15s ease'
            }}
          >
            Related
          </button>
        </div>

        {/* 3. Legend Key */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.4 }}>
          <span>Lime: learn first (prerequisite)</span>
          <span>Lavender: study together (related)</span>
        </div>
      </div>

      {/* 4. Body Content (Clusters & Concepts) */}
      <div
        ref={listContainerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: 'auto',
          maxHeight: '260px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          scrollbarWidth: 'thin'
        }}
        tabIndex={0}
      >
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px 0' }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  height: '44px',
                  background: 'var(--surface-subtle, #F0F0F2)',
                  borderRadius: '12px',
                  opacity: 0.6
                }}
              />
            ))}
          </div>
        ) : error ? (
          <div style={{ padding: '16px', textAlign: 'center', background: 'rgba(239, 68, 68, 0.08)', borderRadius: '14px' }}>
            <p style={{ fontSize: '13px', color: '#DC2626', margin: '0 0 8px' }}>{error}</p>
            <button
              type="button"
              className="pill"
              onClick={handleRetry}
              style={{ background: '#111113', color: '#FFFFFF', padding: '6px 14px', fontSize: '12px', border: 'none', cursor: 'pointer' }}
            >
              Retry
            </button>
          </div>
        ) : displayedClusters.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
            No concepts match the selected filter.
          </div>
        ) : (
          displayedClusters.map((cluster, cIdx) => {
            const clusterName = cluster.name || `Cluster ${cIdx + 1}`;
            const clusterTopics = cluster.topics || [];

            return (
              <div key={clusterName} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {/* Cluster Header Row: Cluster 1 + 2 concepts */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: 'var(--surface-subtle, #F0F0F2)',
                    borderRadius: '10px'
                  }}
                >
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text)' }}>
                    {clusterName}
                  </span>
                  <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>
                    {clusterTopics.length} {clusterTopics.length === 1 ? 'concept' : 'concepts'}
                  </span>
                </div>

                {/* Concept Rows: 44px high */}
                {clusterTopics.map((topic) => {
                  const topicName = topic.name;
                  const prereqs = Array.isArray(topic.prerequisites) ? topic.prerequisites : [];
                  const related = Array.isArray(topic.related) ? topic.related : [];
                  const prereqCount = prereqs.length;
                  const relatedCount = related.length;
                  const isExpanded = expandedConceptName === topicName;

                  return (
                    <div
                      key={topic.id || topicName}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        background: isExpanded ? 'var(--surface-subtle, #F0F0F2)' : 'transparent',
                        borderRadius: '12px',
                        overflow: 'hidden',
                        transition: 'background 0.15s ease'
                      }}
                    >
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleRowClick(topicName)}
                        onKeyDown={(e) => handleRowKeyDown(e, topicName)}
                        style={{
                          height: '44px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0 10px',
                          cursor: 'pointer',
                          borderRadius: '10px'
                        }}
                      >
                        {/* Concept Name with Ellipsis */}
                        <span
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '60%'
                          }}
                          title={topicName}
                        >
                          {topicName}
                        </span>

                        {/* Count Chips + Chevron */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span
                            className="pill"
                            style={{
                              background: '#D7F25C',
                              color: '#111113',
                              padding: '2px 8px',
                              fontSize: '11px',
                              fontWeight: 700
                            }}
                            title={`${prereqCount} prerequisites`}
                          >
                            {prereqCount}
                          </span>

                          <span
                            className="pill"
                            style={{
                              background: '#B7A9F2',
                              color: '#111113',
                              padding: '2px 8px',
                              fontSize: '11px',
                              fontWeight: 700
                            }}
                            title={`${relatedCount} related topics`}
                          >
                            {relatedCount}
                          </span>

                          <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', marginLeft: '2px' }}>
                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </span>
                        </div>
                      </div>

                      {/* Inline Expanded Panel */}
                      {isExpanded && (
                        <div style={{ padding: '8px 12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                          {topic.definition && (
                            <p style={{ fontSize: '13px', color: 'var(--text)', margin: 0, lineHeight: 1.4 }}>
                              {topic.definition}
                            </p>
                          )}
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="pill card--lime"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenConceptInResults(topicName);
                              }}
                              style={{ border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 700, padding: '4px 10px' }}
                            >
                              Explore in Graph
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* 5. Footer: Showing X of Y concepts */}
      <div style={{ fontSize: '12px', color: 'var(--muted)', textAlign: 'center', paddingTop: '4px' }}>
        Showing {displayedConceptsCount} of {totalConceptsCount} concepts
      </div>
    </div>
  );
}
