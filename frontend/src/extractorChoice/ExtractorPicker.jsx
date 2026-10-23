import React, { useState, useEffect } from 'react';
import { Sparkles, Check, AlertCircle, Zap, Layers } from 'lucide-react';

const getApiBase = () => {
  if (typeof window !== 'undefined' && window.__API_BASE__) {
    const custom = String(window.__API_BASE__).trim().replace(/\/+$/, '');
    return custom.endsWith('/api') ? custom : `${custom}/api`;
  }
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL;
  if (envUrl && typeof envUrl === 'string') {
    const trimmed = envUrl.trim().replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  if (import.meta.env.DEV) {
    return '/api';
  }
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:8000/api';
  }
  return '/api';
};

const IS_FEATURE_ENABLED = String(import.meta.env.VITE_ENABLE_EXTRACTOR_CHOICE ?? 'true').toLowerCase() !== 'false';

const EXTRACTOR_OPTIONS = [
  {
    id: 'gemini',
    title: 'Google Gemini API',
    subtitle: 'PDFs read with PyMuPDF, then Gemini',
    badge: 'Default',
    badgeVariant: 'default',
    icon: Sparkles,
  },
  {
    id: 'yake',
    title: 'YAKE',
    subtitle: 'Statistical keywords',
    badge: 'Free',
    badgeVariant: 'free',
    icon: Zap,
  },
  {
    id: 'rake_textrank',
    title: 'RAKE / TextRank',
    subtitle: 'Keyword phrases and graph ranking',
    badge: 'Free',
    badgeVariant: 'free',
    icon: Layers,
  },
];

