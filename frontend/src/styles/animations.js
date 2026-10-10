/**
 * ConceptLens Animation System — Clean, Subtle & Purposeful
 * Fast, respectful of prefers-reduced-motion, animating only transform & opacity.
 */

export const prefersReducedMotion = () => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

// Subtle Content Fade-Up (250ms)
export const fadeUpVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] }
  },
  exit: { 
    opacity: 0, 
    y: -6,
    transition: { duration: 0.18, ease: 'easeIn' }
  }
};

// Staggered Container for Cards
export const staggerContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02
    }
  }
};

// Individual Concept Card Pop-In
export const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
  }
};

// Modal Scale & Fade
export const modalVariants = {
  hidden: { opacity: 0, scale: 0.96, y: 12 },
  visible: { 
    opacity: 1, 
    scale: 1, 
    y: 0,
    transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] }
  },
  exit: { 
    opacity: 0, 
    scale: 0.97, 
    y: 8,
    transition: { duration: 0.16, ease: 'easeIn' }
  }
};

// Mobile Bottom Sheet Slide
export const sheetVariants = {
  hidden: { y: '100%', opacity: 0 },
  visible: { 
    y: 0, 
    opacity: 1,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
  },
  exit: { 
    y: '100%', 
    opacity: 0,
    transition: { duration: 0.22, ease: 'easeIn' }
  }
};

// Desktop Drawer Slide (right to left)
export const drawerVariants = {
  hidden: { x: '100%', opacity: 0 },
  visible: { 
    x: 0, 
    opacity: 1,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
  },
  exit: { 
    x: '100%', 
    opacity: 0,
    transition: { duration: 0.2, ease: 'easeIn' }
  }
};
