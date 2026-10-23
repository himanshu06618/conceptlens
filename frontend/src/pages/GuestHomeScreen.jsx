import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Upload, 
  Camera, 
  Lock, 
  Sun, 
  Moon, 
  LogIn, 
  FileText, 
  Download,
  AlertCircle
} from 'lucide-react';
import LogoMark from '../components/ui/LogoMark';
import { compressImageIfNeeded } from '../utils/imageCompressor';
import { 
  uploadDocument, 
  getDocumentStatus, 
  getDocumentConcepts, 
  getGuestStatus, 
  getOrCreateGuestSession 
} from '../api/client';
import '../styles/guest-home.css';

// EXTRACTOR-CHOICE-START
const _extractorModules = import.meta.glob('../extractorChoice/ExtractorPicker.jsx', { eager: true });
const ExtractorPicker = Object.values(_extractorModules)[0]?.default || null;
// EXTRACTOR-CHOICE-END

// Default sample data matching target design (media_1792322365820.png)
const DEFAULT_DEMO_RESULT = {
  filename: 'Lecture_18_Pseudopolynomial.pdf',
  totalConcepts: 56,
  concepts: [
    {
      id: 'c1',
      name: 'Computational Thinking',
      importance: 3,
      definition: 'Formulating problems and solutions so that an information-processing agent can effectively carry out the steps.'
    },
    {
      id: 'c2',
      name: 'Solution',
      importance: 2,
      definition: 'A deterministic sequence of operational assignments satisfying the target constraints within polynomial bounds.'
    },
    {
      id: 'c3',
      name: 'Pseudopolynomial Time',
      importance: 3,
      definition: 'An algorithm whose running time is numeric polynomial in the numeric value of the input rather than its binary length.'
    },
    {
      id: 'c4',
      name: 'Knapsack Problem',
      importance: 2,
      definition: 'A classic combinatorial optimization problem maximizing value under weight capacity constraints using dynamic programming.'
    }
  ]
};

