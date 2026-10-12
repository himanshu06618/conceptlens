import React, { useMemo } from 'react';
import { 
  X, 
  Clock, 
  CheckCircle2, 
  Circle, 
  Lock, 
  GitBranch, 
  Waypoints, 
  Compass, 
  Network, 
  ArrowRight,
  Sparkles,
  BookOpen
} from 'lucide-react';

export default function ConceptDetailPanel({
  concept,
  allConcepts = [],
  isAuthenticated = false,
  onClose,
  onSelectConcept,
  onToggleStudied,
  onJumpToTab,
  learningPath = null, // array of prerequisite steps to this concept
  className = ''
}) {
  if (!concept) return null;

  // Find prerequisite concept objects
  const prerequisites = useMemo(() => {
    const prereqNamesOrIds = new Set(
      (concept.prerequisites || []).map(p => String(p).toLowerCase().trim())
    );
    // Also check related_concepts with relation_type === 'prerequisite'
    (concept.related_concepts || []).forEach(rel => {
      if (rel.relation_type === 'prerequisite' || rel.type === 'prerequisite') {
        prereqNamesOrIds.add(String(rel.name || rel.concept_id || '').toLowerCase().trim());
      }
    });

    return allConcepts.filter(c => {
      if (String(c.id) === String(concept.id)) return false;
      const cName = String(c.name || '').toLowerCase().trim();
      const cId = String(c.id).toLowerCase().trim();
      return prereqNamesOrIds.has(cName) || prereqNamesOrIds.has(cId);
    });
  }, [concept, allConcepts]);

  // Find related concept objects
  const relatedList = useMemo(() => {
    const relNamesOrIds = new Set(
      (concept.related || []).map(r => String(r).toLowerCase().trim())
    );
    (concept.related_concepts || []).forEach(rel => {
      if (rel.relation_type !== 'prerequisite' && rel.type !== 'prerequisite') {
        relNamesOrIds.add(String(rel.name || rel.concept_id || '').toLowerCase().trim());
      }
    });

    return allConcepts.filter(c => {
      if (String(c.id) === String(concept.id)) return false;
      const cName = String(c.name || '').toLowerCase().trim();
      const cId = String(c.id).toLowerCase().trim();
      return relNamesOrIds.has(cName) || relNamesOrIds.has(cId);
    });
  }, [concept, allConcepts]);

  const importanceLevel = Math.max(1, Math.min(3, Number(concept.importance) || 1));
  const estimatedMin = Math.max(1, Number(concept.estimated_minutes) || 5);
  const isStudied = concept.status === 'studied';

  return (
    <aside 
      className={`concept-detail-panel ${className}`} 
      aria-label={`Details for concept: ${concept.name}`}
    >
      <div className="detail-panel-header">
        <div className="detail-panel-title-group">
          <div className="detail-panel-chapter-row">
            <span className="detail-chapter-badge">
              <BookOpen size={12} />
              {concept.chapter || concept.topic || 'General'}
            </span>
            <span className="detail-time-badge">
              <Clock size={12} />
              {estimatedMin} min
            </span>
          </div>
          <h3 className="detail-concept-title">{concept.name}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="detail-close-btn"
          aria-label="Close concept details"
        >
          <X size={18} />
        </button>
      </div>

      <div className="detail-panel-body">
        {/* Importance Rating (3 dots) */}
        <div className="detail-importance-row" aria-label={`Importance: ${importanceLevel} of 3`}>
          <span className="detail-label">Importance</span>
          <div className="detail-importance-dots">
            {[1, 2, 3].map((dot) => (
              <span
                key={dot}
                className={`importance-dot ${dot <= importanceLevel ? 'active' : ''}`}
                title={`Importance ${dot} of 3`}
              />
            ))}
          </div>
        </div>

        {/* Studied Status / Toggle */}
        <div className="detail-status-card">
          {isAuthenticated ? (
            <button
              type="button"
              className={`detail-studied-toggle ${isStudied ? 'is-studied' : ''}`}
              onClick={() => onToggleStudied && onToggleStudied(concept)}
              aria-label={isStudied ? 'Mark concept as not studied' : 'Mark concept as studied'}
            >
              {isStudied ? (
                <>
                  <CheckCircle2 size={18} className="status-icon studied" />
                  <span>Studied</span>
                </>
              ) : (
                <>
                  <Circle size={18} className="status-icon not-started" />
                  <span>Mark as studied</span>
                </>
              )}
            </button>
          ) : (
            <div className="detail-guest-progress-hint">
              <Lock size={15} />
              <span>Sign in to track progress</span>
            </div>
          )}
        </div>

        {/* Definition */}
        <div className="detail-section">
          <h4 className="detail-section-title">Definition</h4>
          <p className="detail-definition-text">
            {concept.definition || 'No definition available for this concept.'}
          </p>
        </div>

        {/* Learning Path (if active/provided) */}
        {learningPath && learningPath.length > 0 && (
          <div className="detail-section detail-learning-path-box">
            <h4 className="detail-section-title">
              <Sparkles size={14} />
              Learning Path to {concept.name}
            </h4>
            <div className="detail-learning-path-steps">
              {learningPath.map((step, idx) => (
                <div 
                  key={step.id || idx}
                  className={`path-step-item ${String(step.id) === String(concept.id) ? 'is-target' : ''}`}
                  onClick={() => onSelectConcept && onSelectConcept(step)}
                  role="button"
                  tabIndex={0}
                >
                  <span className="step-num">{idx + 1}</span>
                  <span className="step-name">{step.name}</span>
                  <span className="step-time">({step.estimated_minutes || 5}m)</span>
                </div>
              ))}
              <div className="path-total-time">
                Total study time: {learningPath.reduce((acc, s) => acc + (s.estimated_minutes || 5), 0)} min
              </div>
            </div>
          </div>
        )}

        {/* Prerequisites ("Learn first") */}
        <div className="detail-section">
          <h4 className="detail-section-title">Learn First</h4>
          {prerequisites.length > 0 ? (
            <div className="detail-chip-group">
              {prerequisites.map((prereq) => (
                <button
                  key={prereq.id}
                  type="button"
                  className={`detail-concept-chip ${prereq.status === 'studied' ? 'is-studied' : ''}`}
                  onClick={() => onSelectConcept && onSelectConcept(prereq)}
                  title={`View prerequisite: ${prereq.name}`}
                >
                  {prereq.status === 'studied' ? (
                    <CheckCircle2 size={12} className="chip-icon studied" />
                  ) : (
                    <Circle size={12} className="chip-icon" />
                  )}
                  <span>{prereq.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="detail-empty-hint">Foundational concept (no prior prerequisites required).</p>
          )}
        </div>

        {/* Related Concepts */}
        <div className="detail-section">
          <h4 className="detail-section-title">Related Concepts</h4>
          {relatedList.length > 0 ? (
            <div className="detail-chip-group">
              {relatedList.map((rel) => (
                <button
                  key={rel.id}
                  type="button"
                  className="detail-concept-chip"
                  onClick={() => onSelectConcept && onSelectConcept(rel)}
                  title={`View related concept: ${rel.name}`}
                >
                  <span>{rel.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="detail-empty-hint">No related concepts linked.</p>
          )}
        </div>

        {/* Quick View Navigation Jumpers */}
        <div className="detail-section detail-jumpers-section">
          <h4 className="detail-section-title">Show In Views</h4>
          <div className="detail-jumpers-grid">
            <button
              type="button"
              className="detail-jump-btn"
              onClick={() => onJumpToTab && onJumpToTab('tree')}
              title="Locate in Concept Tree"
            >
              <GitBranch size={14} />
              <span>Tree</span>
            </button>
            <button
              type="button"
              className="detail-jump-btn"
              onClick={() => onJumpToTab && onJumpToTab('mindmap')}
              title="Locate in Mind Map"
            >
              <Compass size={14} />
              <span>Mind Map</span>
            </button>
            <button
              type="button"
              className="detail-jump-btn"
              onClick={() => onJumpToTab && onJumpToTab('flowchart')}
              title="Locate in Flowchart"
            >
              <Waypoints size={14} />
              <span>Flowchart</span>
            </button>
            <button
              type="button"
              className="detail-jump-btn"
              onClick={() => onJumpToTab && onJumpToTab('roadmap')}
              title="Locate in Study Roadmap"
            >
              <ArrowRight size={14} />
              <span>Roadmap</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
