import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { OverlayPortal, useOverlay } from './Overlay';

/**
 * Clean Glassmorphic BottomSheet
 * Used on mobile for modals, filters, and drawers.
 * Portaled into document.body with scrim, focus trap, and scroll lock.
 */
export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  showClose = true,
  className = '',
  triggerRef = null,
}) {
  const sheetRef = useRef(null);

  useOverlay({
    isOpen,
    onClose,
    containerRef: sheetRef,
    triggerRef,
    trapFocus: true,
    lockScroll: true,
    closeOnEscape: true,
    closeOnClickOutside: false,
  });

  if (!isOpen) return null;

  return (
    <OverlayPortal>
      <div 
        className="bottom-sheet-backdrop" 
        onClick={onClose} 
        role="dialog" 
        aria-modal="true"
        aria-labelledby={title ? 'bottom-sheet-title' : undefined}
      >
        <div
          ref={sheetRef}
          tabIndex={-1}
          className={`bottom-sheet ${className}`.trim()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bottom-sheet-handle-wrap" onClick={onClose}>
            <div className="bottom-sheet-handle" />
          </div>
          {(title || showClose) && (
            <div className="bottom-sheet-header">
              {title && <h3 id="bottom-sheet-title" className="bottom-sheet-title">{title}</h3>}
              {showClose && (
                <button
                  type="button"
                  className="icon-btn icon-btn-ghost icon-btn-sm"
                  onClick={onClose}
                  aria-label="Close sheet"
                >
                  <X size={20} strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}
          <div className="bottom-sheet-content">{children}</div>
        </div>
      </div>
    </OverlayPortal>
  );
}

