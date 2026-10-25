import React, { useState, useEffect } from 'react';
import { Sparkles, Check, AlertCircle, Zap } from 'lucide-react';

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
    title: 'Google Gemini',
    subtitle: 'PyMuPDF + Gemini',
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
];

export default function ExtractorPicker({
  documents = [],
  isUploading = false,
  onChange,
  variant = 'light',
}) {
  const [selectedMethod, setSelectedMethod] = useState(() => {
    try {
      const stored = (typeof window !== 'undefined' && window.__conceptlens_extractor)
        || localStorage.getItem('conceptlens_selected_extractor');
      if (stored && stored !== 'rake_textrank' && stored !== 'rake') {
        return stored;
      }
      return 'gemini';
    } catch {
      return 'gemini';
    }
  });

  // Default all supported methods to true so choices appear immediately
  const [availableMethods, setAvailableMethods] = useState({
    gemini: true,
    yake: true,
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
        marginTop: '8px',
        width: '100%',
        maxWidth: '540px',
        marginInline: 'auto',
        textAlign: 'left',
        background: '#FFFFFF',
        border: '1px solid rgba(17, 17, 19, 0.12)',
        borderRadius: '16px',
        padding: '10px 14px',
        boxShadow: '0 4px 18px rgba(17, 17, 19, 0.06)',
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
            padding: '3px 10px',
            borderRadius: '999px',
            marginBottom: '6px',
            fontSize: '0.72rem',
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
              <AlertCircle size={12} style={{ flexShrink: 0, color: '#D97706' }} />
              <span>
                Used Gemini: {lastExtraction.fallback_reason || 'Fallback triggered'}
              </span>
            </>
          ) : (
            <>
              <Check size={12} style={{ flexShrink: 0, color: '#16A34A' }} />
              <span>
                Extracted with: {getMethodTitle(lastExtraction.extractor_used)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Header: Label & Count */}
      <div style={{ marginBottom: '6px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1px',
          }}
        >
          <span
            style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#111113',
              letterSpacing: '-0.015em',
            }}
          >
            Extraction method
          </span>
          <span
            style={{
              fontSize: '0.68rem',
              fontWeight: 600,
              color: '#111113',
              background: 'rgba(215, 242, 92, 0.4)',
              padding: '1px 7px',
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
            fontSize: '0.72rem',
            fontWeight: 500,
            color: '#52525B',
            lineHeight: 1.2,
          }}
        >
          Choose how concepts are extracted from your file
        </div>
      </div>

      {/* Compact 3-Column Grid for Options */}
      <div
        role="radiogroup"
        aria-label="Extraction method"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
          gap: '6px',
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
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '7px 9px',
                borderRadius: '10px',
                background: isSelected ? '#FFFFFF' : '#F8F9FA',
                border: isSelected
                  ? '2px solid #111113'
                  : '1.5px solid rgba(17, 17, 19, 0.09)',
                boxShadow: isSelected
                  ? '0 3px 10px rgba(17, 17, 19, 0.08)'
                  : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                outline: 'none',
                minHeight: '50px',
              }}
            >
              {/* Top row: Radio + Title + Badge */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '13px',
                      height: '13px',
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
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          background: '#111113',
                        }}
                      />
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: isSelected ? 700 : 600,
                      color: '#111113',
                      lineHeight: 1.2,
                      letterSpacing: '-0.01em',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={opt.title}
                  >
                    {opt.title}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '4px',
                    flexShrink: 0,
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

              {/* Subtitle */}
              <div
                style={{
                  fontSize: '0.68rem',
                  fontWeight: isSelected ? 500 : 450,
                  color: isSelected ? '#3F3F46' : '#64748B',
                  marginTop: '3px',
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={opt.subtitle}
              >
                {opt.subtitle}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
