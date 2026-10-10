import React, { useEffect, useRef } from 'react';
import { 
  X, 
  Copy, 
  Check, 
  BookMarked, 
  Quote, 
  Star,
  ChevronLeft, 
  ChevronRight,
  ExternalLink
} from 'lucide-react';
import { cleanConceptName, cleanText } from '../utils/textCleaner';
import { getDocumentFileUrl } from '../api/client';
import { Badge, IconButton, Button, PaperSurface } from './ui';

export default function ConceptSidePanel({
  concept,
  documentId,
  onClose,
  onSelectRelated,
  currentIndex = -1,
  totalConcepts = 0,
  onNext,
  onPrev
}) {
  const [copied, setCopied] = React.useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // Lock body scroll while open
  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, []);

  // Keyboard accessibility: Escape to close, Left/Right arrow to navigate
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' && onNext) {
        onNext();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        onPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNext, onPrev]);

  if (!concept) return null;

  const handleCopy = () => {
    const textToCopy = concept.definition || concept.source_excerpt || concept.name;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDeepDive = () => {
    const docId = concept.document_id || documentId;
    if (docId) {
      const pageNum = concept.page || 1;
      const fileUrl = getDocumentFileUrl(docId, pageNum);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = touchEndY - touchStartY.current;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 45) {
      if (deltaX < 0 && onNext) {
        onNext();
      } else if (deltaX > 0 && onPrev) {
        onPrev();
      }
    } else if (deltaY > 80) {
      onClose();
    }
  };

  const hasDefinition = Boolean(concept.definition && concept.definition.trim());
  const importance = Math.min(5, Math.max(1, Number(concept.importance) || 3));
  const isTop = importance === 5;

  return (
    <div 
      className="panel-backdrop" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="concept-detail-title"
    >
      <div 
        className="glass-side-panel shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mobile Drag Handle */}
        <div className="panel-drag-handle-wrap" onClick={onClose}>
          <div className="panel-drag-handle" />
        </div>

        {/* Panel Header */}
        <div className="panel-header">
          <div className="panel-header-left">
            {currentIndex >= 0 && totalConcepts > 0 && (
              <span className="panel-counter">
                {currentIndex + 1} of {totalConcepts}
              </span>
            )}
            {isTop && (
              <span className="key-concept-badge">
                <Star size={12} strokeWidth={2} fill="var(--text-on-amber)" />
                <span>KEY CONCEPT</span>
              </span>
            )}
          </div>

          <div className="panel-header-actions">
            {/* Quick Prev/Next Navigation */}
            {onPrev && (
              <IconButton
                icon={ChevronLeft}
                onClick={onPrev}
                disabled={currentIndex <= 0}
                aria-label="Previous concept"
                size="sm"
              />
            )}
            {onNext && (
              <IconButton
                icon={ChevronRight}
                onClick={onNext}
                disabled={currentIndex >= totalConcepts - 1}
                aria-label="Next concept"
                size="sm"
              />
            )}
            <IconButton
              icon={X}
              onClick={onClose}
              aria-label="Close panel"
              size="sm"
            />
          </div>
        </div>

        {/* Panel Title & Meta */}
        <div className="panel-heading-block">
          <h2 id="concept-detail-title" className="panel-title">
            {cleanConceptName(concept.name)}
          </h2>

          <div className="panel-meta-row">
            <Badge variant={concept.topic ? 'sky' : 'amber'} size="sm">
              {concept.topic || 'General'}
            </Badge>
            <button
              type="button"
              className="panel-page-chip clickable"
              onClick={handleDeepDive}
              title={`Deep Dive into PDF on Page ${concept.page || 1}`}
            >
              Page {concept.page || 1}
              <ExternalLink size={10} style={{ marginLeft: 4, opacity: 0.8 }} />
            </button>
            <span className="panel-score-chip">
              {Math.round((concept.score || 0) * 100)}% match
            </span>
            <span className="panel-importance-chip">
              ★ {importance}/5
            </span>
          </div>
        </div>

        {/* Panel Scrollable Body */}
        <div className="panel-body-scroll">
          {/* Definition on PaperSurface */}
          <PaperSurface className="panel-paper-box">
            <div className="panel-section-title">
              <BookMarked size={16} strokeWidth={1.75} style={{ color: 'var(--accent-amber)' }} />
              <span>Extracted Definition</span>
            </div>
            <p className="panel-reading-text">
              {hasDefinition ? `"${cleanText(concept.definition)}"` : (
                <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No standalone definition sentence detected in the notes.
                </span>
              )}
            </p>
          </PaperSurface>

          {/* Context Excerpt on PaperSurface */}
          {concept.source_excerpt && (
            <PaperSurface className="panel-paper-box" style={{ marginTop: 14 }}>
              <div className="panel-section-title">
                <Quote size={16} strokeWidth={1.75} style={{ color: 'var(--accent-amber)' }} />
                <span>Original Lecture Excerpt</span>
              </div>
              <p className="panel-reading-text">
                "{cleanText(concept.source_excerpt)}"
              </p>
            </PaperSurface>
          )}

          {/* Related Concepts */}
          {concept.related_concepts && concept.related_concepts.length > 0 && (
            <div className="panel-related-section">
              <div className="panel-section-title">
                <span>Related Concepts</span>
              </div>
              <div className="panel-related-grid">
                {concept.related_concepts.map((rel, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="panel-related-pill"
                    onClick={() => onSelectRelated && onSelectRelated(rel.name)}
                  >
                    <span>{cleanConceptName(rel.name)}</span>
                    <span className="related-weight">&times;{rel.weight}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Panel Footer Actions */}
        <div className="panel-footer" style={{ display: 'flex', gap: 10 }}>
          <Button
            variant="secondary"
            size="md"
            icon={copied ? Check : Copy}
            onClick={handleCopy}
            style={{ flex: 1 }}
          >
            {copied ? 'Copied!' : 'Copy Definition'}
          </Button>

          <Button
            variant="primary"
            size="md"
            icon={ExternalLink}
            onClick={handleDeepDive}
            style={{ flex: 1.25 }}
            title={`Deep Dive into PDF on Page ${concept.page || 1}`}
          >
            Deep Dive (Page {concept.page || 1})
          </Button>
        </div>
      </div>
    </div>
  );
}
