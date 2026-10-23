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
  variant = 'light',
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

  // Default all supported methods to true so choices appear immediately
  const [availableMethods, setAvailableMethods] = useState({
    gemini: true,
    yake: true,
    rake_textrank: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [lastExtraction, setLastExtraction] = useState(null);

  // Sync window global on mount and selection changes
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

  // 2. Listen to upload-started event
  useEffect(() => {
    const handleUploadStarted = () => {
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

  return (
    <div
      className="extractor-picker-box"
      style={{
        marginTop: '14px',
        width: '100%',
        maxWidth: '460px',
        marginInline: 'auto',
        textAlign: 'left',
        background: '#FFFFFF',
        border: '1px solid rgba(17, 17, 19, 0.12)',
        borderRadius: '20px',
        padding: '16px 18px',
        boxShadow: '0 8px 26px rgba(17, 17, 19, 0.08)',
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
            padding: '5px 12px',
            borderRadius: '999px',
            marginBottom: '10px',
            fontSize: '0.76rem',
            fontWeight: 600,
            background: lastExtraction.fallback
              ? '#FEF3C7'
              : 'rgba(215, 242, 92, 0.35)',
            border: `1px solid ${
              lastExtraction.fallback
                ? '#F59E0B'
                : 'rgba(17, 17, 19, 0.18)'
            }`,
            color: lastExtraction.fallback ? '#92400E' : '#111113',
          }}
          role="status"
          aria-live="polite"
        >
          {lastExtraction.fallback ? (
            <>
              <AlertCircle size={13} style={{ flexShrink: 0, color: '#D97706' }} />
              <span>
                Used Gemini instead: {lastExtraction.fallback_reason || 'Fallback triggered'}
              </span>
            </>
          ) : (
            <>
              <Check size={13} style={{ flexShrink: 0, color: '#16A34A' }} />
              <span>
                Extracted with: {getMethodTitle(lastExtraction.extractor_used)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Label & Description (Sentence case) */}
      <div style={{ marginBottom: '10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '3px',
          }}
        >
          <span
            style={{
              fontSize: '0.92rem',
              fontWeight: 700,
              color: '#111113',
              letterSpacing: '-0.015em',
            }}
          >
            Extraction method
          </span>
          <span
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              color: '#111113',
              background: 'rgba(215, 242, 92, 0.4)',
              padding: '2px 8px',
              borderRadius: '999px',
              border: '1px solid rgba(17, 17, 19, 0.12)',
              letterSpacing: '0.01em',
            }}
          >
            {visibleOptions.length} available
          </span>
        </div>
        <div
          style={{
            fontSize: '0.78rem',
            fontWeight: 500,
            color: '#52525B',
            lineHeight: 1.3,
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
          gap: '8px',
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
                padding: '11px 14px',
                borderRadius: '13px',
                background: isSelected
                  ? '#FFFFFF'
                  : '#F8F9FA',
                border: isSelected
                  ? '2px solid #111113'
                  : '1.5px solid rgba(17, 17, 19, 0.09)',
                boxShadow: isSelected
                  ? '0 4px 14px rgba(17, 17, 19, 0.08)'
                  : 'none',
                cursor: 'pointer',
                transition: 'all 0.16s ease',
                outline: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                {/* Custom radio button */}
                <div
                  style={{
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    border: `2px solid ${isSelected ? '#111113' : 'rgba(17, 17, 19, 0.3)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    background: '#FFFFFF',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {isSelected && (
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#111113',
                      }}
                    />
                  )}
                </div>

                {/* Title & subtitle */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.88rem',
                      fontWeight: isSelected ? 700 : 600,
                      color: '#111113',
                      lineHeight: 1.25,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {opt.title}
                  </div>
                  <div
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: isSelected ? 500 : 450,
                      color: isSelected ? '#3F3F46' : '#64748B',
                      marginTop: '2px',
                      lineHeight: 1.25,
                    }}
                  >
                    {opt.subtitle}
                  </div>
                </div>
              </div>

              {/* Tag / Badge */}
              <div style={{ flexShrink: 0, marginLeft: '10px' }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    background: opt.badgeVariant === 'default'
                      ? '#D7F25C'
                      : isSelected
                        ? '#111113'
                        : '#EDEDF0',
                    color: opt.badgeVariant === 'default'
                      ? '#111113'
                      : isSelected
                        ? '#FFFFFF'
                        : '#3F3F46',
                    border: opt.badgeVariant === 'default'
                      ? '1px solid rgba(17, 17, 19, 0.2)'
                      : isSelected
                        ? '1px solid #111113'
                        : '1px solid rgba(17, 17, 19, 0.08)',
                    letterSpacing: '0.01em',
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
