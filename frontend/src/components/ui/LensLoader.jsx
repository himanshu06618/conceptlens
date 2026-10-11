import React, { useId } from 'react';

/**
 * Reusable LensLoader Component
 * A mint-green magnifying lens sweeping smoothly across three document glyphs:
 * PDF page (with "PDF" tag), Image frame (mountain & sun), and Text sheet (lines of text).
 * Replaces all spinners and generic loaders across the app.
 *
 * Sizes:
 * - 'sm': compact inline (single sheet + sweeping lens) for buttons
 * - 'md': standard container / component loader
 * - 'lg': prominent view loader with optional label and smart extraction chips
 */
export default function LensLoader({
  size = 'md',
  label = '',
  focusType = null, // 'pdf' | 'image' | 'text'
  stage = null,     // 'reading' | 'ocr' | 'extracting'
  className = ''
}) {
  const uid = useId().replace(/:/g, '');
  const isSm = size === 'sm';
  const isLg = size === 'lg';
  const isExtracting = stage === 'extracting';

  // For sm size: render a single mini document with an animated sweep lens
  if (isSm) {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`lens-loader-sm ${className}`.trim()}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '20px',
          height: '20px',
          position: 'relative',
          verticalAlign: 'middle',
          flexShrink: 0
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Mini Sheet */}
          <rect x="3" y="3" width="13" height="17" rx="2.5" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.2" />
          <line x1="6" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="6" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          <line x1="6" y1="15" x2="10" y2="15" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />

          {/* Sweeping lime lens */}
          <g className="lens-sm-sweep">
            <circle cx="14" cy="11" r="5.5" stroke="var(--brand-light, #C4F560)" strokeWidth="1.8" fill="var(--brand-bg, rgba(154, 230, 46, 0.2))" />
            <line x1="18" y1="15" x2="22" y2="19" stroke="var(--brand-deep, #6FC21A)" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M10.5 10 A 4 4 0 0 1 13.5 7" stroke="#FFFFFF" strokeWidth="1.2" strokeLinecap="round" strokeOpacity="0.9" />
          </g>
        </svg>
        <span className="sr-only">{label || 'Loading...'}</span>
      </span>
    );
  }

  // Width & scale for md vs lg
  const viewBoxW = 220;
  const viewBoxH = 80;
  const svgWidth = isLg ? 260 : 180;
  const svgHeight = isLg ? 95 : 65;

  const animationSpeedClass = isExtracting ? 'extracting-fast' : '';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`lens-loader-wrap lens-loader-${size} ${focusType ? `focus-${focusType}` : ''} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        textAlign: 'center',
        userSelect: 'none'
      }}
    >
      <div className="lens-loader-stage" style={{ position: 'relative' }}>
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            {/* Lime brand accent */}
            <linearGradient id={`goldGrad-${uid}`} x1="0" y1="0" x2="30" y2="30" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#C4F560" />
              <stop offset="100%" stopColor="#6FC21A" />
            </linearGradient>

            {/* Lens Scan Glow */}
            <radialGradient id={`lensGlow-${uid}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#9AE62E" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#6FC21A" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#6FC21A" stopOpacity="0" />
            </radialGradient>

            {/* Glass Fill */}
            <radialGradient id={`glassGrad-${uid}`} cx="35%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#F4FDE5" stopOpacity="0.25" />
            </radialGradient>
          </defs>

          {/* Connection baseline trail */}
          <line x1="20" y1="52" x2="200" y2="52" stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="3 3" />

          {/* GLYPH 1: PDF Document (x: 25 to 65) */}
          <g className={`loader-glyph glyph-pdf ${focusType === 'pdf' ? 'focused-glyph' : ''}`}>
            {/* Sheet */}
            <rect x="25" y="16" width="36" height="46" rx="5" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.4" />
            {/* Green PDF tag */}
            <rect x="29" y="20" width="13" height="7" rx="1.5" fill="#397F69" />
            <text x="31" y="25.5" fill="#FFFFFF" fontSize="4.8" fontWeight="bold" fontFamily="system-ui">PDF</text>
            {/* Lines */}
            <line x1="30" y1="32" x2="55" y2="32" className="scan-line line-1" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="30" y1="38" x2="51" y2="38" className="scan-line line-2" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="30" y1="44" x2="54" y2="44" className="scan-line line-3" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="30" y1="50" x2="44" y2="50" className="scan-line line-4" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
          </g>

          {/* GLYPH 2: Image Frame (x: 90 to 132) */}
          <g className={`loader-glyph glyph-img ${focusType === 'image' ? 'focused-glyph' : ''}`}>
            {/* Frame */}
            <rect x="90" y="18" width="40" height="42" rx="5" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.4" />
            {/* Sun */}
            <circle cx="101" cy="28" r="3.5" className="scan-sun" fill="var(--gold)" opacity="0.85" />
            {/* Mountains */}
            <path d="M94 48 L104 35 L111 43 L118 36 L126 48 Z" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1.2" strokeLinejoin="round" />
          </g>

          {/* GLYPH 3: Text / Markdown Document (x: 155 to 195) */}
          <g className={`loader-glyph glyph-txt ${focusType === 'text' ? 'focused-glyph' : ''}`}>
            {/* Sheet */}
            <rect x="155" y="16" width="36" height="46" rx="5" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.4" />
            {/* Gold header dash */}
            <line x1="161" y1="23" x2="173" y2="23" stroke="var(--gold-deep)" strokeWidth="1.8" strokeLinecap="round" />
            {/* Text lines */}
            <line x1="161" y1="30" x2="185" y2="30" className="scan-line line-1" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="161" y1="36" x2="182" y2="36" className="scan-line line-2" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="161" y1="42" x2="184" y2="42" className="scan-line line-3" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="161" y1="48" x2="175" y2="48" className="scan-line line-4" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
          </g>

          {/* THE GLIDING GOLD LENS (Sweeps smoothly across glyphs on 2.4s loop) */}
          <g className={`loader-gliding-lens ${animationSpeedClass}`}>
            {/* Soft scan glow under lens */}
            <circle cx="0" cy="0" r="22" fill={`url(#lensGlow-${uid})`} />

            {/* Handle at bottom-right */}
            <path d="M7.5 7.5 L17 17" stroke={`url(#goldGrad-${uid})`} strokeWidth="3.2" strokeLinecap="round" />
            <circle cx="17" cy="17" r="1.6" fill="#397F69" />

            {/* Circular lens ring */}
            <circle cx="0" cy="0" r="12" stroke={`url(#goldGrad-${uid})`} strokeWidth="2.5" />

            {/* Glass fill */}
            <circle cx="0" cy="0" r="10.8" fill={`url(#glassGrad-${uid})`} />

            {/* Glass highlight arc */}
            <path d="M-8.5 -1.5 A 8.5 8.5 0 0 1 -1.5 -8.5" stroke="#FFFFFF" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.9" />
          </g>

          {/* Floating Concept Chips during Extracting Stage (lg size) */}
          {isLg && isExtracting && (
            <g className="floating-concept-particles">
              <g className="particle-chip particle-1">
                <rect x="0" y="0" width="28" height="10" rx="3" fill="var(--gold-soft)" stroke="var(--gold)" strokeWidth="0.8" />
                <text x="4" y="7" fill="var(--gold-deep)" fontSize="4.5" fontWeight="600" fontFamily="system-ui">Concept</text>
              </g>
              <g className="particle-chip particle-2">
                <rect x="0" y="0" width="24" height="9" rx="3" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="0.8" />
                <text x="3.5" y="6.5" fill="var(--text)" fontSize="4.2" fontWeight="600" fontFamily="system-ui">Topic</text>
              </g>
            </g>
          )}
        </svg>
      </div>

      {label && (
        <span
          className="lens-loader-label"
          style={{
            fontFamily: 'var(--font-heading)',
            fontSize: isLg ? '1.05rem' : '0.88rem',
            fontWeight: 500,
            color: 'var(--ink)'
          }}
        >
          {label}
        </span>
      )}
      <span className="sr-only">Loading content...</span>
    </div>
  );
}
