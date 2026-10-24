import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Camera, 
  FileText, 
  AlertCircle, 
  Sparkles,
  ArrowRight,
  Clock,
  Layers
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { compressImageIfNeeded } from '../utils/imageCompressor';
import { Button, Stepper, PaperSurface, Badge, BookshelfLoader } from './ui';

// EXTRACTOR-CHOICE-START
const _extractorModules = import.meta.glob('../extractorChoice/ExtractorPicker.jsx', { eager: true });
const ExtractorPicker = Object.values(_extractorModules)[0]?.default || null;
// EXTRACTOR-CHOICE-END

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md';

const FRIENDLY_MICROCOPY = [
  'Reading note structure...',
  'Scanning handwriting & typography...',
  'Extracting core definitions & principles...',
  'Mapping concept hierarchies...',
  'Structuring interactive concept tree...'
];

const PROCESSING_STEPS = [
  { id: 'reading', label: 'Reading', desc: 'Parsing document' },
  { id: 'ocr', label: 'OCR', desc: 'Scanning text' },
  { id: 'extracting', label: 'Extracting', desc: 'Structuring tree' }
];

export default function UploadView({
  onUpload,
  isUploading,
  processingDoc,
  processingStage,
  processingProgress = 5,
  processingMessage = '',
  ocrPageInfo = { current: 0, total: 0 },
  processingError,
  onCancelProcessing,
  onRetryUpload,
  guestStatus = null,
  user = null,
  onOpenAuth,
  documents = [],
  onSelectDoc
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [microcopyIndex, setMicrocopyIndex] = useState(0);
  const [retryPassword, setRetryPassword] = useState('');
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isCameraReady, setIsCameraReady] = useState(false);

  const fileInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const cameraRequestIdRef = useRef(0);

  const isLimitReached = !user && guestStatus && guestStatus.uploads_count >= (guestStatus.upload_limit || 5);

  // Rotating friendly microcopy during processing
  useEffect(() => {
    if (!processingDoc || processingError) return;
    const interval = setInterval(() => {
      setMicrocopyIndex((prev) => (prev + 1) % FRIENDLY_MICROCOPY.length);
    }, 2400);
    return () => clearInterval(interval);
  }, [processingDoc, processingError]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    const stream = cameraStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;
    video.play().catch(() => {
      setCameraError('The camera opened, but the live preview could not start. Check your browser permissions and try again.');
    });
  }, [isCameraOpen, isCameraLoading]);

  useEffect(() => () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  // Celebrate on stage completion
  useEffect(() => {
    if (processingStage === 'completed') {
      try {
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.6 },
          colors: ['#9AE62E', '#C4F560', '#6FC21A']
        });
      } catch {
        // Safe fallback if canvas-confetti is not loaded
      }
    }
  }, [processingStage]);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLimitReached) return;
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (isLimitReached) {
      if (onOpenAuth) onOpenAuth('signup');
      return;
    }

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processAndUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (isLimitReached) {
      if (onOpenAuth) onOpenAuth('signup');
      return;
    }

    if (e.target.files && e.target.files[0]) {
      processAndUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  const stopCamera = () => {
    cameraRequestIdRef.current += 1;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setIsCameraOpen(false);
    setIsCameraLoading(false);
    setIsCameraReady(false);
  };

  const handleOpenCamera = async () => {
    if (isLimitReached) {
      if (onOpenAuth) onOpenAuth('signup');
      return;
    }

    setIsCameraOpen(true);
    setIsCameraLoading(true);
    setIsCameraReady(false);
    setCameraError('');
    const requestId = ++cameraRequestIdRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is unavailable. Open this page over HTTPS (or localhost) and use a browser that supports camera access.');
      setIsCameraLoading(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      });
      if (cameraRequestIdRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraStreamRef.current = stream;
    } catch (error) {
      if (cameraRequestIdRef.current !== requestId) return;
      const messages = {
        NotAllowedError: 'Camera permission was denied. Allow camera access in your browser settings, then try again.',
        NotFoundError: 'No camera was found on this device.',
        NotReadableError: 'The camera is already in use by another app. Close that app and try again.',
        OverconstrainedError: 'This device could not provide a camera that meets the request.',
      };
      setCameraError(messages[error.name] || `Could not open the camera${error.message ? `: ${error.message}` : '.'}`);
    } finally {
      if (cameraRequestIdRef.current === requestId) setIsCameraLoading(false);
    }
  };

  const handleCapturePhoto = async () => {
    const video = cameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setCameraError('The camera preview is not ready yet. Please wait a moment and try again.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('This browser could not prepare the photo. Please try another browser.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setCameraError('The photo could not be captured. Please try again.');
      return;
    }

    const photo = new File([blob], 'camera-photo.jpg', {
      type: 'image/jpeg',
    });
    stopCamera();
    processAndUpload(photo);
  };

  const processAndUpload = async (file) => {
    const maxMb = 10;
    if (file.size > maxMb * 1024 * 1024) {
      alert(`File size exceeds ${maxMb} MB. Please upload a smaller file.`);
      return;
    }

    // EXTRACTOR-CHOICE-START
    try {
      const chosenExtractor = (typeof window !== 'undefined' && window.__conceptlens_extractor)
        || (typeof localStorage !== 'undefined' && localStorage.getItem('conceptlens_selected_extractor'))
        || 'gemini';
      const uploadOpts = { extractor: chosenExtractor };
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('conceptlens:upload-started'));
      }
      if (file.type.startsWith('image/')) {
        setIsCompressing(true);
        try {
          const compressed = await compressImageIfNeeded(file);
          onUpload(compressed, uploadOpts);
        } catch (err) {
          console.warn('Image compression fallback:', err);
          onUpload(file, uploadOpts);
        } finally {
          setIsCompressing(false);
        }
      } else {
        onUpload(file, uploadOpts);
      }
      return;
    } catch (_) {}
    // EXTRACTOR-CHOICE-END

    if (file.type.startsWith('image/')) {
      setIsCompressing(true);
      try {
        const compressed = await compressImageIfNeeded(file);
        onUpload(compressed);
      } catch (err) {
        console.warn('Image compression fallback:', err);
        onUpload(file);
      } finally {
        setIsCompressing(false);
      }
    } else {
      onUpload(file);
    }
  };

  const loadSample = (sampleFilename) => {
    if (isLimitReached) {
      if (onOpenAuth) onOpenAuth('signup');
      return;
    }

    const content = `Quantum Mechanics Study Notes
Chapter 1: Foundational Principles

1. Wave-Particle Duality
Wave-particle duality is the fundamental postulate that all physical matter and energy exhibits properties of both waves and classical particles. Light displays wave interference patterns in the double-slit experiment, yet transfers momentum as discrete photons.

2. The Wave Function (Psi)
The wave function is a complex-valued probability amplitude describing the quantum state of an isolated physical system. The square of its absolute magnitude yields the spatial probability density for discovering a particle.

3. The Schrödinger Equation
The Schrödinger equation is the core partial differential equation that governs the continuous deterministic time evolution of a quantum mechanical wave function.

4. Heisenberg Uncertainty Principle
The uncertainty principle is the mathematical constraint stating that canonical conjugate variables, such as momentum and spatial position, cannot be simultaneously determined with arbitrary precision.

5. Quantum Entanglement
Quantum entanglement is the physical phenomenon where two or more particles become mutually correlated such that measuring the quantum state of one instantaneously determines the other regardless of distance.`;

    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], sampleFilename, { type: 'text/plain' });
    onUpload(file);
  };

  const getStageIndex = () => {
    switch (processingStage) {
      case 'reading': return 0;
      case 'ocr': return 1;
      case 'extracting':
      case 'completed': return 2;
      default: return 0;
    }
  };

  const getFileFocusType = () => {
    const fn = (processingDoc?.filename || '').toLowerCase();
    if (fn.endsWith('.pdf')) return 'pdf';
    if (fn.match(/\.(png|jpe?g|webp|gif|bmp)$/)) return 'image';
    if (fn.match(/\.(txt|md|markdown)$/)) return 'text';
    return null;
  };

  // Recent notes (latest 4)
  const recentNotes = documents.slice(0, 4);

  return (
    <div className="upload-view-wrap">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
      {/* Processing View Overlay */}
      {processingDoc && (
        <div 
          className="processing-overlay" 
          role="dialog" 
          aria-modal="true" 
          aria-labelledby="processing-heading"
        >
          <div className="processing-glass-card shadow-lg">
            {processingError ? (
              <div className="processing-error-state">
                <AlertCircle size={44} strokeWidth={1.8} className="error-icon" />
                <h3 id="processing-heading">Processing Failed</h3>
                <PaperSurface className="error-paper">
                  <p>{processingError}</p>
                </PaperSurface>

                {/* Password Prompt if password protected */}
                {processingError.toLowerCase().includes('password') && (
                  <div className="password-retry-box" style={{ width: '100%', margin: '14px 0 6px', display: 'flex', gap: 8 }}>
                    <input
                      type="password"
                      placeholder="Enter PDF password..."
                      value={retryPassword}
                      onChange={(e) => setRetryPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && retryPassword && onRetryUpload) {
                          onRetryUpload({ password: retryPassword });
                        }
                      }}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        background: 'var(--surface-2)',
                        color: 'var(--text)',
                        fontSize: '0.9rem'
                      }}
                      autoFocus
                    />
                    <Button
                      variant="primary"
                      size="md"
                      disabled={!retryPassword}
                      onClick={() => onRetryUpload && onRetryUpload({ password: retryPassword })}
                    >
                      Unlock & Retry
                    </Button>
                  </div>
                )}

                {/* Actionable buttons */}
                <div className="error-action-buttons" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginTop: 14 }}>
                  {onRetryUpload && !processingError.toLowerCase().includes('password') && (
                    <>
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => onRetryUpload({ mode: 'private' })}
                      >
                        Retry with OCR
                      </Button>
                      <Button
                        variant="outline"
                        size="md"
                        onClick={() => onRetryUpload({ mode: 'cloud' })}
                      >
                        Retry in Fast mode
                      </Button>
                    </>
                  )}
                  <Button variant="secondary" size="md" onClick={onCancelProcessing}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : (
              <div className="processing-active-state">
                {/* Pure Bookshelf Domino Motion Loader (Transparent, Animated, No Author) */}
                <div className="processing-bookshelf-anim-wrap">
                  <BookshelfLoader size="md" />
                </div>

                <h3 id="processing-heading" className="processing-title">
                  {isCompressing ? 'Optimizing document...' : 'Extracting concept hierarchy'}
                </h3>
                <p className="processing-filename">{processingDoc.filename}</p>

                {/* PREMIUM 1-100% COMPLETION LOADER */}
                <div 
                  className="ocr-progress-card" 
                  role="progressbar" 
                  aria-valuenow={Math.round(processingProgress)} 
                  aria-valuemin="1" 
                  aria-valuemax="100"
                >
                  <div className="ocr-progress-top-row">
                    <div className="ocr-progress-stage-info">
                      <span className={`ocr-stage-pill stage-${processingStage}`}>
                        {processingStage === 'ocr' ? '⚡ OCR Engine Active' :
                         processingStage === 'reading' ? '📄 Document Analysis' :
                         processingStage === 'completed' ? '✓ Complete' : '🧠 Knowledge Mining'}
                      </span>
                      {ocrPageInfo?.total > 0 && (
                        <span className="ocr-page-count-badge">
                          Page {ocrPageInfo.current || 1} of {ocrPageInfo.total}
                        </span>
                      )}
                    </div>
                    <div className="ocr-percent-display">
                      <span className="ocr-percent-number">{Math.min(100, Math.max(1, Math.round(processingProgress)))}</span>
                      <span className="ocr-percent-unit">%</span>
                    </div>
                  </div>

                  {/* Animated Progress Track & Shimmering Bar */}
                  <div className="ocr-progress-track">
                    <div 
                      className="ocr-progress-fill" 
                      style={{ width: `${Math.min(100, Math.max(3, Math.round(processingProgress)))}%` }}
                    >
                      <div className="ocr-progress-glow" />
                      <div className="ocr-progress-shimmer" />
                    </div>
                  </div>

                  {/* Live Dynamic Status Detail */}
                  <div className="ocr-progress-bottom-row">
                    <span className="ocr-live-message">
                      <Sparkles size={14} className="ocr-msg-sparkle" />
                      {processingMessage || FRIENDLY_MICROCOPY[microcopyIndex]}
                    </span>
                    <span className="ocr-eta-hint">
                      {processingProgress >= 95 ? 'Finalizing...' : 'Live processing'}
                    </span>
                  </div>
                </div>

                {/* 3-Step Stepper with Champagne Gold connecting line */}
                <div className="processing-stepper-wrap">
                  <Stepper 
                    steps={PROCESSING_STEPS} 
                    currentStepIndex={getStageIndex()} 
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Workspace Greeting Header */}
      <div className="workspace-greeting-wrap">
        <h1 className="workspace-greeting-title">
          What are we studying today?
        </h1>
        <p className="workspace-greeting-sub">
          Drop your lecture notes, PDFs, or handwritten scans below to extract a structured concept tree.
        </p>
        {!user && guestStatus && (
          <div className="guest-quota-badge-wrap" style={{ marginTop: '12px' }}>
            <span className="guest-quota-pill" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 14px',
              borderRadius: '999px',
              background: 'var(--surface-2, rgba(255, 255, 255, 0.08))',
              border: '1px solid var(--border, rgba(255, 255, 255, 0.12))',
              fontSize: '0.82rem',
              color: 'var(--text-muted, #8E929E)',
              fontWeight: 500
            }}>
              Guest: {guestStatus.uploads_count || 0} of {guestStatus.upload_limit || 5} uploads used
            </span>
          </div>
        )}
      </div>

      {/* Premium Dropzone: Solid white card with 1px border, soft inner gradient, rotating conic border on drag-over */}
      <div
        className={`premium-dropzone ${isDragActive ? 'drag-active' : ''} ${isLimitReached ? 'limit-reached' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => {
          if (isLimitReached) {
            if (onOpenAuth) onOpenAuth('signup');
          } else {
            fileInputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload document drop zone"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <div className="dropzone-animated-icon">
          <svg
            className="basketball-hoop-illustration"
            viewBox="0 0 64 64"
            fill="none"
            aria-hidden="true"
          >
            <path className="basketball-rim" d="M20 30c0-3 5.4-5.5 12-5.5s12 2.5 12 5.5-5.4 5.5-12 5.5S20 33 20 30Z" />
            <g className="basketball-net">
              <path d="M21 31 25 48 32 53 39 48 43 31" />
              <path d="m24 37 16 1M25.5 43l13 1M28 49l8 0" />
              <path d="m25 33 4 17M32 35v17M39 33l-4 17" />
            </g>
            <path className="basketball-rim-highlight" d="M22 29c2.1-1.9 6-3 10-3s7.9 1.1 10 3" />
          </svg>
        </div>

        <h2 className="dropzone-main-text">
          {isDragActive ? 'Release to upload your notes' : 'Drop your notes here'}
        </h2>

        <p className="dropzone-format-hint">
          PDF, PNG, JPG, WEBP, TXT, MD up to 10 MB
        </p>

        <div className="dropzone-actions-row" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="primary"
            size="md"
            icon={Upload}
            onClick={() => {
              if (isLimitReached) {
                if (onOpenAuth) onOpenAuth('signup');
              } else {
                fileInputRef.current?.click();
              }
            }}
          >
            Browse files
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={Camera}
            onClick={handleOpenCamera}
          >
            Take photo
          </Button>
        </div>

        {/* EXTRACTOR-CHOICE-START */}
        {ExtractorPicker && (
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <ExtractorPicker
              documents={documents}
              isUploading={isUploading}
              onChange={(method) => {
                if (typeof window !== 'undefined') {
                  window.__conceptlens_extractor = method;
                }
              }}
            />
          </div>
        )}
        {/* EXTRACTOR-CHOICE-END */}
      </div>

      {isCameraOpen && (
        <div className="camera-capture-backdrop" role="presentation">
          <section
            className="camera-capture-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="camera-capture-title"
          >
            <div className="camera-capture-header">
              <div>
                <span className="camera-capture-eyebrow">DOCUMENT SCANNER</span>
                <h2 id="camera-capture-title">Take a photo</h2>
              </div>
              <button
                type="button"
                className="camera-capture-close"
                onClick={stopCamera}
                aria-label="Close camera"
              >
                ×
              </button>
            </div>

            {cameraError ? (
              <div className="camera-capture-error" role="alert">{cameraError}</div>
            ) : (
              <div className="camera-preview-frame">
                {isCameraLoading && <div className="camera-preview-status">Opening your camera…</div>}
                <video
                  ref={cameraVideoRef}
                  className="camera-preview-video"
                  autoPlay
                  muted
                  playsInline
                  onLoadedMetadata={() => setIsCameraReady(true)}
                />
              </div>
            )}

            <div className="camera-capture-actions">
              <Button variant="secondary" onClick={stopCamera}>Cancel</Button>
              {!cameraError && (
                <Button
                  variant="primary"
                  icon={Camera}
                  onClick={handleCapturePhoto}
                  disabled={isCameraLoading || !isCameraReady}
                >
                  Capture photo
                </Button>
              )}
              {cameraError && (
                <Button variant="primary" icon={Camera} onClick={handleOpenCamera}>
                  Try again
                </Button>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Sample notes buttons (Clean, elegant, NO stray dots!) */}
      <div className="samples-clean-bar">
        <span className="samples-tag-label">Or explore a sample:</span>
        <div className="samples-tags-wrap">
          <button
            type="button"
            className="sample-pill-btn"
            onClick={() => loadSample('quantum_mechanics.txt')}
          >
            Quantum Mechanics
          </button>
          <button
            type="button"
            className="sample-pill-btn"
            onClick={() => loadSample('cell_biology.txt')}
          >
            Cell Biology
          </button>
          <button
            type="button"
            className="sample-pill-btn"
            onClick={() => loadSample('neural_networks.txt')}
          >
            Neural Networks
          </button>
        </div>
      </div>

      {/* Recent Notes Grid (when notes exist) */}
      {recentNotes.length > 0 && (
        <div className="recent-notes-section">
          <div className="recent-notes-header">
            <div className="recent-notes-title">
              <Clock size={16} strokeWidth={1.8} />
              <span>Recent notes</span>
            </div>
            <span className="recent-notes-count">{documents.length} total</span>
          </div>

          <div className="recent-notes-grid">
            {recentNotes.map((doc) => (
              <div
                key={doc.id}
                className="recent-note-card shadow-sm"
                onClick={() => onSelectDoc && onSelectDoc(doc.id)}
                role="button"
                tabIndex={0}
              >
                <div className="recent-card-top">
                  <div className="recent-card-icon-wrap">
                    <FileText size={18} strokeWidth={1.8} />
                  </div>
                  <span className="recent-card-badge">
                    <Layers size={12} strokeWidth={1.8} />
                    <span>{doc.concept_count || 0}</span>
                  </span>
                </div>

                <div className="recent-card-title" title={doc.filename}>
                  {doc.filename}
                </div>

                <div className="recent-card-footer">
                  <span className="recent-card-date">
                    {new Date(doc.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  <span className="recent-card-action">
                    Open <ArrowRight size={13} strokeWidth={2} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
