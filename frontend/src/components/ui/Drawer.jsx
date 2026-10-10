import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Concept Detail Right Drawer (Desktop) & Bottom Sheet (Mobile)
 * Smooth spring transition, backdrop dismiss, Escape key dismiss.
 */
export default function Drawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = 460,
  className = ''
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="drawer-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Right Drawer */}
          <motion.aside
            className={`detail-drawer ${className}`.trim()}
            style={{ width }}
            initial={{ x: '100%', opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            role="dialog"
            aria-modal="true"
            aria-label={title || 'Detail Panel'}
          >
            <div className="drawer-header">
              <div className="drawer-header-text">
                {title && <h2 className="drawer-title">{title}</h2>}
                {subtitle && <p className="drawer-subtitle">{subtitle}</p>}
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={onClose}
                aria-label="Close drawer"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="drawer-body">
              {children}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
