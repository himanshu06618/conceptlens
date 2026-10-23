import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  FileText, 
  RefreshCw, 
  AlertCircle, 
  ArrowLeft,
  Cpu,
  Layers,
  Sparkles
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CompareView() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chartKey, setChartKey] = useState(Date.now());

  const getApiEndpoint = (path) => {
    const raw = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE || '';
    const base = raw ? String(raw).replace(/\/+$/, '') : '';
    // Ensure path has leading slash
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return base ? `${base}${cleanPath}` : cleanPath;
  };

  const fetchResults = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try /api/compare/results first, then /compare/results
      let res = await fetch(getApiEndpoint('/api/compare/results'));
      if (!res.ok && res.status === 404) {
        res = await fetch(getApiEndpoint('/compare/results'));
      }

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Benchmark module is disabled or results not yet generated. Set ENABLE_COMPARE=true on the backend and run the benchmark CLI.');
        }
        throw new Error(`Failed to load benchmark results (Status: ${res.status})`);
      }

      const json = await res.json();
      setData(json);
      setChartKey(Date.now());
    } catch (err) {
      setError(err.message || 'Error loading benchmark data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResults();
  }, []);

  const chartUrl = `${getApiEndpoint('/api/compare/chart')}?t=${chartKey}`;

  return (
    <div style={{
      minHeight: '100vh',
      padding: '2rem 1.5rem',
      maxWidth: '1200px',
      margin: '0 auto',
      color: '#f8fafc',
      fontFamily: 'Inter, system-ui, sans-serif'
    }}>
      {/* Top Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '0.5rem 1rem',
            borderRadius: '0.75rem',
            color: '#94a3b8',
            fontSize: '0.875rem',
            cursor: 'pointer',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#f8fafc'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'; }}
        >
          <ArrowLeft size={16} /> Back to Dashboard
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '0.25rem 0.75rem',
            borderRadius: '9999px',
            background: 'rgba(163, 230, 53, 0.12)',
            color: '#a3e635',
            border: '1px solid rgba(163, 230, 53, 0.3)'
          }}>
            <Sparkles size={12} /> Research Module (Flag-Gated)
          </span>

          <button
            onClick={fetchResults}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              padding: '0.5rem 0.85rem',
              borderRadius: '0.75rem',
              color: '#f8fafc',
              fontSize: '0.85rem',
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Header Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(163, 230, 53, 0.08) 0%, rgba(30, 41, 59, 0.7) 100%)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(163, 230, 53, 0.25)',
        borderRadius: '1.25rem',
        padding: '2rem',
        marginBottom: '2rem',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'rgba(163, 230, 53, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a3e635'
          }}>
            <BarChart3 size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: '#f8fafc' }}>
              Concept Extractor Benchmark
            </h1>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
              Comparing statistical unsupervised extraction (RAKE, TextRank) vs generative LLM (Gemini) on course notes.
            </p>
          </div>
        </div>

        {data?.timestamp && (
          <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#64748b' }}>
            Last evaluated at: {new Date(data.timestamp).toLocaleString()}
          </div>
        )}
      </div>

      {/* Error / Disabled State */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '1rem',
          padding: '1.5rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '1rem',
          marginBottom: '2rem'
        }}>
          <AlertCircle size={22} color="#f87171" style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <div style={{ fontWeight: 600, color: '#fca5a5', marginBottom: '0.25rem' }}>
              Benchmark Results Unavailable
            </div>
            <div style={{ color: '#cbd5e1', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {error}
            </div>
            <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#94a3b8' }}>
              CLI Command to generate: <code>python -m backend.compare.run_benchmark --extractors rake textrank gemini</code>
            </div>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && !data && (
        <div style={{
          padding: '4rem 2rem',
          textAlign: 'center',
          background: 'rgba(255, 255, 255, 0.02)',
          borderRadius: '1rem',
          border: '1px dashed rgba(255, 255, 255, 0.1)'
        }}>
          <RefreshCw size={32} color="#a3e635" className="animate-spin" style={{ margin: '0 auto 1rem auto' }} />
          <div style={{ color: '#94a3b8', fontSize: '0.95rem' }}>Loading benchmark results...</div>
        </div>
      )}

      {/* Results Content */}
      {data && data.extractors && (
        <>
          {/* Metrics Summary Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.25rem',
            marginBottom: '2rem'
          }}>
            {Object.entries(data.extractors).map(([name, metrics]) => {
              const isGemini = name.toLowerCase() === 'gemini';
              return (
                <div
                  key={name}
                  style={{
                    background: 'rgba(15, 23, 42, 0.65)',
                    backdropFilter: 'blur(12px)',
                    border: isGemini ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid rgba(163, 230, 53, 0.35)',
                    borderRadius: '1rem',
                    padding: '1.5rem',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {isGemini ? <Cpu size={20} color="#38bdf8" /> : <Layers size={20} color="#a3e635" />}
                      <span style={{ fontWeight: 700, fontSize: '1.15rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {name}
                      </span>
                    </div>
                    <span style={{
                      fontSize: '0.75rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      background: isGemini ? 'rgba(56, 189, 248, 0.15)' : 'rgba(163, 230, 53, 0.15)',
                      color: isGemini ? '#38bdf8' : '#a3e635',
                      fontWeight: 600
                    }}>
                      {isGemini ? 'LLM' : 'Statistical'}
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>F1 Score</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f8fafc' }}>
                        {metrics.f1 ?? '0.00'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Precision</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#38bdf8' }}>
                        {metrics.precision ?? '0.00'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Recall</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a3e635' }}>
                        {metrics.recall ?? '0.00'}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '0.75rem', borderRadius: '0.5rem' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Avg Latency</div>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f59e0b' }}>
                        {metrics.avg_time_seconds ? `${metrics.avg_time_seconds}s` : '0s'}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Avg Concepts: {metrics.avg_concepts_returned ?? 0}</span>
                    <span>Notes Tested: {metrics.total_notes ?? 0}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Comparison Bar Chart Image */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '1rem',
            padding: '1.5rem',
            marginBottom: '2rem'
          }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <BarChart3 size={18} color="#a3e635" /> Performance Comparison Chart
            </h3>
            <div style={{ textAlign: 'center', overflow: 'hidden', borderRadius: '0.75rem' }}>
              <img
                src={chartUrl}
                alt="Extractor Comparison Bar Chart"
                style={{
                  maxWidth: '100%',
                  height: 'auto',
                  borderRadius: '0.5rem',
                  border: '1px solid rgba(255, 255, 255, 0.05)'
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
          </div>

          {/* Per-Note Breakdown Table */}
          {data.notes_detail && (
            <div style={{
              background: 'rgba(15, 23, 42, 0.65)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '1rem',
              padding: '1.5rem',
              overflowX: 'auto'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={18} color="#a3e635" /> Sample Notes Evaluation Breakdown
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)', color: '#94a3b8' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Note File</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Extractor</th>
                    <th style={{ padding: '0.75rem 1rem' }}>F1 Score</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Precision</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Recall</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Concepts</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.notes_detail).flatMap(([noteName, extractors]) =>
                    Object.entries(extractors).map(([extName, res], idx) => (
                      <tr
                        key={`${noteName}-${extName}`}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                          background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.015)'
                        }}
                      >
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 500, color: '#f8fafc' }}>{noteName}</td>
                        <td style={{ padding: '0.75rem 1rem', textTransform: 'capitalize', color: extName === 'gemini' ? '#38bdf8' : '#a3e635' }}>
                          {extName}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#f8fafc' }}>{res.f1}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{res.precision}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#cbd5e1' }}>{res.recall}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#94a3b8' }}>{res.concepts?.length ?? 0}</td>
                        <td style={{ padding: '0.75rem 1rem', color: '#94a3b8' }}>{res.time_seconds}s</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
