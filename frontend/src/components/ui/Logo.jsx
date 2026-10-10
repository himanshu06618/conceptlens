import React from 'react';
import LogoMark from './LogoMark';

/**
 * Logo Component
 * Clickable single unit with a refined ConceptLens wordmark and green magnifier.
 * The scroll-morph variant keeps the title aligned as the magnifier moves.
 */
export default function Logo({
  size = 34,
  wordmarkSize = '1.38rem',
  showWordmark = true,
  className = '',
  scrollMorph = false,
}) {
  if (scrollMorph) {
    return (
      <div
        className={`brand-logo-unit brand-logo-scroll-morph ${className}`.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          userSelect: 'none',
          cursor: 'pointer',
        }}
      >
        <span className="brand-logo-leading-slot" aria-hidden="true" />
        {showWordmark && (
          <span
            className="brand-wordmark"
            style={{
              fontFamily: 'var(--font-logo-display)',
              fontSize: 'var(--logo-wordmark-size, 1.78rem)',
              fontWeight: 400,
              letterSpacing: 'var(--logo-title-tracking, -0.025em)',
              color: 'var(--ink)',
              lineHeight: 1,
              display: 'inline-flex',
              alignItems: 'baseline',
            }}
          >
            <span className="brand-word-concept">Concept</span>
            <span className="brand-logo-inline-slot" aria-hidden="true" />
            <span className="brand-word-lens">Lens</span>
            <span className="brand-lens-magnifier" aria-hidden="true">
              <span className="brand-wordmark-magnified">
                <span className="brand-word-concept">Concept</span>
                <span className="brand-logo-inline-slot" />
                <span className="brand-word-lens">Lens</span>
              </span>
            </span>
          </span>
        )}
        <LogoMark
          size={size}
          className="brand-logo-moving-mark"
          idPrefix="header-lens"
          colorScheme="blue"
        />
      </div>
    );
  }

  return (
    <div 
      className={`brand-logo-unit ${className}`.trim()} 
      style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '11px', 
        userSelect: 'none',
        cursor: 'pointer'
      }}
    >
      <LogoMark size={size} />

      {showWordmark && (
        <span 
          className="brand-wordmark"
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: wordmarkSize,
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'baseline'
          }}
        >
          <span>Concept</span>
          <span 
            style={{ 
              color: 'var(--logo-accent)', 
              fontStyle: 'italic', 
              fontWeight: 500,
              marginLeft: '1px'
            }}
          >
            Lens
          </span>
        </span>
      )}
    </div>
  );
}
