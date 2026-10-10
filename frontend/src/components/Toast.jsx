import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`glass-toast ${t.type || 'info'} shadow-md`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            layout
          >
            {t.type === 'success' && <CheckCircle2 size={18} strokeWidth={2} style={{ color: 'var(--success)', flexShrink: 0 }} />}
            {t.type === 'error' && <AlertCircle size={18} strokeWidth={2} style={{ color: 'var(--danger)', flexShrink: 0 }} />}
            {t.type === 'info' && <Info size={18} strokeWidth={2} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />}
            {t.type === 'warning' && <AlertCircle size={18} strokeWidth={2} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
            
            <span className="toast-text">
              {t.message}
            </span>

            <button 
              type="button"
              onClick={() => onDismiss(t.id)} 
              className="toast-close-btn"
              aria-label="Dismiss notification"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
