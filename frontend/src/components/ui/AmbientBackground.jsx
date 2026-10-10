import React, { useEffect, useState, useMemo } from 'react';

/**
 * Clean Document File SVGs for Ambient Floating Objects:
 * - PDF page with small "PDF" tag badge
 * - Image frame with mountain & sun
 * - Text / Markdown sheet with lines of text
 */
function PdfFileIcon({ className }) {
  return (
    <svg width="44" height="56" viewBox="0 0 44 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="1" y="1" width="42" height="54" rx="6" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Cyan PDF tag badge */}
      <rect x="5" y="6" width="18" height="9" rx="2" fill="var(--gold)" />
      <text x="7.5" y="13" fill="#252D2A" fontSize="6" fontWeight="bold" fontFamily="system-ui, -apple-system, sans-serif">PDF</text>
      {/* Document text lines */}
      <line x1="6" y1="21" x2="38" y2="21" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="28" x2="32" y2="28" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="35" x2="36" y2="35" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="42" x2="24" y2="42" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ImageFileIcon({ className }) {
  return (
    <svg width="50" height="42" viewBox="0 0 50 42" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="1" y="1" width="48" height="40" rx="6" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Sun */}
      <circle cx="14" cy="13" r="4.5" fill="var(--gold)" opacity="0.85" />
      {/* Mountain landscape */}
      <path d="M6 34 L18 20 L27 28 L35 21 L44 34 Z" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function TextFileIcon({ className }) {
  return (
    <svg width="42" height="54" viewBox="0 0 42 54" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <rect x="1" y="1" width="40" height="52" rx="5" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
      {/* Header Accent Bar */}
      <line x1="6" y1="10" x2="22" y2="10" stroke="var(--gold-deep)" strokeWidth="2.2" strokeLinecap="round" />
      {/* Text lines */}
      <line x1="6" y1="18" x2="36" y2="18" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="6" y1="25" x2="33" y2="25" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="6" y1="32" x2="30" y2="32" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="6" y1="39" x2="35" y2="39" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="6" y1="46" x2="20" y2="46" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * AmbientBackground
 * The ONLY ambient animation allowed when the website opens:
 * Floating file objects drifting slowly upward and sideways with gentle rotation.
 * - CSS transforms only (no canvas)
 * - 15 files on desktop, 8 on mobile, fewer and fainter in app workspace
 * - Opacity at most 0.18 in light mode, 0.28 in dark mode
 * - Pauses when tab is hidden
 * - Static under prefers-reduced-motion
 */
export default function AmbientBackground({ variant = 'landing' }) {
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isTabHidden, setIsTabHidden] = useState(false);

  const isAppVariant = variant === 'app';
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  useEffect(() => {
    setMounted(true);
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(media.matches);

    const handleMotionChange = (e) => setReducedMotion(e.matches);
    media.addEventListener('change', handleMotionChange);

    const handleVisibilityChange = () => {
      setIsTabHidden(document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      media.removeEventListener('change', handleMotionChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Defined set of floating file objects: 15 on desktop, 8 on mobile, 7 in app workspace
  const filesList = useMemo(() => {
    const desktopLandingFiles = [
      { id: 'f1', type: 'pdf', left: '8%', top: '15%', depth: 0.6, dur: '58s', delay: '0s', rot: -5, dx: 30, dy: -60 },
      { id: 'f2', type: 'text', left: '85%', top: '20%', depth: 0.9, dur: '64s', delay: '-12s', rot: 4, dx: -25, dy: -70 },
      { id: 'f3', type: 'image', left: '22%', top: '65%', depth: 0.8, dur: '52s', delay: '-24s', rot: -3, dx: 35, dy: -55 },
      { id: 'f4', type: 'pdf', left: '76%', top: '72%', depth: 0.7, dur: '68s', delay: '-8s', rot: 6, dx: -30, dy: -65 },
      { id: 'f5', type: 'text', left: '46%', top: '35%', depth: 0.5, dur: '74s', delay: '-30s', rot: -4, dx: 20, dy: -50 },
      { id: 'f6', type: 'image', left: '92%', top: '55%', depth: 0.65, dur: '60s', delay: '-18s', rot: 3, dx: -20, dy: -60 },
      { id: 'f7', type: 'pdf', left: '14%', top: '42%', depth: 1.0, dur: '48s', delay: '-6s', rot: 5, dx: 25, dy: -80 },
      { id: 'f8', type: 'text', left: '62%', top: '18%', depth: 0.55, dur: '70s', delay: '-40s', rot: -6, dx: -35, dy: -50 },
      { id: 'f9', type: 'image', left: '38%', top: '82%', depth: 0.85, dur: '56s', delay: '-15s', rot: 4, dx: 28, dy: -75 },
      { id: 'f10', type: 'pdf', left: '60%', top: '52%', depth: 0.75, dur: '66s', delay: '-32s', rot: -2, dx: -22, dy: -60 },
      { id: 'f11', type: 'text', left: '4%', top: '80%', depth: 0.7, dur: '62s', delay: '-20s', rot: 3, dx: 24, dy: -65 },
      { id: 'f12', type: 'image', left: '31%', top: '10%', depth: 0.9, dur: '61s', delay: '-27s', rot: -4, dx: -28, dy: -68 },
      { id: 'f13', type: 'pdf', left: '96%', top: '37%', depth: 0.85, dur: '54s', delay: '-11s', rot: 5, dx: -32, dy: -62 },
      { id: 'f14', type: 'text', left: '71%', top: '88%', depth: 0.95, dur: '72s', delay: '-36s', rot: -3, dx: 26, dy: -76 },
      { id: 'f15', type: 'image', left: '3%', top: '57%', depth: 0.8, dur: '59s', delay: '-19s', rot: 4, dx: 34, dy: -58 }
    ];

    if (isAppVariant) {
      // Keep a few illustrations around the workspace perimeter.
      return desktopLandingFiles.filter((file) => ['f1', 'f3', 'f6', 'f7', 'f12', 'f13', 'f14'].includes(file.id));
    }
    if (isMobile) {
      // Keep a balanced selection of illustrations on mobile.
      return desktopLandingFiles.slice(0, 8);
    }
    return desktopLandingFiles;
  }, [isAppVariant, isMobile]);

  // Opacity caps: light mode <= 0.18, dark mode <= 0.28
  // App workspace: even fainter (half)
  const baseOpacity = isAppVariant ? 0.08 : 0.15;

  return (
    <div
      className={`ambient-background-root ${variant}-variant`}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Background Floating Files Layer */}
      <div
        className="ambient-floating-files-layer"
        style={{
          position: 'absolute',
          inset: 0,
          opacity: baseOpacity
        }}
      >
        {filesList.map((file) => {
          // Depth scaling: far files smaller, blurrier, and fainter; near files larger and sharper
          const scale = 0.75 + file.depth * 0.35;
          const blur = file.depth < 0.65 ? '1.5px' : 'none';
          const fileOpacity = 0.6 + file.depth * 0.4;

          const animStyle = reducedMotion
            ? {
                transform: `scale(${scale}) rotate(${file.rot}deg)`,
                filter: blur === 'none' ? 'none' : `blur(${blur})`
              }
            : {
                animationName: 'fileDriftFloat',
                animationDuration: file.dur,
                animationDelay: file.delay,
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDirection: 'alternate',
                animationPlayState: isTabHidden ? 'paused' : 'running',
                transform: `scale(${scale}) rotate(${file.rot}deg)`,
                filter: blur === 'none' ? 'none' : `blur(${blur})`,
                '--file-dx': `${file.dx}px`,
                '--file-dy': `${file.dy}px`,
                '--file-rot': `${file.rot * -1}deg`
              };

          return (
            <div
              key={file.id}
              className={`ambient-file-item file-${file.type}`}
              style={{
                position: 'absolute',
                left: file.left,
                top: file.top,
                opacity: fileOpacity,
                willChange: reducedMotion ? 'auto' : 'transform',
                ...animStyle
              }}
            >
              {file.type === 'pdf' && <PdfFileIcon />}
              {file.type === 'image' && <ImageFileIcon />}
              {file.type === 'text' && <TextFileIcon />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
