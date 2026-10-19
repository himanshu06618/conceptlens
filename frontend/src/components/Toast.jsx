import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Sparkles, X, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div
      className="flux-toast-container"
      aria-live="polite"
      style={{
        position: 'fixed',
        top: '24px',
        right: '24px',
        zIndex: 999999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        pointerEvents: 'none',
        maxWidth: '420px',
        width: 'calc(100vw - 48px)'
      }}
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const type = t.type || 'info';
          const isSuccess = type === 'success';
          const isError = type === 'error';
          const isWarning = type === 'warning';

          return (
            <motion.div
              key={t.id}
              className="flux-toast-card"
              initial={{ opacity: 0, y: -16, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.92 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              layout
              style={{
                pointerEvents: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 18px',
                borderRadius: '18px',
                background: '#1B1B1D',
                color: '#FFFFFF',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.32), 0 4px 14px rgba(0, 0, 0, 0.14)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                backdropFilter: 'blur(16px)',
                fontFamily: "'Poppins', sans-serif",
                boxSizing: 'border-box'
              }}
            >
              {/* Type Icon Badge */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  background: isSuccess
                    ? 'var(--lime, #D7F25C)'
                    : isError
                    ? '#EF4444'
                    : isWarning
                    ? '#F59E0B'
                    : 'var(--lavender, #B7A9F2)',
                  color: isError ? '#FFFFFF' : '#111113'
                }}
                aria-hidden="true"
              >
                {isSuccess && <CheckCircle2 size={16} strokeWidth={2.4} />}
                {isError && <AlertCircle size={16} strokeWidth={2.4} />}
                {isWarning && <AlertTriangle size={16} strokeWidth={2.4} />}
                {!isSuccess && !isError && !isWarning && <Info size={16} strokeWidth={2.4} />}
              </div>

              {/* Message */}
              <span
                style={{
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: '#FFFFFF',
                  lineHeight: '1.4',
                  flex: 1,
                  wordBreak: 'break-word'
                }}
              >
                {t.message}
              </span>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: 'rgba(255, 255, 255, 0.12)',
                  border: 'none',
                  color: 'rgba(255, 255, 255, 0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'background 0.15s ease, color 0.15s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
                  e.currentTarget.style.color = '#FFFFFF';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.75)';
                }}
                aria-label="Dismiss notification"
              >
                <X size={14} strokeWidth={2.2} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
