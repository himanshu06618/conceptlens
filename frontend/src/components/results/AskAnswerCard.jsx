import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  ArrowRight,
  BookOpen,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Split,
  Check,
  X,
  Layers,
  HelpCircle,
  Clock,
  ShieldCheck,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import {
  askNotes,
  fetchMergeSuggestions,
  acceptMergeSuggestion,
  rejectMergeSuggestion
} from '../../api/client';
import BookshelfLoader from '../ui/BookshelfLoader';

export default function AskAnswerCard({
  documentId = null,
  initialQuestion = '',
  onOpenViewer = null,
  onSelectConcept = () => {},
  isAuthenticated = true
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [scope, setScope] = useState('document'); // 'document' | 'all'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [answerData, setAnswerData] = useState(null);

  // Collapsible metadata
  const [isHowBuiltOpen, setIsHowBuiltOpen] = useState(false);
  const [mergeSuggestions, setMergeSuggestions] = useState([]);
  const [actionNotice, setActionNotice] = useState('');

  // Auto-submit if initialQuestion was supplied from another view
  useEffect(() => {
    if (initialQuestion && initialQuestion.trim().length > 1) {
      setQuestion(initialQuestion);
      handleAsk(initialQuestion);
    }
  }, [initialQuestion]);

  const handleAsk = async (qText) => {
    const query = (qText || question || '').trim();
    if (!query) return;

    try {
      setIsLoading(true);
      setError(null);
      const res = await askNotes(query, {
        documentId: scope === 'document' ? documentId : null,
        scope: scope
      });
      setAnswerData(res);

      // Fetch pending merge suggestions to show review card if relevant
      if (isAuthenticated) {
        fetchMergeSuggestions().then(setMergeSuggestions).catch(() => {});
      }
    } catch (err) {
      setError(err.message || 'Could not retrieve answer. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    handleAsk(question);
  };

  const handleAcceptMerge = async (suggId) => {
    try {
      await acceptMergeSuggestion(suggId);
      setActionNotice('Merge accepted! Entities consolidated.');
      setMergeSuggestions(prev => prev.filter(s => s.id !== suggId));
    } catch (err) {
      setActionNotice(`Could not merge: ${err.message}`);
    }
  };

  const handleRejectMerge = async (suggId) => {
    try {
      await rejectMergeSuggestion(suggId);
      setActionNotice('Suggestion rejected and remembered.');
      setMergeSuggestions(prev => prev.filter(s => s.id !== suggId));
    } catch (err) {
      setActionNotice(`Error: ${err.message}`);
    }
  };

  return (
    <div className="ask-card-container" role="region" aria-label="Ask Your Notes Knowledge Assistant">
      {/* 1. Ask Query Bar */}
      <form onSubmit={handleSubmit} className="ask-form">
        <div className="ask-input-row">
          <div className="ask-input-wrap">
            <Sparkles size={16} className="ask-sparkle-icon" />
            <input
              type="text"
              placeholder="Ask a question about your notes, prerequisites, or cross-document concepts..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="ask-query-input"
              aria-label="Question for Ask your notes"
            />
          </div>

          <div className="ask-scope-toggle" role="radiogroup" aria-label="Query scope selector">
            <button
              type="button"
              className={`ask-scope-btn ${scope === 'document' ? 'active' : ''}`}
              onClick={() => setScope('document')}
            >
              This document
            </button>
            <button
              type="button"
              className={`ask-scope-btn ${scope === 'all' ? 'active' : ''}`}
              onClick={() => setScope('all')}
            >
              All my notes
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading || !question.trim()}
            className="ask-submit-btn"
            aria-label="Submit question to notes assistant"
          >
            {isLoading ? 'Searching…' : 'Ask'}
          </button>
        </div>

        {/* Suggested Starter Prompts */}
        <div className="ask-quick-prompts">
          <span className="ask-quick-label">Try asking:</span>
          <button
            type="button"
            className="ask-quick-pill"
            onClick={() => { setQuestion("What are the prerequisites for this topic?"); handleAsk("What are the prerequisites for this topic?"); }}
          >
            "What are the prerequisites?"
          </button>
          <button
            type="button"
            className="ask-quick-pill"
            onClick={() => { setQuestion("How are concepts related across lectures?"); handleAsk("How are concepts related across lectures?"); }}
          >
            "How are concepts related across lectures?"
          </button>
          <button
            type="button"
            className="ask-quick-pill"
            onClick={() => { setQuestion("What should I study next?"); handleAsk("What should I study next?"); }}
          >
            "What should I study next?"
          </button>
        </div>
      </form>

      {/* Action Notification Banner */}
      {actionNotice && (
        <div className="ask-action-banner" role="status">
          <span>{actionNotice}</span>
          <button type="button" onClick={() => setActionNotice('')} aria-label="Dismiss banner">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 2. Loading State */}
      {isLoading && (
        <div className="ask-loader-wrap" style={{ padding: '36px 0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BookshelfLoader message="Synthesizing grounded answer with citations..." />
        </div>
      )}

      {/* Error State with Retry */}
      {error && (
        <div className="ask-error-card" role="alert">
          <AlertTriangle size={18} className="text-amber" />
          <div className="ask-error-text">
            <strong>Could not answer query</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={() => handleAsk(question)} className="ask-retry-btn">
            <RotateCcw size={14} />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* 3. Grounded Answer Card (Screen 3) */}
      {answerData && !isLoading && (
        <div className="ask-answer-card">
          {/* Answer Header Bar: Route Chip & Timing */}
          <div className="ask-answer-header">
            <div className="ask-route-badge">
              <span className="ask-route-dot" />
              <span>Route: <strong>{answerData.route === 'graph' ? 'graph' : answerData.route === 'hybrid' ? 'graph + notes' : answerData.route}</strong></span>
            </div>

            <span className="ask-timing-chip">
              <Clock size={12} />
              <span>{answerData.timing_ms} ms</span>
            </span>
          </div>

          {/* Answer Markdown Text with Page Chips */}
          <div className="ask-answer-body">
            {answerData.not_found ? (
              <div className="ask-not-found-banner">
                <AlertTriangle size={16} />
                <span>This topic was not found in your uploaded notes. Upload additional lecture notes to expand the knowledge graph.</span>
              </div>
            ) : (
              <div className="ask-markdown-content">
                {answerData.answer.split('\n\n').map((paragraph, pIdx) => (
                  <p key={pIdx}>{paragraph}</p>
                ))}
              </div>
            )}
          </div>

          {/* 4. Dependency Path (Chips joined by arrow icons) */}
          {answerData.dependency_path && answerData.dependency_path.length > 0 && (
            <div className="ask-section-wrap">
              <label className="ask-section-heading">DEPENDENCY PATH</label>
              <div className="ask-dependency-path">
                {answerData.dependency_path.map((conceptName, cIdx) => (
                  <React.Fragment key={cIdx}>
                    <button
                      type="button"
                      className="ask-concept-chip"
                      onClick={() => onSelectConcept({ name: conceptName })}
                    >
                      {conceptName}
                    </button>
                    {cIdx < answerData.dependency_path.length - 1 && (
                      <ArrowRight size={14} className="ask-path-arrow" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* 5. Verified Citations & Evidence Badges */}
          {answerData.citations && answerData.citations.length > 0 && (
            <div className="ask-section-wrap">
              <label className="ask-section-heading">VERIFIED EVIDENCE &amp; CITATIONS</label>
              <div className="ask-citations-list">
                {answerData.citations.map((cit, cIdx) => (
                  <div key={cIdx} className="ask-citation-item">
                    <div className="ask-cit-top">
                      <span className={`ask-evidence-badge ${cit.origin}`}>
                        {cit.origin === 'notes' ? 'From your notes' : 'Suggested link'}
                      </span>
                      <span className="ask-cit-source">
                        <BookOpen size={12} />
                        <strong>{cit.filename}</strong> &bull; page {cit.page}
                      </span>
                    </div>

                    {cit.quote && (
                      <blockquote className="ask-cit-quote">
                        "{cit.quote}"
                      </blockquote>
                    )}

                    {onOpenViewer && cit.document_id && (
                      <button
                        type="button"
                        className="ask-open-pdf-btn"
                        onClick={() => onOpenViewer(cit.document_id, cit.page, cit.quote)}
                        aria-label={`Open ${cit.filename} at page ${cit.page}`}
                      >
                        <ExternalLink size={12} />
                        <span>Open in PDF viewer (p. {cit.page})</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. "How this answer was built" Box */}
          <div className="ask-how-built-box">
            <button
              type="button"
              className="ask-how-built-trigger"
              onClick={() => setIsHowBuiltOpen(prev => !prev)}
              aria-expanded={isHowBuiltOpen}
            >
              <ShieldCheck size={15} className="text-lime" />
              <span>How this answer was built</span>
              {isHowBuiltOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {isHowBuiltOpen && (
              <div className="ask-how-built-details">
                <div className="ask-meta-metric">
                  <strong>Notes Passages:</strong> {answerData.passages_count || answerData.citations?.length || 0} retrieved
                </div>
                <div className="ask-meta-metric">
                  <strong>Knowledge Links:</strong> {answerData.links_count || 0} facts verified
                </div>
                <div className="ask-meta-metric">
                  <strong>API Requests:</strong> 1 embedding + 1 grounded generation call
                </div>
                <div className="ask-meta-metric">
                  <strong>Grounding:</strong> Server-verified citations (unsupported claims stripped)
                </div>
              </div>
            )}
          </div>

          {/* 7. "Concept links to review" Card */}
          {mergeSuggestions.length > 0 && (
            <div className="ask-review-card" role="region" aria-label="Concept links to review">
              <div className="ask-review-header">
                <Split size={16} className="text-brand" />
                <strong>Concept Links to Review ({mergeSuggestions.length})</strong>
              </div>
              <p className="ask-review-desc">
                Potential concept duplicates detected across your notes. Review and confirm:
              </p>
              <div className="ask-review-items">
                {mergeSuggestions.slice(0, 2).map(s => (
                  <div key={s.id} className="ask-review-item">
                    <div className="ask-review-names">
                      <span>{s.entity_a.name}</span>
                      <ArrowRight size={13} />
                      <span>{s.entity_b.name}</span>
                      <span className="ask-score-tag">{(s.score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="ask-review-btns">
                      <button
                        type="button"
                        className="ask-btn-merge"
                        onClick={() => handleAcceptMerge(s.id)}
                      >
                        <Check size={12} />
                        <span>Merge</span>
                      </button>
                      <button
                        type="button"
                        className="ask-btn-reject"
                        onClick={() => handleRejectMerge(s.id)}
                      >
                        <X size={12} />
                        <span>Not the same</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
