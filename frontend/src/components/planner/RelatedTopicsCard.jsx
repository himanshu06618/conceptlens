import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Sparkles, BookOpen, Layers } from 'lucide-react';
import { getChapterRelations } from '../../api/client';

export default function RelatedTopicsCard({
  chapters = [],
  selectedChapterId = null,
  onSelectChapter = () => {},
  activePlan = null
}) {
  const [currentChapterId, setCurrentChapterId] = useState(
    selectedChapterId || (chapters[0]?.id || '')
  );
  const [relationsData, setRelationsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState({});

  useEffect(() => {
    if (selectedChapterId) {
      setCurrentChapterId(selectedChapterId);
    } else if (chapters.length > 0 && !currentChapterId) {
      setCurrentChapterId(chapters[0].id);
    }
  }, [selectedChapterId, chapters]);

  useEffect(() => {
    if (!currentChapterId) return;
    let isCancelled = false;
    setLoading(true);

    getChapterRelations(currentChapterId)
      .then((data) => {
        if (!isCancelled) {
          setRelationsData(data);
          // Expand all clusters initially
          const exp = {};
          (data?.clusters || []).forEach((c, idx) => {
            exp[c.name || idx] = true;
          });
          setExpandedClusters(exp);
        }
      })
      .catch((err) => {
        console.error('Failed to load relations:', err);
      })
      .finally(() => {
        if (!isCancelled) setLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [currentChapterId]);

  const toggleCluster = (cKey) => {
    setExpandedClusters((prev) => ({
      ...prev,
      [cKey]: !prev[cKey]
    }));
  };

  // Build topic scheduled day lookup from active plan
  const topicDayMap = {};
  if (activePlan?.route) {
    activePlan.route.forEach((day) => {
      day.items?.forEach((item) => {
        if (item.chapter_id === currentChapterId) {
          item.topics?.forEach((tName) => {
            topicDayMap[tName] = `Day ${day.day_index}`;
          });
        }
      });
    });
  }

  const clusters = relationsData?.clusters || [];
  const currentChapter = chapters.find((c) => c.id === currentChapterId);
  const isChapterDone = currentChapter?.status === 2;

  return (
    <div className="planner-section-card">
      <div className="planner-section-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Layers size={20} color="var(--planner-mint)" />
          Related Topics & Learning Clusters
        </span>

        {chapters.length > 1 && (
          <select
            className="planner-select"
            value={currentChapterId}
            onChange={(e) => {
              setCurrentChapterId(e.target.value);
              onSelectChapter(e.target.value);
            }}
            aria-label="Select chapter for related topics"
          >
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Legend with two relation chips */}
      <div className="related-topics-legend">
        <span className="legend-chip legend-chip-prereq">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--planner-orange)' }} />
          Prerequisite: study this first
        </span>
        <span className="legend-chip legend-chip-related">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--planner-mint)' }} />
          Related: study close together
        </span>
      </div>

      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--planner-text-muted)' }}>
          Loading topic relationships...
        </div>
      ) : clusters.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--planner-text-muted)', background: 'var(--planner-chip-bg)', borderRadius: 'var(--planner-radius-sm)' }}>
          No topics or relations found for this chapter yet.
        </div>
      ) : (
        <div className="clusters-accordion-wrap">
          {clusters.map((cluster, cIdx) => {
            const isExpanded = expandedClusters[cluster.name || cIdx] !== false;
            const clusterTopics = cluster.topics || [];
            const isLastCluster = cIdx === clusters.length - 1;
            const runsUntilTopic = cluster.runs_until_topic || clusterTopics[clusterTopics.length - 1]?.name || 'end of unit';
            const nextTopic = cluster.next_topic;

            return (
              <div key={cluster.name || cIdx} className="cluster-card">
                <div
                  className="cluster-card-header"
                  onClick={() => toggleCluster(cluster.name || cIdx)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleCluster(cluster.name || cIdx);
                    }
                  }}
                >
                  <div className="cluster-card-title">
                    <Sparkles size={16} color="var(--planner-orange)" />
                    <span>{cluster.name || `Cluster ${cIdx + 1}`}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.7, fontWeight: 'normal' }}>
                      ({clusterTopics.length} topics)
                    </span>
                  </div>
                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>

                {isExpanded && (
                  <div className="cluster-card-body">
                    {clusterTopics.map((topic) => {
                      const dayBadge = isChapterDone
                        ? 'Done'
                        : topicDayMap[topic.name] || (currentChapter?.status === 1 ? 'In Progress' : 'Pending');

                      const hasRelations =
                        (topic.prerequisites && topic.prerequisites.length > 0) ||
                        (topic.related && topic.related.length > 0) ||
                        (topic.leads_to && topic.leads_to.length > 0);

                      return (
                        <div key={topic.id || topic.name} className="cluster-topic-item">
                          <div className="cluster-topic-main-line">
                            <span>{topic.name}</span>
                            <span
                              style={{
                                fontSize: '0.75rem',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                background:
                                  dayBadge === 'Done'
                                    ? 'var(--planner-mint-light)'
                                    : dayBadge.startsWith('Day')
                                    ? 'var(--planner-peach)'
                                    : 'var(--planner-chip-bg)',
                                color:
                                  dayBadge === 'Done'
                                    ? 'var(--planner-mint)'
                                    : dayBadge.startsWith('Day')
                                    ? 'var(--planner-orange)'
                                    : 'var(--planner-text-muted)',
                                fontWeight: 600
                              }}
                            >
                              {dayBadge}
                            </span>
                          </div>

                          {hasRelations && (
                            <div className="cluster-topic-relations-line">
                              {topic.prerequisites && topic.prerequisites.length > 0 && (
                                <>
                                  <span>needs first</span>
                                  {topic.prerequisites.map((p, idx) => (
                                    <span key={idx} className="relation-inline-tag rel-tag-prereq">
                                      {p}
                                    </span>
                                  ))}
                                </>
                              )}

                              {topic.related && topic.related.length > 0 && (
                                <>
                                  <span>related to</span>
                                  {topic.related.map((r, idx) => (
                                    <span key={idx} className="relation-inline-tag rel-tag-related">
                                      {r}
                                    </span>
                                  ))}
                                </>
                              )}

                              {topic.leads_to && topic.leads_to.length > 0 && (
                                <>
                                  <span>leads to</span>
                                  {topic.leads_to.map((l, idx) => (
                                    <span key={idx} className="relation-inline-tag rel-tag-prereq">
                                      {l}
                                    </span>
                                  ))}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="cluster-footer-note">
                      These topics are related and build on each other. The link runs until{' '}
                      <strong>{runsUntilTopic}</strong>.{' '}
                      {isLastCluster ? (
                        <span>Finish with a quick revision of the whole chapter.</span>
                      ) : (
                        <span>
                          After this, start <strong>{nextTopic || 'the next cluster'}</strong>.
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
