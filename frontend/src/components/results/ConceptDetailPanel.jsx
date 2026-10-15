import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  X, 
  Clock, 
  CheckCircle2, 
  Circle, 
  Lock, 
  GitBranch, 
  ArrowRight,
  Sparkles,
  BookOpen,
  FileText,
  ExternalLink,
  Quote
} from 'lucide-react';

export default function ConceptDetailPanel({
  concept,
  documentId,
  allConcepts = [],
  isAuthenticated = false,
  onClose,
  onSelectConcept,
  onToggleStudied,
  onJumpToTab,
  learningPath = null, // array of prerequisite steps to this concept
  className = ''
}) {
  const navigate = useNavigate();
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

        {/* Source Section: Page Badge, Quote, and In-App PDF Link */}
        <div className="detail-section detail-source-section">
          <div className="detail-source-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h4 className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: 0 }}>
              <FileText size={14} className="text-muted" />
              <span>Source In Document</span>
            </h4>
            {concept.source_page ? (
              <span className="detail-page-badge" style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: 'rgba(212, 248, 40, 0.16)', color: 'var(--accent-lime, #d4f828)', fontWeight: 600 }}>
                Page {concept.source_page}
              </span>
            ) : null}
          </div>

          {concept.source_quote ? (
            <blockquote className="detail-source-quote" style={{ margin: '0 0 10px 0', padding: '10px 12px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.04)', borderLeft: '3px solid var(--accent-lime, #d4f828)', fontStyle: 'italic', fontSize: '0.86rem', color: 'var(--text-secondary, #d1d5db)', lineHeight: 1.45 }}>
              "{concept.source_quote}"
            </blockquote>
          ) : (
            <p className="detail-empty-hint">
              {concept.source_page 
                ? `Introduced on page ${concept.source_page}.`
                : 'Page location not indexed for this concept.'}
            </p>
          )}

          {(() => {
            const docId = concept.document_id || documentId;
            if (!docId) return null;
            return (
              <button
                type="button"
                className="detail-open-pdf-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255, 255, 255, 0.07)', border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.12))', color: 'var(--text-primary, #f3f4f6)', fontSize: '0.82rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s ease', width: '100%', justifyContent: 'center' }}
                onClick={() => {
                  const pageParam = concept.source_page || concept.page || 1;
                  const queryParam = encodeURIComponent(concept.source_quote || concept.name);
                  navigate(`/viewer?doc=${docId}&page=${pageParam}&q=${queryParam}`);
                }}
                title="Open source page in in-app PDF viewer"
              >
                <ExternalLink size={13} style={{ color: 'var(--accent-lime, #d4f828)' }} />
                <span>Open in PDF Viewer (p. {concept.source_page || concept.page || 1})</span>
              </button>
            );
          })()}
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
