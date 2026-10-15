import React, { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { OverlayPortal, useOverlay } from './Overlay';

/**
 * Concept Detail Right Drawer (Desktop) & Bottom Sheet (Mobile)
 * Rendered via portal with backdrop blur, focus trap, and scroll lock.
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
  const drawerRef = useRef(null);

  useOverlay({
    isOpen,
    onClose,
    containerRef: drawerRef,
    lockScroll: true,
    closeOnEscape: true,
    focusTrap: true
  });

  return (
    <OverlayPortal>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              className="drawer-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              aria-hidden="true"
            />

            {/* Right Drawer */}
            <motion.aside
              ref={drawerRef}
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
    </OverlayPortal>
  );
}
