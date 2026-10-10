import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Clean Glassmorphic BottomSheet
 * Used on mobile for modals, filters, and drawers.
 */
export default function BottomSheet({
  isOpen,
  onClose,
  title,
  children,
  showClose = true,
  className = ''
}) {
  const sheetRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="bottom-sheet-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={sheetRef}
        className={`bottom-sheet shadow-lg ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bottom-sheet-handle-wrap" onClick={onClose}>
          <div className="bottom-sheet-handle" />
        </div>
        {(title || showClose) && (
          <div className="bottom-sheet-header">
            {title && <h3 className="bottom-sheet-title">{title}</h3>}
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
  );
}
