import React, { useState } from 'react';
import { 
  BookMarked, 
  Quote, 
  Copy, 
  Check, 
  Star, 
  Maximize2, 
  ChevronDown, 
  ChevronUp,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, Badge, Button, PaperSurface } from './ui';
import { normalizeConceptDisplayName, cleanTopicHeading, cleanText } from '../utils/textCleaner';
import { getDocumentFileUrl } from '../api/client';

const DEF_CHAR_LIMIT = 130;

/**
 * Highlights matching search terms with soft gold mark
 */
function highlightMatch(text, query) {
  if (!text || !query || !query.trim()) return text;
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return text;
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = String(text).split(regex);
  return parts.map((part, i) => 
    regex.test(part) ? (
      <mark key={i} className="search-highlight">{part}</mark>
    ) : part
  );
}

export default function ConceptCard({
  concept,
  documentId,
  isSelected,
  onSelect,
  searchQuery = ''
}) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDefExpanded, setIsDefExpanded] = useState(false);

  const handleDeepDive = (e) => {
    e.stopPropagation();
    const docId = concept.document_id || documentId;
    if (docId) {
      const pageNum = concept.page || 1;
      const fileUrl = getDocumentFileUrl(docId, pageNum);
      window.open(fileUrl, '_blank', 'noopener,noreferrer');
    } else {
      onSelect(concept);
    }
  };

  const rawDefinition = concept.definition?.trim() || '';
  const rawExcerpt = concept.source_excerpt?.trim() || '';
  const isFormalDefinition = Boolean(rawDefinition);
  
  // Primary definition text shown in See More section (cleaned of dotted text)
  const primaryText = cleanText(isFormalDefinition ? rawDefinition : rawExcerpt);
  const isDefLong = primaryText.length > DEF_CHAR_LIMIT;

  const displayedDefText = (!isDefLong || isDefExpanded)
    ? primaryText
    : `${primaryText.slice(0, DEF_CHAR_LIMIT).trim()}…`;

  // Has distinct notes excerpt beyond definition
  const hasDistinctExcerpt = Boolean(
    rawExcerpt && 
    cleanText(rawExcerpt) !== cleanText(rawDefinition)
  );

  const cleanedName = normalizeConceptDisplayName(concept.name);
  const importance = Math.min(5, Math.max(1, Number(concept.importance) || 3));
  const isTopImportance = importance === 5;
  const hasSearch = Boolean(searchQuery && searchQuery.trim().length > 0);
  const matchScorePercent = Math.round((concept.score || 0) * 100);

  const handleCopy = (e) => {
    e.stopPropagation();
    const textToCopy = cleanText(concept.definition || concept.source_excerpt || concept.name);
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const topicText = concept.topic || 'General';
  const displayTopic = cleanTopicHeading(topicText, 32);

  return (
    <Card
      id={`concept-card-${concept.id}`}
      className={`concept-glass-card ${isSelected ? 'selected' : ''}`}
      hoverable
      onClick={() => onSelect(concept)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(concept);
        }
      }}
    >
      {/* Card Header: Concept Name & Meta Chips */}
      <div className="card-top">
        <div className="card-top-main">
          <div className="card-title-row">
            <h3 className="card-title">
              {hasSearch ? highlightMatch(cleanedName, searchQuery) : cleanedName}
            </h3>
            <button
              type="button"
              className="card-deepdive-quick-btn"
              onClick={handleDeepDive}
              title={`Deep Dive into PDF on Page ${concept.page || 1}`}
              aria-label={`Deep Dive to Page ${concept.page || 1} in PDF`}
            >
              <ExternalLink size={12} strokeWidth={2} />
              <span>Deep Dive</span>
            </button>
          </div>

          {/* Chips: Topic, Page chip, and Match chip (separate, with spacing) */}
          <div className="card-meta-chips">
            <Badge 
              variant={topicText && topicText !== 'General' ? 'sky' : 'amber'} 
              size="sm"
              title={topicText}
            >
              {displayTopic}
            </Badge>
            
            <span 
              className="card-page-chip card-page-chip-interactive"
              onClick={handleDeepDive}
              title={`Deep Dive into PDF on Page ${concept.page || 1}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  handleDeepDive(e);
                }
              }}
            >
              Page {concept.page || 1}
              <ExternalLink size={10} style={{ marginLeft: 3, opacity: 0.75 }} />
            </span>

            {hasSearch && matchScorePercent > 0 && (
              <span className="card-score-chip">
                {matchScorePercent}% match
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Card Collapsible Content: Definition on PaperSurface */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            className="card-expanded-body" 
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Extracted Definition Box sits on Flat PaperSurface */}
            <PaperSurface className="card-paper-definition">
              <div className="card-section-label">
                <BookMarked size={14} strokeWidth={1.75} style={{ color: 'var(--accent-amber)' }} />
                <span>{isFormalDefinition ? 'Extracted Definition' : 'Context Summary'}</span>
              </div>
              <p className="card-reading-text">
                {primaryText ? (
                  <>
                    "
                    {hasSearch 
                      ? highlightMatch(displayedDefText, searchQuery) 
                      : displayedDefText}
                    "
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Mentioned in text without explicit definition sentence.
                  </span>
                )}
                {isDefLong && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="inline-see-more-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsDefExpanded(!isDefExpanded);
                      }}
                      aria-label={isDefExpanded ? 'See less of definition' : 'See more of definition'}
                    >
                      {isDefExpanded ? 'See less' : 'See more'}
                    </button>
                  </>
                )}
              </p>
            </PaperSurface>

            {/* Original Notes Excerpt on Flat PaperSurface */}
            {hasDistinctExcerpt && (
              <PaperSurface className="card-paper-excerpt">
                <div className="card-section-label">
                  <Quote size={14} strokeWidth={1.75} style={{ color: 'var(--accent-amber)' }} />
                  <span>Original Notes Excerpt (Page {concept.page || 1})</span>
                </div>
                <p className="card-reading-text">
                  "
                  {hasSearch 
                    ? highlightMatch(cleanText(concept.source_excerpt), searchQuery) 
                    : cleanText(concept.source_excerpt)}
                  "
                </p>
              </PaperSurface>
            )}

            {/* Related Concepts */}
            {concept.related_concepts && concept.related_concepts.length > 0 && (
              <div className="card-related-group">
                <span className="card-related-title">Related Concepts</span>
                <div className="card-related-chips">
                  {concept.related_concepts.map((rel, idx) => (
                    <span key={idx} className="related-pill">
                      <span>{normalizeConceptDisplayName(rel.name)}</span>
                      <span className="related-weight">&times;{rel.weight}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Expanded Footer Actions */}
            <div className="card-footer-buttons">
              <Button
                variant="secondary"
                size="sm"
                icon={copied ? Check : Copy}
                onClick={handleCopy}
              >
                {copied ? 'Copied' : 'Copy Text'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                icon={Maximize2}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(concept);
                }}
              >
                Details
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "See More" / "See Less" Button */}
      <button
        type="button"
        className={`card-expander-btn ${isExpanded ? 'expanded' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        aria-label={isExpanded ? 'See less data' : 'See more data'}
      >
        <span>{isExpanded ? 'See less' : 'See more'}</span>
        {isExpanded ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
      </button>

      {/* Tidy Card Footer: KEY star label, importance dots, 5/5, and copy icon on one tidy row */}
      <div className="card-footer-row">
        <div className="card-footer-left">
          {isTopImportance && (
            <span className="key-concept-badge" title="Top Importance Concept">
              <Star size={12} strokeWidth={2} fill="var(--text-on-amber)" />
              <span>KEY</span>
            </span>
          )}

          <div 
            className="importance-indicator"
            title={`Importance: ${importance}/5`}
            aria-label={`Importance: ${importance} out of 5`}
          >
            <div className="importance-dots">
              {[1, 2, 3, 4, 5].map((dotVal) => (
                <span 
                  key={dotVal}
                  className={`dot ${dotVal <= importance ? 'active' : ''}`}
                />
              ))}
            </div>
            <span className="importance-label">{importance}/5</span>
          </div>
        </div>

        <div className="card-footer-right">
          <button
            type="button"
            className="card-copy-btn"
            onClick={handleCopy}
            title={copied ? 'Copied to clipboard' : 'Copy definition'}
            aria-label="Copy definition"
          >
            {copied ? (
              <Check size={14} strokeWidth={2} style={{ color: 'var(--success)' }} />
            ) : (
              <Copy size={14} strokeWidth={1.75} />
            )}
          </button>
        </div>
      </div>
    </Card>
  );
}
