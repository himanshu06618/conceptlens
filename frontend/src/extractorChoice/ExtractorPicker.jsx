import React, { useState, useEffect } from 'react';
import { Sparkles, Check, AlertCircle, Zap, Layers } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
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
}) {
  const [selectedMethod, setSelectedMethod] = useState('gemini');
  const [availableMethods, setAvailableMethods] = useState({ gemini: true });
  const [isLoading, setIsLoading] = useState(true);
  const [lastExtraction, setLastExtraction] = useState(null);

  // 1. Fetch available extractors on load (Gemini is always shown)
  useEffect(() => {
    if (!IS_FEATURE_ENABLED) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    async function loadExtractors() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/extractors`);
        if (!res.ok) {
          if (isMounted) setAvailableMethods({ gemini: true });
          return;
        }
        const data = await res.json();
        if (isMounted) {
          setAvailableMethods({ ...data, gemini: true });
        }
      } catch (err) {
        console.warn('Could not load extractors, defaulting to Gemini:', err);
        if (isMounted) setAvailableMethods({ gemini: true });
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

  // 2. Listen to upload-started event to reset selection to Gemini
  useEffect(() => {
    const handleUploadStarted = () => {
      setSelectedMethod('gemini');
      if (onChange) onChange('gemini');
    };

    window.addEventListener('conceptlens:upload-started', handleUploadStarted);
    return () => {
      window.removeEventListener('conceptlens:upload-started', handleUploadStarted);
    };
  }, [onChange]);

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
        marginTop: '1.25rem',
        width: '100%',
        maxWidth: '540px',
        marginInline: 'auto',
        textAlign: 'left',
      }}
    >
      {/* Small Badge: Extracted with: <method> / Used Gemini instead: <reason> */}
      {lastExtraction && lastExtraction.extractor_used && (
        <div
          className="extractor-status-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 12px',
            borderRadius: '999px',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            fontWeight: 500,
            background: lastExtraction.fallback
              ? 'rgba(245, 158, 11, 0.12)'
              : 'rgba(163, 230, 53, 0.12)',
            border: `1px solid ${
              lastExtraction.fallback
                ? 'rgba(245, 158, 11, 0.35)'
                : 'rgba(163, 230, 53, 0.35)'
            }`,
            color: lastExtraction.fallback ? '#fbbf24' : '#bef264',
            backdropFilter: 'blur(8px)',
          }}
          role="status"
          aria-live="polite"
        >
          {lastExtraction.fallback ? (
            <>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span>
                Used Gemini instead: {lastExtraction.fallback_reason || 'Extraction fallback triggered'}
              </span>
            </>
          ) : (
            <>
              <Check size={14} style={{ flexShrink: 0 }} />
              <span>
                Extracted with: {getMethodTitle(lastExtraction.extractor_used)}
              </span>
            </>
          )}
        </div>
      )}

      {/* Label & Description (Sentence case) */}
      <div style={{ marginBottom: '0.75rem' }}>
        <div
          style={{
            fontSize: '0.88rem',
            fontWeight: 600,
            color: '#f8fafc',
            letterSpacing: '0.01em',
          }}
        >
          Extraction method
        </div>
        <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>
          Choose how concepts are extracted from your file
        </div>
      </div>

      {/* Radio-style cards: one per line, mobile friendly, lime & white glass */}
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
                padding: '10px 14px',
                borderRadius: '12px',
                background: isSelected
                  ? 'rgba(163, 230, 53, 0.08)'
                  : 'rgba(255, 255, 255, 0.03)',
                border: `1px solid ${
                  isSelected
                    ? 'rgba(163, 230, 53, 0.55)'
                    : 'rgba(255, 255, 255, 0.08)'
                }`,
                boxShadow: isSelected
                  ? '0 0 16px rgba(163, 230, 53, 0.12)'
                  : 'none',
                cursor: 'pointer',
                transition: 'all 0.16s ease',
                backdropFilter: 'blur(10px)',
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
                    border: `2px solid ${
                      isSelected ? '#a3e635' : 'rgba(255, 255, 255, 0.3)'
                    }`,
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
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        background: '#a3e635',
                      }}
                    />
                  )}
                </div>

                {/* Title & subtitle */}
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.86rem',
                      fontWeight: isSelected ? 600 : 500,
                      color: isSelected ? '#ffffff' : '#e2e8f0',
                      lineHeight: 1.3,
                    }}
                  >
                    {opt.title}
                  </div>
                  <div
                    style={{
                      fontSize: '0.76rem',
                      color: '#94a3b8',
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
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: '6px',
                    background:
                      opt.badgeVariant === 'default'
                        ? 'rgba(163, 230, 53, 0.15)'
                        : 'rgba(255, 255, 255, 0.08)',
                    color:
                      opt.badgeVariant === 'default'
                        ? '#bef264'
                        : '#cbd5e1',
                    border: `1px solid ${
                      opt.badgeVariant === 'default'
                        ? 'rgba(163, 230, 53, 0.3)'
                        : 'rgba(255, 255, 255, 0.1)'
                    }`,
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
