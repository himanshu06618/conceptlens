import React from 'react';
import LogoMark from './LogoMark';

/**
 * ConceptLens Logo — "Flux" Visual Language
 * Crisp typography with Lime (#D7F25C) and near-black ink (#111113) / white on dark.
 */
export default function Logo({
  size = 32,
  wordmarkSize = '1.38rem',
  showWordmark = true,
  className = '',
  scrollMorph = false,
}) {
  return (
    <div 
      className={`flux-logo-unit ${className}`.trim()} 
      style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: '10px', 
        userSelect: 'none',
        cursor: 'pointer'
      }}
    >
      <LogoMark size={size} />

      {showWordmark && (
        <span 
          className="flux-wordmark"
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: wordmarkSize,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            color: 'var(--text-main)',
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px'
          }}
        >
          <span className="flux-word-concept">Concept</span>
          <span 
            className="flux-word-lens"
            style={{ 
              color: '#111113',
              background: 'var(--accent-lime)',
              padding: '2px 7px',
              borderRadius: '6px',
              fontWeight: 800,
              fontSize: '0.88em',
              letterSpacing: '-0.02em',
              marginLeft: '2px'
            }}
          >
            Lens
          </span>
        </span>
      )}
    </div>
  );
}
