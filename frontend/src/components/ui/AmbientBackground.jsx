import React, { useEffect, useState } from 'react';

/**
 * AmbientBackground
 * Renders large blurred lime shapes/orbs behind content so the glass blur is visible.
 * Fully responsive, hardware-accelerated, pauses on background tab,
 * and remains completely static under prefers-reduced-motion.
 */
export default function AmbientBackground({ variant = 'landing' }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [isTabHidden, setIsTabHidden] = useState(false);

  useEffect(() => {
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

  const animStyle = (dur, delay, dx, dy) => {
    if (reducedMotion) {
      return { transform: 'none' };
    }
    return {
      animationName: 'limeOrbFloat',
      animationDuration: dur,
      animationDelay: delay,
      animationTimingFunction: 'ease-in-out',
      animationIterationCount: 'infinite',
      animationDirection: 'alternate',
      animationPlayState: isTabHidden ? 'paused' : 'running',
      '--orb-dx': `${dx}px`,
      '--orb-dy': `${dy}px`
    };
  };

  return (
    <div
      className={`ambient-background-root ${variant}-variant`}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Large blurred lime shapes for glass backdrop blur */}
      <div
        className="ambient-lime-orb orb-1"
        style={{
          position: 'absolute',
          top: '-10%',
          left: '10%',
          width: 'clamp(320px, 45vw, 650px)',
          height: 'clamp(320px, 45vw, 650px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(196, 245, 96, 0.38) 0%, rgba(154, 230, 46, 0.20) 45%, transparent 72%)',
          filter: 'blur(clamp(45px, 6vw, 85px))',
          willChange: reducedMotion ? 'auto' : 'transform',
          ...animStyle('32s', '0s', 35, 45)
        }}
      />
      <div
        className="ambient-lime-orb orb-2"
        style={{
          position: 'absolute',
          top: '25%',
          right: '-5%',
          width: 'clamp(340px, 50vw, 700px)',
          height: 'clamp(340px, 50vw, 700px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(154, 230, 46, 0.32) 0%, rgba(111, 194, 26, 0.16) 48%, transparent 70%)',
          filter: 'blur(clamp(50px, 7vw, 95px))',
          willChange: reducedMotion ? 'auto' : 'transform',
          ...animStyle('40s', '-10s', -40, 50)
        }}
      />
      <div
        className="ambient-lime-orb orb-3"
        style={{
          position: 'absolute',
          bottom: '-12%',
          left: '20%',
          width: 'clamp(300px, 42vw, 600px)',
          height: 'clamp(300px, 42vw, 600px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(196, 245, 96, 0.28) 0%, rgba(154, 230, 46, 0.14) 50%, transparent 72%)',
          filter: 'blur(clamp(40px, 5vw, 75px))',
          willChange: reducedMotion ? 'auto' : 'transform',
          ...animStyle('36s', '-18s', 30, -35)
        }}
      />
    </div>
  );
}