export default function ExtractorPicker({
  documents = [],
  isUploading = false,
  onChange,
  variant = 'dark',
}) {
  const [selectedMethod, setSelectedMethod] = useState(() => {
    try {
      return (typeof window !== 'undefined' && window.__conceptlens_extractor)
        || localStorage.getItem('conceptlens_selected_extractor')
        || 'gemini';
    } catch {
      return 'gemini';
    }
  });

  // Default all 3 supported methods to true so choices appear immediately
  const [availableMethods, setAvailableMethods] = useState({
    gemini: true,
    yake: true,
    rake_textrank: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [lastExtraction, setLastExtraction] = useState(null);

  // Sync window global on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__conceptlens_extractor = selectedMethod;
    }
  }, [selectedMethod]);

  // 1. Fetch available extractors from backend
  useEffect(() => {
    if (!IS_FEATURE_ENABLED) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    async function loadExtractors() {
      try {
        const apiBase = getApiBase();
        const res = await fetch(`${apiBase}/extractors`);
        if (res.ok) {
          const data = await res.json();
          if (isMounted && data) {
            setAvailableMethods((prev) => ({
              ...prev,
              ...data,
              gemini: true,
            }));
          }
        }
      } catch (err) {
        console.warn('Could not query /api/extractors, using built-in options:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadExtractors();

    // Load any cached last extraction from localStorage
    try {
      const stored = localStorage.getItem('conceptlens_last_extraction');
      if (stored) {
        setLastExtraction(JSON.parse(stored));
      }
    } catch (_) {}

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Listen to upload-started event to reset selection to Gemini if desired
  useEffect(() => {
    const handleUploadStarted = () => {
      // Optional: keep current selection or notify parent
      if (onChange) onChange(selectedMethod);
    };

    window.addEventListener('conceptlens:upload-started', handleUploadStarted);
    return () => {
      window.removeEventListener('conceptlens:upload-started', handleUploadStarted);
    };
  }, [onChange, selectedMethod]);

  // 3. Track latest extraction result from documents list
  useEffect(() => {
    if (documents && documents.length > 0) {
      const latest = documents[0];
      const extUsed = latest.extractor_used || latest.provider_used;
      if (extUsed) {
        const info = {
          extractor_used: extUsed,
          fallback: Boolean(latest.fallback),
          fallback_reason: latest.fallback_reason || null,
          filename: latest.filename || '',
        };
        setLastExtraction(info);
        try {
          localStorage.setItem('conceptlens_last_extraction', JSON.stringify(info));
        } catch (_) {}
      }
    }
  }, [documents]);

  if (!IS_FEATURE_ENABLED) {
    return null;
  }

  // Filter options based on available backend extractors (Gemini always shown)
  const visibleOptions = EXTRACTOR_OPTIONS.filter((opt) => {
    if (opt.id === 'gemini') return true;
    return Boolean(availableMethods[opt.id]);
  });

  const handleSelect = (id) => {
    setSelectedMethod(id);
    if (typeof window !== 'undefined') {
      window.__conceptlens_extractor = id;
    }
    try {
      localStorage.setItem('conceptlens_selected_extractor', id);
    } catch (_) {}
    if (onChange) onChange(id);
  };

  const getMethodTitle = (id) => {
    const found = EXTRACTOR_OPTIONS.find((o) => o.id === id);
    return found ? found.title : id;
  };

  const isLime = variant === 'lime';

  return (
    <div
      className="extractor-picker-box"
      style={{
        marginTop: isLime ? '14px' : '1.25rem',
        width: '100%',
        maxWidth: isLime ? '440px' : '540px',
        marginInline: 'auto',
        textAlign: 'left',
        background: isLime ? 'rgba(255, 255, 255, 0.42)' : 'rgba(15, 23, 42, 0.4)',
        border: `1px solid ${isLime ? 'rgba(17, 17, 19, 0.16)' : 'rgba(255, 255, 255, 0.08)'}`,
        borderRadius: '16px',
        padding: '14px 16px',
        backdropFilter: 'blur(12px)',
        boxShadow: isLime ? '0 4px 18px rgba(0, 0, 0, 0.04)' : '0 4px 20px rgba(0, 0, 0, 0.25)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Small Badge: Extracted with: <method> / Used Gemini instead: <reason> */}
      {lastExtraction && lastExtraction.extractor_used && (
        <div
          className="extractor-status-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
            borderRadius: '999px',
            marginBottom: '0.75rem',
            fontSize: '0.76rem',
            fontWeight: 600,
            background: lastExtraction.fallback
              ? isLime ? 'rgba(217, 119, 6, 0.15)' : 'rgba(245, 158, 11, 0.12)'
              : isLime ? 'rgba(17, 17, 19, 0.09)' : 'rgba(163, 230, 53, 0.12)',
            border: `1px solid ${
              lastExtraction.fallback
                ? 'rgba(217, 119, 6, 0.35)'
                : isLime ? 'rgba(17, 17, 19, 0.2)' : 'rgba(163, 230, 53, 0.35)'
            }`,
            color: lastExtraction.fallback
              ? isLime ? '#b45309' : '#fbbf24'
              : isLime ? '#111113' : '#bef264',
          }}
          role="status"
          aria-live="polite"
        >
          {lastExtraction.fallback ? (
            <>
              <AlertCircle size={13} style={{ flexShrink: 0 }} />
              <span>
                Used Gemini instead: {lastExtraction.fallback_reason || 'Fallback triggered'}
              </span>
            </>
          ) : (
            <>
              <Check size={13} style={{ flexShrink: 0 }} />
              <span>
                Extracted with: {getMethodTitle(lastExtraction.extractor_used)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Label & Description (Sentence case) */}
      <div style={{ marginBottom: '0.65rem' }}>
        <div
          style={{
            fontSize: '0.86rem',
            fontWeight: 700,
            color: isLime ? '#111113' : '#f8fafc',
            letterSpacing: isLime ? '-0.01em' : '0.01em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>Extraction method</span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 500,
              color: isLime ? 'rgba(17, 17, 19, 0.55)' : '#94a3b8',
            }}
          >
            {visibleOptions.length} available
          </span>
        </div>
        <div
          style={{
            fontSize: '0.75rem',
            color: isLime ? 'rgba(17, 17, 19, 0.72)' : '#94a3b8',
            marginTop: '2px',
          }}
        >
          Choose how concepts are extracted from your file
        </div>
      </div>

      {/* Radio-style cards: one per line, mobile friendly */}
      <div
        role="radiogroup"
        aria-label="Extraction method"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '7px',
          width: '100%',
        }}
      >
        {visibleOptions.map((opt) => {
          const isSelected = selectedMethod === opt.id;
          return (
            <div
              key={opt.id}
              role="radio"
              aria-checked={isSelected}
              tabIndex={0}
              onClick={() => handleSelect(opt.id)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  handleSelect(opt.id);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 12px',
                borderRadius: '11px',
                background: isLime
                  ? isSelected
                    ? '#111113'
                    : 'rgba(255, 255, 255, 0.75)'
                  : isSelected
                    ? 'rgba(163, 230, 53, 0.09)'
                    : 'rgba(255, 255, 255, 0.03)',
                border: isLime
                  ? `1.5px solid ${isSelected ? '#111113' : 'rgba(17, 17, 19, 0.12)'}`
                  : `1px solid ${isSelected ? 'rgba(163, 230, 53, 0.55)' : 'rgba(255, 255, 255, 0.08)'}`,
                boxShadow: isLime
                  ? isSelected
                    ? '0 4px 14px rgba(0, 0, 0, 0.2)'
                    : '0 1px 3px rgba(0, 0, 0, 0.03)'
                  : isSelected
                    ? '0 0 16px rgba(163, 230, 53, 0.12)'
                    : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                outline: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                {/* Custom radio button */}
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    border: isLime
                      ? `2px solid ${isSelected ? '#D7F25C' : 'rgba(17, 17, 19, 0.35)'}`
                      : `2px solid ${isSelected ? '#a3e635' : 'rgba(255, 255, 255, 0.3)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: isLime ? '#D7F25C' : '#a3e635',
                      }}
                    />
                  )}
                </div>

                {/* Title & subtitle */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.84rem',
                      fontWeight: isSelected ? 700 : 600,
                      color: isLime
                        ? isSelected
                          ? '#FFFFFF'
                          : '#111113'
                        : isSelected
                          ? '#ffffff'
                          : '#e2e8f0',
                      lineHeight: 1.25,
                    }}
                  >
                    {opt.title}
                  </div>
                  <div
                    style={{
                      fontSize: '0.72rem',
                      color: isLime
                        ? isSelected
                          ? 'rgba(255, 255, 255, 0.72)'
                          : 'rgba(17, 17, 19, 0.65)'
                        : '#94a3b8',
                      marginTop: '1px',
                      lineHeight: 1.2,
                    }}
                  >
                    {opt.subtitle}
                  </div>
                </div>
              </div>

              {/* Tag / Badge */}
              <div style={{ flexShrink: 0, marginLeft: '8px' }}>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: '5px',
                    background: isLime
                      ? isSelected
                        ? 'rgba(215, 242, 92, 0.22)'
                        : opt.badgeVariant === 'default'
                          ? 'rgba(17, 17, 19, 0.08)'
                          : 'rgba(17, 17, 19, 0.05)'
                      : opt.badgeVariant === 'default'
                        ? 'rgba(163, 230, 53, 0.15)'
                        : 'rgba(255, 255, 255, 0.08)',
                    color: isLime
                      ? isSelected
                        ? '#D7F25C'
                        : '#111113'
                      : opt.badgeVariant === 'default'
                        ? '#bef264'
                        : '#cbd5e1',
                    border: isLime
                      ? `1px solid ${isSelected ? 'rgba(215, 242, 92, 0.45)' : 'rgba(17, 17, 19, 0.12)'}`
                      : `1px solid ${opt.badgeVariant === 'default' ? 'rgba(163, 230, 53, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                    letterSpacing: '0.02em',
                  }}
                >
                  {opt.badge}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
