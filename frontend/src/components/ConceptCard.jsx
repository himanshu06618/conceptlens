import React, { useState } from 'react';
import { 
  BookMarked, 
  Quote, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp,
  ExternalLink,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { normalizeConceptDisplayName, cleanTopicHeading, cleanText } from '../utils/textCleaner';
import { getDocumentFileUrl } from '../api/client';

const DEF_CHAR_LIMIT = 130;

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

/**
 * ConceptCard — "Flux" Design System
 * - White card (#FFFFFF light, #1B1B1D dark)
 * - Importance as 1-3 pill indicator (lime / lavender / black)
 * - Definition text muted
 * - Topic chip
 */
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
  
  const primaryText = cleanText(isFormalDefinition ? rawDefinition : rawExcerpt);
  const isDefLong = primaryText.length > DEF_CHAR_LIMIT;

  const displayedDefText = (!isDefLong || isDefExpanded)
    ? primaryText
    : `${primaryText.slice(0, DEF_CHAR_LIMIT).trim()}…`;

  const hasDistinctExcerpt = Boolean(
    rawExcerpt && 
    cleanText(rawExcerpt) !== cleanText(rawDefinition)
  );

  const cleanedName = normalizeConceptDisplayName(concept.name);
  
  // Map importance 1-5 to 1-3 tier pill (Tier 1 = Lime, Tier 2 = Lavender, Tier 3 = Black)
  const rawImportance = Number(concept.importance) || 3;
  const importanceTier = rawImportance >= 4 ? 1 : rawImportance >= 2 ? 2 : 3;
  const importanceLabel = importanceTier === 1 ? 'High Impact' : importanceTier === 2 ? 'Core Concept' : 'Foundation';
  const importanceClass = importanceTier === 1 ? 'tier-lime' : importanceTier === 2 ? 'tier-lavender' : 'tier-black';

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
  const displayTopic = cleanTopicHeading(topicText, 28);

  return (
    <div
      id={`concept-card-${concept.id}`}
      className={`flux-card flux-concept-card ${isSelected ? 'selected' : ''}`}
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
      {/* Top Header: Concept Title & Importance 1-3 Pill */}
      <div className="flux-concept-top">
        <div className="flux-concept-title-row">
          <h3 className="flux-concept-title">
            {hasSearch ? highlightMatch(cleanedName, searchQuery) : cleanedName}
          </h3>

          {/* Importance 1-3 Pill Indicator (lime / lavender / black) */}
          <div className={`flux-importance-pill ${importanceClass}`} title={`Priority Tier ${importanceTier}: ${importanceLabel}`}>
            <span className="importance-dots-mini">
              {Array.from({ length: 3 }).map((_, i) => (
                <span
                  key={i}
                  className={`dot-mini ${i < (4 - importanceTier) ? 'active' : ''}`}
                />
              ))}
            </span>
            <span className="importance-tier-name">{importanceLabel}</span>
          </div>
        </div>

        {/* Chips: Topic Chip & Page Badge */}
        <div className="flux-concept-chips-row">
          <span className="flux-badge badge-lavender">
            {displayTopic}
          </span>

          <span
            className="flux-badge badge-neutral page-chip-interactive"
            onClick={handleDeepDive}
            title={`Deep dive into PDF on page ${concept.page || 1}`}
            role="button"
            tabIndex={0}
          >
            Page {concept.page || 1}
            <ExternalLink size={11} style={{ marginLeft: 3 }} />
          </span>

          {hasSearch && matchScorePercent > 0 && (
            <span className="flux-badge badge-lime">
              {matchScorePercent}% match
            </span>
          )}
        </div>
      </div>

      {/* Primary Definition Text (Clean & Muted) */}
      <div className="flux-concept-definition-body">
        <p className="flux-concept-def-text">
          {primaryText ? (
            <>
              {hasSearch 
                ? highlightMatch(displayedDefText, searchQuery) 
                : displayedDefText}
            </>
          ) : (
            <span className="flux-concept-missing-def">
              Extracted from notes without formal definition sentence.
            </span>
          )}
        </p>

        {isDefLong && (
          <button
            type="button"
            className="flux-see-more-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsDefExpanded(!isDefExpanded);
            }}
          >
            {isDefExpanded ? 'See less' : 'Read more'}
          </button>
        )}
      </div>

      {/* Expandable Deep Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            className="flux-concept-expanded" 
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {hasDistinctExcerpt && (
              <div className="flux-concept-excerpt-box">
                <div className="flux-excerpt-label">
                  <Quote size={13} />
                  <span>Notes Excerpt (Page {concept.page || 1})</span>
                </div>
                <p className="flux-excerpt-text">
                  "{cleanText(concept.source_excerpt)}"
                </p>
              </div>
            )}

            {concept.related_concepts && concept.related_concepts.length > 0 && (
              <div className="flux-concept-related-box">
                <span className="flux-related-title">Connected Concepts</span>
                <div className="flux-related-chips">
                  {concept.related_concepts.map((rel, idx) => (
                    <span key={idx} className="flux-badge badge-neutral">
                      {normalizeConceptDisplayName(rel.name)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Actions */}
      <div className="flux-concept-footer">
        <button
          type="button"
          className="flux-expand-toggle-btn"
          onClick={(e) => {
            e.stopPropagation();
            setIsExpanded(!isExpanded);
          }}
        >
          <span>{isExpanded ? 'Hide details' : 'More context'}</span>
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <button
          type="button"
          className="flux-concept-copy-btn"
          onClick={handleCopy}
          title={copied ? 'Copied to clipboard' : 'Copy concept text'}
          aria-label="Copy concept text"
        >
          {copied ? <Check size={14} color="var(--accent-lime)" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}