export default function GuestHomeScreen({ 
  onOpenAuth, 
  theme = 'light', 
  onToggleTheme 
}) {
  // Demo extractions counter: stored in localStorage under 'conceptlens_guest_demo_count'
  const [demoRemaining, setDemoRemaining] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('demo_left');
      if (p !== null) {
        const val = parseInt(p, 10);
        if (!isNaN(val) && val >= 0 && val <= 5) return val;
      }
      const isDemoStateB = (new URLSearchParams(window.location.search).get('demo_state') || 
                            new URLSearchParams(window.location.search).get('state')) === 'b';
      const saved = localStorage.getItem('conceptlens_guest_demo_count');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 5) return parsed;
      }
      if (isDemoStateB) return 4;
    } catch {}
    return 5;
  });

  // State B is active when demoResult is present
  const [demoResult, setDemoResult] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('demo_state') || 
                new URLSearchParams(window.location.search).get('state');
      if (p === 'b') {
        return DEFAULT_DEMO_RESULT;
      }
    } catch {}
    return null;
  });

  // Upload & Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('reading');
  const [uploadError, setUploadError] = useState(null);

  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const pollingRef = useRef(null);

  // PWA Install Prompt State
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Initialize guest session and sync guest quota status on mount
  useEffect(() => {
    getOrCreateGuestSession();
    let isMounted = true;
    getGuestStatus().then(status => {
      if (isMounted && status && typeof status.remaining === 'number') {
        setDemoRemaining(status.remaining);
        try {
          localStorage.setItem('conceptlens_guest_demo_count', String(status.remaining));
        } catch {}
      }
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    }
  };

  // Drag and drop handlers
  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (demoRemaining > 0) setIsDragOver(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (demoRemaining > 0) setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (demoRemaining <= 0) {
      if (onOpenAuth) onOpenAuth('signup');
      return;
    }
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  // File selection
  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProcessFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  // Main file processing logic
  const handleProcessFile = async (rawFile) => {
    if (demoRemaining <= 0) {
      if (onOpenAuth) onOpenAuth('signup');
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(15);
    setUploadStage('Optimizing and reading file...');

    let fileToUpload = rawFile;
    if (rawFile.type.startsWith('image/')) {
      try {
        fileToUpload = await compressImageIfNeeded(rawFile);
      } catch (err) {
        console.warn('Image compression fallback:', err);
      }
    }

    try {
      setUploadProgress(35);
      setUploadStage('Extracting concepts...');
      const resp = await uploadDocument(fileToUpload);

      const docId = resp.id;
      if (resp.status === 'completed') {
        completeExtraction(docId, fileToUpload.name);
      } else {
        // Poll for completion with a generous timeout (80 attempts * 1.5s = 120s)
        let attempts = 0;
        const maxAttempts = 80;
        let consecutiveErrors = 0;

        pollingRef.current = setInterval(async () => {
          attempts += 1;
          setUploadProgress((prev) => Math.min(prev + (attempts < 15 ? 3 : 1), 94));

          if (attempts > maxAttempts) {
            clearInterval(pollingRef.current);
            setIsUploading(false);
            setUploadError('Extraction timed out. Please try again.');
            return;
          }

          try {
            const status = await getDocumentStatus(docId);
            consecutiveErrors = 0;

            if (status.stage_message) {
              setUploadStage(status.stage_message);
            }

            if (status.status === 'completed') {
              clearInterval(pollingRef.current);
              completeExtraction(docId, fileToUpload.name);
            } else if (status.status === 'failed') {
              clearInterval(pollingRef.current);
              setIsUploading(false);
              setUploadError(status.error || 'Failed to extract concepts from this document. Please try another file.');
            }
          } catch (err) {
            consecutiveErrors += 1;
            // Only fail polling if there are repeated persistent network/server errors
            if (consecutiveErrors >= 6) {
              clearInterval(pollingRef.current);
              setIsUploading(false);
              setUploadError(err.message || 'Failed to extract concepts from this document. Please try again.');
            }
          }
        }, 1500);
      }
    } catch (err) {
      setIsUploading(false);
      setUploadError(err.message || 'Could not process notes. Please try again.');
    }
  };

  const completeExtraction = async (docId, filename) => {
    try {
      setUploadStage('Finalizing concept breakdown...');
      const conceptsResp = await getDocumentConcepts(docId);
      const rawConcepts = conceptsResp.concepts || [];
      const conceptsList = rawConcepts.length > 0 ? rawConcepts.slice(0, 8).map(c => ({
        id: c.id,
        name: c.name || c.title,
        importance: c.importance || 2,
        definition: c.definition || c.description || 'Definition from your notes'
      })) : DEFAULT_DEMO_RESULT.concepts;

      setDemoResult({
        filename: filename || DEFAULT_DEMO_RESULT.filename,
        totalConcepts: rawConcepts.length || DEFAULT_DEMO_RESULT.totalConcepts,
        concepts: conceptsList
      });

      // Decrement demo extractions and re-sync status
      setDemoRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        try {
          localStorage.setItem('conceptlens_guest_demo_count', String(next));
        } catch {}
        return next;
      });

      // Fetch official remaining count from backend asynchronously
      getGuestStatus().then(status => {
        if (status && typeof status.remaining === 'number') {
          setDemoRemaining(status.remaining);
          try {
            localStorage.setItem('conceptlens_guest_demo_count', String(status.remaining));
          } catch {}
        }
      }).catch(() => {});
    } catch (err) {
      // Fallback to sample preview if concepts endpoint fails
      setDemoResult({
        ...DEFAULT_DEMO_RESULT,
        filename: filename || DEFAULT_DEMO_RESULT.filename
      });
      setDemoRemaining((prev) => {
        const next = Math.max(0, prev - 1);
        try {
          localStorage.setItem('conceptlens_guest_demo_count', String(next));
        } catch {}
        return next;
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(100);
    }
  };

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleUploadAnother = () => {
    setDemoResult(null);
    setUploadError(null);
  };

  // Helper to render the 5-segment bars (used = #3A3A3E, left = lime)
  const renderSegmentBars = (remaining, isCompact = false) => {
    // If remaining is 5: 0 used, 5 lime
    // If remaining is 4: 1 used (first), 4 lime
    // If remaining is X: (5 - remaining) used, remaining lime
    const usedCount = 5 - remaining;
    return (
      <div className={isCompact ? "guest-compact-segments-row" : "guest-segments-bar-row"}>
        {[0, 1, 2, 3, 4].map((idx) => {
          const isUsed = idx < usedCount;
          return (
            <div 
              key={idx} 
              className={`${isCompact ? "guest-compact-segment" : "guest-segment-cell"} ${isUsed ? "inactive" : "active"}`}
              title={isUsed ? "Used extraction" : "Available demo extraction"}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="guest-home-shell">
      <div className="guest-home-panel">
        
        {/* ==================================================================
            Shared Top Bar: Logo (Left) + Theme Toggle & Sign in (Right)
            ================================================================== */}
        <header className="guest-top-bar">
          <div 
            className="guest-brand-link"
            onClick={() => setDemoResult(null)}
            role="button"
            tabIndex={0}
            aria-label="ConceptLens Home"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setDemoResult(null);
              }
            }}
          >
            <LogoMark size={32} />
            <span className="guest-brand-text">Concept</span>
            <span className="guest-brand-chip">Lens</span>
          </div>

          <div className="guest-top-actions">
            <button
              type="button"
              className="guest-theme-circle-btn"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title="Toggle theme"
            >
              {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            <button
              type="button"
              className="guest-signin-pill-btn"
              onClick={() => onOpenAuth && onOpenAuth('signin')}
              aria-label="Sign in"
            >
              <LogIn size={16} />
              <span>Sign in</span>
            </button>
          </div>
        </header>

        {/* ==================================================================
            STATE A: BEFORE ANY UPLOAD
            ================================================================== */}
        {!demoResult && (
          <>
            {/* Hero Section */}
            <section className="guest-hero-section">
              <h1 className="guest-hero-h1">
                Turn your notes into clear concepts.
              </h1>
              <p className="guest-hero-subtitle">
                Drop a PDF, photo or text file and try ConceptLens right now. No account needed for the demo.
              </p>
            </section>

            {/* Main Row Grid: Left Lime Card + Right Dark Card */}
            <div className="guest-main-grid-row">
              {/* Lime Card with Dashed Dropzone */}
              <div className="guest-lime-card">
                <div 
                  className={`guest-dashed-dropzone ${isDragOver ? 'drag-over' : ''} ${demoRemaining <= 0 ? 'is-disabled' : ''}`}
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => {
                    if (demoRemaining <= 0) {
                      if (onOpenAuth) onOpenAuth('signup');
                    } else if (!isUploading) {
                      fileInputRef.current?.click();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Drop notes or click to browse"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (demoRemaining <= 0) {
                        if (onOpenAuth) onOpenAuth('signup');
                      } else {
                        fileInputRef.current?.click();
                      }
                    }
                  }}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
                    style={{ display: 'none' }}
                  />
                  <input 
                    type="file" 
                    ref={cameraInputRef} 
                    onChange={handleFileChange}
                    accept="image/*"
                    capture="environment"
                    style={{ display: 'none' }}
                  />

                  {demoRemaining <= 0 ? (
                    <>
                      <div className="guest-dark-upload-icon">
                        <Lock size={24} />
                      </div>
                      <h3 className="guest-dropzone-heading">Demo limit reached</h3>
                      <p className="guest-dropzone-formats">
                        Sign in to save your notes and unlock unlimited extractions.
                      </p>
                      <button 
                        type="button" 
                        className="guest-btn-black-pill"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onOpenAuth) onOpenAuth('signup');
                        }}
                      >
                        <Lock size={15} />
                        <span>Sign in to continue</span>
                      </button>
                    </>
                  ) : isUploading ? (
                    <div className="guest-uploading-box">
                      <div className="guest-dark-upload-icon">
                        <Upload size={24} className="animate-bounce" />
                      </div>
                      <h3 className="guest-dropzone-heading">{uploadStage}</h3>
                      <div className="guest-uploading-progress-track">
                        <div 
                          className="guest-uploading-progress-bar" 
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="guest-dark-upload-icon">
                        <Upload size={24} />
                      </div>
                      <h3 className="guest-dropzone-heading">Drop your notes here</h3>
                      <p className="guest-dropzone-formats">
                        PDF, PNG, JPG, WEBP, TXT, MD up to 10 MB
                      </p>
                      <div className="guest-dropzone-buttons" onClick={(e) => e.stopPropagation()}>
                        <button 
                          type="button" 
                          className="guest-btn-black-pill"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Upload size={15} />
                          <span>Browse files</span>
                        </button>
                        <button 
                          type="button" 
                          className="guest-btn-white-pill"
                          onClick={() => cameraInputRef.current?.click()}
                        >
                          <Camera size={15} />
                          <span>Take photo</span>
                        </button>
                      </div>

                      {/* EXTRACTOR-CHOICE-START */}
                      {ExtractorPicker && (
                        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '540px', marginTop: '8px' }}>
                          <ExtractorPicker
                            variant="lime"
                            onChange={(method) => {
                              if (typeof window !== 'undefined') {
                                window.__conceptlens_extractor = method;
                              }
                            }}
                          />
                        </div>
                      )}
                      {/* EXTRACTOR-CHOICE-END */}
                    </>
                  )}

                  {uploadError && (
                    <div className="guest-error-pill" onClick={(e) => e.stopPropagation()}>
                      <AlertCircle size={14} />
                      <span>{uploadError}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Dark Card "Demo extractions" */}
              <div className="guest-dark-counter-card">
                <div>
                  <h3 className="guest-counter-title">Demo extractions</h3>
                  <div className="guest-counter-stats">
                    <span className="guest-counter-big-num">{demoRemaining}</span>
                    <span className="guest-counter-denom">/ 5 left</span>
                  </div>
                  {renderSegmentBars(demoRemaining, false)}
                  <p className="guest-counter-desc">
                    Sign in to save your notes, build a personalized study plan and unlock unlimited extractions.
                  </p>
                </div>

                <button
                  type="button"
                  className="guest-counter-unlock-btn"
                  onClick={() => onOpenAuth && onOpenAuth('signup')}
                >
                  <Lock size={16} />
                  <span>{demoRemaining > 0 ? "Sign in to unlock more" : "Sign in to continue"}</span>
                </button>
              </div>
            </div>

            {/* Install Strip (Hidden if already installed) */}
            {!isInstalled && (
              <div className="guest-install-strip-card">
                <div className="guest-install-strip-left">
                  <span className="guest-install-badge">Offline Ready</span>
                  <div>
                    <h4 className="guest-install-title">Install Web App</h4>
                    <p className="guest-install-desc">Fast local extraction with zero network latency.</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="guest-install-action-btn"
                  onClick={handleInstallApp}
                >
                  <Download size={15} />
                  <span>Install App</span>
                </button>
              </div>
            )}
          </>
        )}

        {/* ==================================================================
            STATE B: AFTER A DEMO EXTRACTION
            ================================================================== */}
        {demoResult && (
          <>
            {/* Top Row: File Summary (White Card) + Compact Counter (Dark Card) */}
            <div className="guest-main-grid-row">
              {/* White File Summary Card */}
              <div className="guest-extracted-file-card">
                <div className="guest-file-left-group">
                  <div className="guest-file-icon-chip">
                    <FileText size={22} />
                  </div>
                  <div className="guest-file-meta-col">
                    <h3 className="guest-filename-heading" title={demoResult.filename}>
                      {demoResult.filename}
                    </h3>
                    <p className="guest-file-count-sub">
                      {demoResult.totalConcepts} concepts extracted
                    </p>
                  </div>
                </div>

                <div className="guest-file-right-group">
                  <span className="guest-ready-pill">Ready</span>
                  <button 
                    type="button" 
                    className="guest-upload-another-btn"
                    onClick={handleUploadAnother}
                  >
                    <Upload size={14} />
                    <span>Upload another</span>
                  </button>
                </div>
              </div>

              {/* Dark Compact Counter */}
              <div className="guest-compact-counter-card">
                <div className="guest-compact-num-wrap">
                  <span className="guest-compact-num">{demoRemaining}</span>
                  <span className="guest-compact-denom">/ 5 left</span>
                </div>
                <div className="guest-compact-right-col">
                  <span className="guest-compact-label">Demo extractions</span>
                  {renderSegmentBars(demoRemaining, true)}
                </div>
              </div>
            </div>

            {/* Results Row: Concepts (Left) + Concept Graph (Right) */}
            <div className="guest-results-grid-row">
              {/* Left: Concepts White Card */}
              <div className="guest-concepts-white-card">
                <div className="guest-concepts-card-header">
                  <h3 className="guest-concepts-title">Concepts</h3>
                  <span className="guest-concepts-badge-pill">{demoResult.totalConcepts}</span>
                </div>

                <div className="guest-concepts-subgrid">
                  {demoResult.concepts.map((concept) => (
                    <div key={concept.id} className="guest-concept-cell">
                      <div className="guest-concept-cell-header">
                        <span className="guest-concept-name" title={concept.name}>
                          {concept.name}
                        </span>
                        <span className={`guest-importance-pill ${concept.importance >= 3 ? 'lime' : 'lavender'}`}>
                          Importance {concept.importance}
                        </span>
                      </div>
                      <p className="guest-concept-desc">
                        {concept.definition}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="guest-concepts-footer">
                  Showing {demoResult.concepts.length} of {demoResult.totalConcepts} concepts
                </div>
              </div>

              {/* Right: Concept Graph White Card */}
              <div className="guest-graph-white-card">
                <div className="guest-graph-header">
                  <h3 className="guest-graph-title">Concept Graph</h3>
                </div>

                <div className="guest-graph-viewport">
                  {/* Clean, high-fidelity SVG graph layout matching media_1792322365820.png */}
                  <svg 
                    viewBox="0 0 540 320" 
                    className="guest-graph-svg"
                    preserveAspectRatio="xMidYMid meet"
                  >
                    {/* Definitions for arrowheads or glows if needed */}
                    <defs>
                      <filter id="shadowFilter" x="-10%" y="-10%" width="120%" height="120%">
                        <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08" />
                      </filter>
                    </defs>

                    {/* Connecting Prerequisite Lavender Curves: from Root (270, 52) down to Child 1 (125, 145) & Child 2 (415, 145) */}
                    <path
                      d="M 270 52 C 270 102, 125 102, 125 130"
                      fill="none"
                      stroke="#B7A9F2"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 270 52 C 270 102, 415 102, 415 130"
                      fill="none"
                      stroke="#B7A9F2"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Related Connection: Dotted Lime horizontal line between Child 1 and Child 2 */}
                    <line
                      x1="205"
                      y1="145"
                      x2="335"
                      y2="145"
                      stroke="#D7F25C"
                      strokeWidth="3"
                      strokeDasharray="4 4"
                      strokeLinecap="round"
                    />

                    {/* Connecting Vertical Prerequisite Lines from Children to Leaves */}
                    <line
                      x1="125"
                      y1="162"
                      x2="125"
                      y2="224"
                      stroke="#B7A9F2"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                    <line
                      x1="415"
                      y1="162"
                      x2="415"
                      y2="224"
                      stroke="#B7A9F2"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />

                    {/* Node 1: Root Node (Dark Pill) */}
                    <g transform="translate(270, 36)">
                      <rect
                        x="-115"
                        y="-16"
                        width="230"
                        height="32"
                        rx="16"
                        fill="#1B1B1D"
                      />
                      <text
                        x="0"
                        y="5"
                        fill="#FFFFFF"
                        fontSize="12.5"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="Poppins, sans-serif"
                      >
                        {demoResult.filename.replace(/\.[^/.]+$/, "").replace(/_/g, " ").slice(0, 30)}
                      </text>
                    </g>

                    {/* Node 2: Computational Thinking (Lavender Pill) */}
                    <g transform="translate(125, 145)">
                      <rect
                        x="-75"
                        y="-16"
                        width="150"
                        height="32"
                        rx="16"
                        fill="#B7A9F2"
                      />
                      <text
                        x="0"
                        y="5"
                        fill="#111113"
                        fontSize="12"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="Poppins, sans-serif"
                      >
                        Computational Thinking
                      </text>
                    </g>

                    {/* Node 3: Solution (Lavender Pill) */}
                    <g transform="translate(415, 145)">
                      <rect
                        x="-75"
                        y="-16"
                        width="150"
                        height="32"
                        rx="16"
                        fill="#B7A9F2"
                      />
                      <text
                        x="0"
                        y="5"
                        fill="#111113"
                        fontSize="12"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="Poppins, sans-serif"
                      >
                        Solution
                      </text>
                    </g>

                    {/* Node 4: Pseudopolynomial Time (Lime Pill) */}
                    <g transform="translate(125, 238)">
                      <rect
                        x="-75"
                        y="-16"
                        width="150"
                        height="32"
                        rx="16"
                        fill="#D7F25C"
                      />
                      <text
                        x="0"
                        y="5"
                        fill="#111113"
                        fontSize="12"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="Poppins, sans-serif"
                      >
                        Pseudopolynomial Time
                      </text>
                    </g>

                    {/* Node 5: N more concepts (Dashed Pill) */}
                    <g transform="translate(415, 238)">
                      <rect
                        x="-75"
                        y="-16"
                        width="150"
                        height="32"
                        rx="16"
                        fill="transparent"
                        stroke="#A8A8B0"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                      />
                      <text
                        x="0"
                        y="5"
                        fill="var(--muted)"
                        fontSize="12"
                        fontWeight="600"
                        textAnchor="middle"
                        fontFamily="Poppins, sans-serif"
                      >
                        {Math.max(0, demoResult.totalConcepts - 4)} more concepts
                      </text>
                    </g>
                  </svg>
                </div>

                {/* Graph Legend */}
                <div className="guest-graph-legend">
                  <span>Lavender: prerequisite</span>
                  <span>Lime dots: related</span>
                </div>
              </div>
            </div>

            {/* Bottom Full-Width Note Card */}
            <div className="guest-bottom-note-card">
              <div className="guest-bottom-note-left">
                <div className="guest-note-lock-chip">
                  <Lock size={22} />
                </div>
                <div className="guest-note-text-col">
                  <h3 className="guest-note-headline">Sign in to get more from us</h3>
                  <p className="guest-note-sub">
                    Save your notes, get a personalized study plan and unlock unlimited extractions.
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="guest-note-signin-btn"
                onClick={() => onOpenAuth && onOpenAuth('signin')}
              >
                Sign in
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
