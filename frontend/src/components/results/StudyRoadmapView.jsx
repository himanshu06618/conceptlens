import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  CircleDot,
  Minus,
  Clock,
  ArrowRight,
  BookOpen,
  Award,
  ChevronRight,
  Lock,
  Sparkles
} from 'lucide-react';

export default function StudyRoadmapView({
  concepts = [],
  documentId,
  selectedConcept,
  onSelectConcept,
  onToggleStudied,
  isAuthenticated = false,
  onMarkChapterComplete
}) {
  const navigate = useNavigate();
  // Concept lookup map
  const conceptMap = useMemo(() => {
    const map = new Map();
    concepts.forEach(c => {
      map.set(String(c.id), c);
      map.set(String(c.name).toLowerCase().trim(), c);
    });
    return map;
  }, [concepts]);

  // Topological sort to establish stable global sequence 1..N
  const { conceptSeqMap, sortedGlobalConcepts } = useMemo(() => {
    const seqMap = new Map();
    const nameMap = new Map();
    concepts.forEach(c => {
      if (c && c.name) {
        nameMap.set(String(c.name).toLowerCase().trim(), c);
      }
    });

    const inDegree = new Map();
    const adj = new Map();
    concepts.forEach(c => {
      inDegree.set(c.id, 0);
      adj.set(c.id, []);
    });

    concepts.forEach(c => {
      const prereqs = Array.isArray(c.prerequisites) ? c.prerequisites : [];
      prereqs.forEach(pName => {
        const pObj = nameMap.get(String(pName).toLowerCase().trim());
        if (pObj && pObj.id !== c.id && inDegree.has(c.id)) {
          inDegree.set(c.id, inDegree.get(c.id) + 1);
          adj.get(pObj.id).push(c.id);
        }
      });
    });

    const queue = [];
    concepts.forEach(c => {
      if (inDegree.get(c.id) === 0) queue.push(c);
    });

    const tieBreakSort = (a, b) => {
      const pA = a.source_page || a.page || (Array.isArray(a.pages) && a.pages[0]) || 99999;
      const pB = b.source_page || b.page || (Array.isArray(b.pages) && b.pages[0]) || 99999;
      if (pA !== pB) return pA - pB;
      const impA = Number(a.importance) || 1;
      const impB = Number(b.importance) || 1;
      if (impB !== impA) return impB - impA;
      return String(a.name || '').localeCompare(String(b.name || ''));
    };

    queue.sort(tieBreakSort);

    const ordered = [];
    let seq = 1;
    const visited = new Set();

    while (queue.length > 0) {
      queue.sort(tieBreakSort);
      const curr = queue.shift();
      if (visited.has(curr.id)) continue;
      visited.add(curr.id);
      seqMap.set(curr.id, seq++);
      ordered.push(curr);

      const neighbors = adj.get(curr.id) || [];
      neighbors.forEach(nId => {
        inDegree.set(nId, inDegree.get(nId) - 1);
        if (inDegree.get(nId) === 0) {
          const nObj = concepts.find(c => c.id === nId);
          if (nObj && !visited.has(nId)) queue.push(nObj);
        }
      });
    }

    // Append unvisited (cycles or disconnected)
    const remaining = concepts.filter(c => !visited.has(c.id)).sort(tieBreakSort);
    remaining.forEach(c => {
      seqMap.set(c.id, seq++);
      ordered.push(c);
    });

    return { conceptSeqMap: seqMap, sortedGlobalConcepts: ordered };
  }, [concepts]);

  // Group concepts by chapter in topological chapter order, keeping global sequence
  const stages = useMemo(() => {
    const groups = new Map();
    concepts.forEach(c => {
      const ch = c.chapter || c.topic || 'General';
      if (!groups.has(ch)) {
        groups.set(ch, {
          title: ch,
          order: Number(c.chapter_order) || 0,
          concepts: [],
        });
      }
      groups.get(ch).concepts.push(c);
    });

    // Sort chapters by chapter_order
    const sortedStages = Array.from(groups.values()).sort((a, b) => a.order - b.order);

    // Compute status (studied, next_up, locked) for each concept
    const studiedSet = new Set(
      concepts.filter(c => c.status === 'studied').map(c => String(c.id))
    );

    sortedStages.forEach((stage, sIdx) => {
      stage.stageIndex = sIdx + 1;
      let stageMinutes = 0;
      let stageDone = 0;

      stage.concepts.forEach(c => {
        const estMin = Math.max(1, Number(c.estimated_minutes) || 5);
        stageMinutes += estMin;

        // Attach stable global sequence number
        const seq = conceptSeqMap.get(c.id) || 1;
        c.keySeq = seq;
        c.keyConceptLabel = `Key concept ${seq}`;

        if (c.status === 'studied') {
          stageDone += 1;
          c.roadmapStatus = 'studied';
        } else {
          // Check if all prerequisites are studied
          const prereqs = Array.isArray(c.prerequisites) ? c.prerequisites : [];
          const unstudiedPrereqObjs = [];

          for (const p of prereqs) {
            const pObj = conceptMap.get(String(p).toLowerCase().trim());
            if (pObj && !studiedSet.has(String(pObj.id))) {
              unstudiedPrereqObjs.push(pObj);
            }
          }

          if (unstudiedPrereqObjs.length === 0) {
            c.roadmapStatus = 'available';
          } else {
            c.roadmapStatus = 'locked';
            unstudiedPrereqObjs.sort((a, b) => (conceptSeqMap.get(a.id) || 0) - (conceptSeqMap.get(b.id) || 0));
            const seqList = unstudiedPrereqObjs.map(p => conceptSeqMap.get(p.id) || '?');
            c.lockedReason = `Needs key concept ${seqList.join(' and ')}`;
          }
        }
      });

      // Sort concepts within stage by global keySeq so sequence flows cleanly
      stage.concepts.sort((a, b) => (a.keySeq || 0) - (b.keySeq || 0));

      stage.totalMinutes = stageMinutes;
      stage.doneCount = stageDone;
      stage.totalCount = stage.concepts.length;
      stage.isComplete = stageDone === stage.totalCount && stage.totalCount > 0;
    });

    return sortedStages;
  }, [concepts, conceptMap, conceptSeqMap]);

  // Find the "next up" concept: lowest-numbered unstudied concept whose prerequisites are done
  const nextUpConcept = useMemo(() => {
    // Search sortedGlobalConcepts in topological sequence order
    for (const c of sortedGlobalConcepts) {
      if (c.status !== 'studied' && c.roadmapStatus !== 'locked') {
        c.roadmapStatus = 'next_up';
        return c;
      }
    }
    // Fallback: lowest-numbered unstudied concept
    for (const c of sortedGlobalConcepts) {
      if (c.status !== 'studied') {
        return c;
      }
    }
    return null;
  }, [sortedGlobalConcepts]);

  // Find current stage (first incomplete stage)
  const currentStage = useMemo(() => {
    return stages.find(s => !s.isComplete) || stages[0];
  }, [stages]);

  // Overall progress stats
  const { totalConcepts, totalDone, percentDone, totalMinutesRemaining } = useMemo(() => {
    const total = concepts.length;
    const done = concepts.filter(c => c.status === 'studied').length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    const remaining = concepts
      .filter(c => c.status !== 'studied')
      .reduce((sum, c) => sum + (Math.max(1, Number(c.estimated_minutes) || 5)), 0);

    return {
      totalConcepts: total,
      totalDone: done,
      percentDone: percent,
      totalMinutesRemaining: remaining,
    };
  }, [concepts]);

  return (
    <div className="study-roadmap-container" role="region" aria-label="Study Roadmap View">
      {/* Header Progress Bar */}
      <div className="roadmap-header-card">
        <div className="roadmap-progress-row">
          <div className="roadmap-progress-info">
            <span className="roadmap-progress-title">Curriculum Progress</span>
            <strong className="roadmap-progress-value">
              {percentDone}% Completed ({totalDone} of {totalConcepts} concepts)
            </strong>
          </div>
          <div className="roadmap-time-info">
            <Clock size={16} />
            <span>
              {Math.floor(totalMinutesRemaining / 60)}h {totalMinutesRemaining % 60}m remaining
            </span>
          </div>
        </div>

        <div className="roadmap-progress-bar-track">
          <div 
            className="roadmap-progress-bar-fill" 
            style={{ width: `${percentDone}%` }}
          />
        </div>

        {nextUpConcept && (
          <div className="roadmap-continue-banner">
            <div className="banner-left">
              <span className="banner-badge">NEXT UP</span>
              <span className="banner-concept-name">
                Key concept {nextUpConcept.keySeq}: {nextUpConcept.name}
              </span>
              <span className="banner-concept-chapter">
                ({nextUpConcept.chapter || nextUpConcept.topic || 'General'})
              </span>
            </div>
            <button
              type="button"
              className="roadmap-continue-btn"
              onClick={() => onSelectConcept && onSelectConcept(nextUpConcept)}
              aria-label={`Continue with next concept: Key concept ${nextUpConcept.keySeq}: ${nextUpConcept.name}`}
            >
              <span>Continue</span>
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>

      {/* Stages Grid / Horizontally scrollable row */}
      <div 
        className={`roadmap-stages-wrapper ${stages.length > 6 ? 'is-scrollable' : ''}`}
        role="feed"
        aria-label="Roadmap Stages"
      >
        {stages.map((stage) => {
          const isCurrent = currentStage && currentStage.title === stage.title;

          return (
            <div
              key={stage.title}
              className={`roadmap-stage-column ${isCurrent ? 'is-current-stage' : ''} ${stage.isComplete ? 'is-complete-stage' : ''}`}
              role="article"
            >
              {/* Stage Header */}
              <div className="stage-card-header">
                <div className="stage-badge-row">
                  <span className="stage-num-badge">STAGE {stage.stageIndex}</span>
                  <span className="stage-mins-badge">
                    <Clock size={11} />
                    {stage.totalMinutes}m
                  </span>
                </div>
                <h3 className="stage-chapter-title" title={stage.title}>{stage.title}</h3>
                <div className="stage-progress-indicator">
                  <span>{stage.doneCount} of {stage.totalCount} done</span>
                  {stage.isComplete && <CheckCircle2 size={14} className="stage-complete-icon" />}
                </div>
              </div>

              {/* Concept Rows List */}
              <div className="stage-concepts-list">
                {stage.concepts.map((concept) => {
                  const isSelected = selectedConcept && String(selectedConcept.id) === String(concept.id);
                  const isStudied = concept.status === 'studied';
                  const isNextUp = nextUpConcept && String(nextUpConcept.id) === String(concept.id);
                  const isLocked = concept.roadmapStatus === 'locked';

                  return (
                    <div
                      key={concept.id}
                      className={`roadmap-concept-row ${isSelected ? 'is-selected' : ''} ${isStudied ? 'is-studied' : ''} ${isNextUp ? 'is-next-up' : ''} ${isLocked ? 'is-locked' : ''}`}
                      onClick={() => onSelectConcept && onSelectConcept(concept)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Key concept ${concept.keySeq}: ${concept.name}, status: ${isNextUp ? 'next_up' : concept.roadmapStatus || 'available'}`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSelectConcept && onSelectConcept(concept);
                        }
                      }}
                    >
                      {/* Check / Ring / Dash Status Icon */}
                      <div className="concept-status-slot">
                        {isStudied ? (
                          <button
                            type="button"
                            className="status-toggle-btn studied"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isAuthenticated && onToggleStudied) onToggleStudied(concept);
                            }}
                            title="Mark not started"
                            aria-label="Mark concept as not started"
                          >
                            <CheckCircle2 size={16} />
                          </button>
                        ) : isNextUp ? (
                          <button
                            type="button"
                            className="status-toggle-btn next-up"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isAuthenticated && onToggleStudied) onToggleStudied(concept);
                            }}
                            title="Next up! Click to mark studied"
                            aria-label="Next concept up. Click to mark studied"
                          >
                            <CircleDot size={16} />
                          </button>
                        ) : isLocked ? (
                          <div 
                            className="status-toggle-btn locked"
                            title={concept.lockedReason || "Prerequisites not yet studied"}
                            aria-label={concept.lockedReason || "Locked concept"}
                          >
                            <Lock size={14} />
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="status-toggle-btn available"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isAuthenticated && onToggleStudied) onToggleStudied(concept);
                            }}
                            title="Click to mark studied"
                            aria-label="Click to mark concept studied"
                          >
                            <Minus size={16} />
                          </button>
                        )}
                      </div>

                      {/* Numbered Key Concept and Name */}
                      <div className="concept-name-slot">
                        <div className="c-row-title-wrap">
                          <span className="c-row-seq-tag">Key concept {concept.keySeq}</span>
                          <span className="c-row-name" title={concept.name}>{concept.name}</span>
                        </div>
                        {isLocked && concept.lockedReason && (
                          <span className="c-row-locked-note">
                            {concept.lockedReason}
                          </span>
                        )}
                      </div>

                      {(concept.source_page || concept.page) && (
                        <button
                          type="button"
                          className="roadmap-page-chip"
                          onClick={(e) => {
                            e.stopPropagation();
                            const p = concept.source_page || concept.page || 1;
                            const q = encodeURIComponent(concept.source_quote || concept.name);
                            const docId = concept.document_id || documentId;
                            if (docId) {
                              navigate(`/viewer?doc=${docId}&page=${p}&q=${q}`);
                            } else {
                              onSelectConcept && onSelectConcept(concept);
                            }
                          }}
                          title={`Open page ${concept.source_page || concept.page} in PDF viewer`}
                        >
                          p.{concept.source_page || concept.page}
                        </button>
                      )}

                      <div className="concept-time-slot">
                        <span>{concept.estimated_minutes || 5}m</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stage Footer: Continue Button if current stage has next-up */}
              {isCurrent && nextUpConcept && (
                <div className="stage-card-footer">
                  <button
                    type="button"
                    className="stage-continue-action-btn"
                    onClick={() => onSelectConcept && onSelectConcept(nextUpConcept)}
                    aria-label={`Continue next concept: Key concept ${nextUpConcept.keySeq}: ${nextUpConcept.name}`}
                  >
                    <span>Continue: Key concept {nextUpConcept.keySeq}</span>
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
