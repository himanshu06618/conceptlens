import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Clean Glassmorphic Modal
 * Translucent glass, backdrop blur, radius 24px, subtle animation (<300ms).
 */
export default function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = '520px',
  showClose = true,
  className = ''
}) {
  const modalRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
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
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={modalRef}
        className={`glass-modal shadow-md ${className}`.trim()}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || showClose) && (
          <div className="modal-header">
            <div>
              {title && <h2 className="modal-title">{title}</h2>}
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
  );
}
