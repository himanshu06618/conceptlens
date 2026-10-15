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

  // Group concepts by chapter in topological chapter order
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

    let nextUpFound = false;

    sortedStages.forEach((stage, sIdx) => {
      stage.stageIndex = sIdx + 1;
      let stageMinutes = 0;
      let stageDone = 0;

      stage.concepts.forEach(c => {
        const estMin = Math.max(1, Number(c.estimated_minutes) || 5);
        stageMinutes += estMin;

        if (c.status === 'studied') {
          stageDone += 1;
          c.roadmapStatus = 'studied';
        } else {
          // Check if all prerequisites are studied
          const prereqs = c.prerequisites || [];
          let allPrereqsStudied = true;

          for (const p of prereqs) {
            const pObj = conceptMap.get(String(p).toLowerCase().trim());
            if (pObj && !studiedSet.has(String(pObj.id))) {
              allPrereqsStudied = false;
              break;
            }
          }

          if (allPrereqsStudied && !nextUpFound) {
            c.roadmapStatus = 'next_up';
            nextUpFound = true;
          } else if (allPrereqsStudied) {
            c.roadmapStatus = 'available';
          } else {
            c.roadmapStatus = 'locked';
          }
        }
      });

      stage.totalMinutes = stageMinutes;
      stage.doneCount = stageDone;
      stage.totalCount = stage.concepts.length;
      stage.isComplete = stageDone === stage.totalCount && stage.totalCount > 0;
    });

    return sortedStages;
  }, [concepts, conceptMap]);

  // Find first stage that is not complete (current stage)
  const currentStage = useMemo(() => {
    return stages.find(s => !s.isComplete) || stages[0];
  }, [stages]);

  // Find the "next up" concept across the whole document
  const nextUpConcept = useMemo(() => {
    for (const stage of stages) {
      const found = stage.concepts.find(c => c.roadmapStatus === 'next_up');
      if (found) return found;
    }
    // If none found with 'next_up', take first unstudied concept
    for (const stage of stages) {
      const found = stage.concepts.find(c => c.status !== 'studied');
      if (found) return found;
    }
    return null;
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
              <span className="banner-concept-name">{nextUpConcept.name}</span>
              <span className="banner-concept-chapter">
                ({nextUpConcept.chapter || nextUpConcept.topic || 'General'})
              </span>
            </div>
            <button
              type="button"
              className="roadmap-continue-btn"
              onClick={() => onSelectConcept && onSelectConcept(nextUpConcept)}
              aria-label={`Continue with next concept: ${nextUpConcept.name}`}
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
                  const isNextUp = concept.roadmapStatus === 'next_up';
                  const isLocked = concept.roadmapStatus === 'locked';

                  return (
                    <div
                      key={concept.id}
                      className={`roadmap-concept-row ${isSelected ? 'is-selected' : ''} ${isStudied ? 'is-studied' : ''} ${isNextUp ? 'is-next-up' : ''} ${isLocked ? 'is-locked' : ''}`}
                      onClick={() => onSelectConcept && onSelectConcept(concept)}
                      role="button"
                      tabIndex={0}
                      aria-label={`${concept.name}, status: ${concept.roadmapStatus || 'available'}`}
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
                            title="Prerequisites not yet studied (soft lock)"
                            aria-label="Locked concept, click to view"
                          >
                            <Minus size={16} />
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

                      <div className="concept-name-slot">
                        <span className="c-row-name" title={concept.name}>{concept.name}</span>
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

              {/* Stage Footer: Continue Button if current */}
              {isCurrent && nextUpConcept && (
                <div className="stage-card-footer">
                  <button
                    type="button"
                    className="stage-continue-action-btn"
                    onClick={() => onSelectConcept && onSelectConcept(nextUpConcept)}
                    aria-label={`Continue next concept in this stage: ${nextUpConcept.name}`}
                  >
                    <span>Continue: {nextUpConcept.name}</span>
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
