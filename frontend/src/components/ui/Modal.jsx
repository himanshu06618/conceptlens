import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { OverlayPortal, useOverlay } from './Overlay';

/**
 * Clean Glassmorphic Modal
 * Portaled into document.body with scrim, focus trap, Escape, and return focus.
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '520px',
  showClose = true,
  className = '',
  triggerRef = null,
}) {
  const modalRef = useRef(null);

  useOverlay({
    isOpen,
    onClose,
    containerRef: modalRef,
    triggerRef,
    trapFocus: true,
    lockScroll: true,
    closeOnEscape: true,
    closeOnClickOutside: false, // backdrop handles click directly
  });

  if (!isOpen) return null;

  return (
    <OverlayPortal>
      <div 
        className="modal-backdrop" 
        onClick={onClose} 
        role="dialog" 
        aria-modal="true"
        aria-labelledby={title ? 'modal-dialog-title' : undefined}
      >
        <div
          ref={modalRef}
          tabIndex={-1}
          className={`glass-modal ${className}`.trim()}
          style={{ maxWidth }}
          onClick={(e) => e.stopPropagation()}
        >
          {(title || showClose) && (
            <div className="modal-header">
              <div>
                {title && <h2 id="modal-dialog-title" className="modal-title">{title}</h2>}
                {subtitle && <p className="modal-subtitle">{subtitle}</p>}
              </div>
              {showClose && (
                <button
                  type="button"
                  className="icon-btn icon-btn-ghost icon-btn-sm"
                  onClick={onClose}
                  aria-label="Close dialog"
                >
                  <X size={20} strokeWidth={1.75} />
                </button>
              )}
            </div>
          )}
          <div className="modal-body">{children}</div>
        </div>
      </div>
    </OverlayPortal>
  );
}

