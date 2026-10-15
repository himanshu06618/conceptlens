import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  FileText,
  AlertTriangle,
  Lock,
  Quote,
  X,
  Search,
  Upload,
  RefreshCw,
  CheckCircle2
} from 'lucide-react';

import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { getLocalFile, saveLocalFile } from '../utils/fileStore';
import { fetchDocumentFileUrl, downloadDocumentBlob, reattachDocumentFile, getDocument } from '../api/client';
import '../styles/viewer.css';

// Configure local worker (no external CDN)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export default function DocumentViewer({ onToast }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const docId = searchParams.get('doc');
  const initialPage = parseInt(searchParams.get('page') || '1', 10);
  const initialQuery = searchParams.get('q') || '';

  const [documentMetadata, setDocumentMetadata] = useState(null);
  const [fileBlob, setFileBlob] = useState(null);
  const [fileType, setFileType] = useState('pdf'); // 'pdf' | 'image' | 'text'
  const [textPreview, setTextPreview] = useState('');
  const [imagePreviewUrl, setImagePreviewUrl] = useState('');

  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoomScale, setZoomScale] = useState(1.0);
  const [fitMode, setFitMode] = useState('width'); // 'width' | 'custom'

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [highlightQuote, setHighlightQuote] = useState(initialQuery);
  const [showQuoteBanner, setShowQuoteBanner] = useState(Boolean(initialQuery));

  const [loading, setLoading] = useState(true);
  const [loadingMessage, setLoadingMessage] = useState('Loading document...');
  const [error, setError] = useState(null);
  const [needsFileReattach, setNeedsFileReattach] = useState(false);

  const [isPasswordProtected, setIsPasswordProtected] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isReattaching, setIsReattaching] = useState(false);

  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);
  const fileInputRef = useRef(null);
  const viewportRef = useRef(null);

  // 1. Load document metadata & file
  useEffect(() => {
    if (!docId) {
      setError('No document ID specified.');
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadDocumentAndFile() {
      try {
        setLoading(true);
        setLoadingMessage('Resolving document file...');

        // Fetch document metadata
        let docMeta = null;
        try {
          docMeta = await getDocument(docId);
          if (isMounted) setDocumentMetadata(docMeta);
        } catch (e) {
          console.warn('Could not load document metadata from API:', e);
        }

        const filename = docMeta?.filename || 'document.pdf';
        const ext = filename.split('.').pop()?.toLowerCase();

        // 1. Try local IndexedDB file store
        let localBlob = await getLocalFile(docId);

        if (!localBlob) {
          try {
            const fileInfo = await fetchDocumentFileUrl(docId);
            if (fileInfo?.url) {
              setLoadingMessage('Fetching document file from storage...');
              localBlob = await downloadDocumentBlob(fileInfo.url);
              if (localBlob) {
                // Cache into IndexedDB for fast subsequent renders
                await saveLocalFile(docId, localBlob, filename);
              }
            }
          } catch (urlErr) {
            console.info('Remote file URL resolution:', urlErr);
          }
        }

        if (!localBlob) {
          if (isMounted) {
            setNeedsFileReattach(true);
            setLoading(false);
          }
          return;
        }

        if (!isMounted) return;
        setFileBlob(localBlob);

        // Classify file type
        if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          setFileType('image');
          const imgUrl = URL.createObjectURL(localBlob);
          setImagePreviewUrl(imgUrl);
          setLoading(false);
        } else if (['txt', 'md'].includes(ext)) {
          setFileType('text');
          const txt = await localBlob.text();
          setTextPreview(txt);
          setLoading(false);
        } else {
          // Default to PDF
          setFileType('pdf');
          await initPdf(localBlob);
        }
      } catch (err) {
        console.error('Document loader error:', err);
        if (isMounted) {
          setError(err.message || 'Failed to load document file.');
          setLoading(false);
        }
      }
    }

    loadDocumentAndFile();

    return () => {
      isMounted = false;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
      }
    };
  }, [docId]);

  // Initialize PDF.js document from blob
  const initPdf = async (blob, password = '') => {
    try {
      setLoading(true);
      setLoadingMessage('Rendering PDF pages...');
      const arrayBuffer = await blob.arrayBuffer();

      const loadingTask = pdfjsLib.getDocument({
        data: arrayBuffer,
        password: password || undefined,
        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true,
      });

      loadingTask.onPassword = (updatePassword, reason) => {
        setIsPasswordProtected(true);
        setLoading(false);
      };

      const doc = await loadingTask.promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      setIsPasswordProtected(false);
      setLoading(false);

      // Clamp initial page
      const validPage = Math.max(1, Math.min(doc.numPages, initialPage || 1));
      setCurrentPage(validPage);
    } catch (pdfErr) {
      console.error('PDF parsing error:', pdfErr);
      if (pdfErr.name === 'PasswordException') {
        setIsPasswordProtected(true);
      } else {
        setError('This PDF appears to be corrupted or cannot be parsed.');
      }
      setLoading(false);
    }
  };

  // Render current PDF page onto canvas
  const renderPdfPage = useCallback(async () => {
    if (!pdfDoc || !canvasRef.current || fileType !== 'pdf') return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }

    try {
      const page = await pdfDoc.getPage(currentPage);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');

      const dpr = window.devicePixelRatio || 1;
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      // Determine scale based on fitMode or zoomScale
      let finalScale = zoomScale;
      if (fitMode === 'width' && viewportRef.current) {
        const containerWidth = viewportRef.current.clientWidth - 48;
        if (containerWidth > 200) {
          finalScale = containerWidth / unscaledViewport.width;
        }
      }

      const viewport = page.getViewport({ scale: finalScale * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      const task = page.render(renderContext);
      renderTaskRef.current = task;
      await task.promise;
    } catch (err) {
      if (err.name !== 'RenderingCancelledException') {
        console.error('Page render error:', err);
      }
    }
  }, [pdfDoc, currentPage, zoomScale, fitMode, fileType]);

  useEffect(() => {
    renderPdfPage();
  }, [renderPdfPage]);

  // Page change handlers
  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
    }
  };

  const handlePageInputChange = (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setCurrentPage(val);
    }
  };

  // Zoom handlers
  const handleZoomIn = () => {
    setFitMode('custom');
    setZoomScale(prev => Math.min(3.0, prev + 0.25));
  };

  const handleZoomOut = () => {
    setFitMode('custom');
    setZoomScale(prev => Math.max(0.5, prev - 0.25));
  };

  const handleFitWidth = () => {
    setFitMode('width');
    renderPdfPage();
  };

  // Download original file
  const handleDownload = () => {
    if (!fileBlob) return;
    const url = URL.createObjectURL(fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = documentMetadata?.filename || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Re-attach file handler
  const handleReattachFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsReattaching(true);
      if (onToast) onToast('Verifying and attaching file...', 'info');

      // Verify and upload to backend (which runs locator backfill)
      const res = await reattachDocumentFile(docId, file);
      // Save locally to IndexedDB
      await saveLocalFile(docId, file, file.name);

      setFileBlob(file);
      setNeedsFileReattach(false);
      setError(null);

      if (onToast) {
        onToast(`File verified successfully (${res.concepts_verified || 0} pages matched).`, 'success');
      }

      // Re-init PDF
      await initPdf(file);
    } catch (err) {
      console.error('Re-attach error:', err);
      if (onToast) {
        onToast(err.message || 'File verification failed. Please ensure it is the original file.', 'error');
      }
    } finally {
      setIsReattaching(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        handlePrevPage();
      } else if (e.key === 'ArrowRight') {
        handleNextPage();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPage, totalPages]);

  return (
    <div className="document-viewer-container" role="main" aria-label="Document Viewer">
      {/* Top Toolbar */}
      <header className="viewer-toolbar">
        <div className="viewer-toolbar-left">
          <button
            type="button"
            className="viewer-back-btn"
            onClick={() => navigate(-1)}
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>

          <div className="viewer-doc-title-group">
            <span className="viewer-doc-title">
              {documentMetadata?.filename || 'Document Viewer'}
            </span>
            <span className="viewer-file-badge">{fileType}</span>
          </div>
        </div>

        {fileType === 'pdf' && (
          <div className="viewer-toolbar-center">
            {/* Page navigation */}
            <div className="viewer-page-controls">
              <button
                type="button"
                className="viewer-page-btn"
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={18} />
              </button>

              <input
                type="text"
                className="viewer-page-input"
                value={currentPage}
                onChange={handlePageInputChange}
                aria-label="Page number"
              />
              <span className="viewer-page-total">/ {totalPages}</span>

              <button
                type="button"
                className="viewer-page-btn"
                onClick={handleNextPage}
                disabled={currentPage >= totalPages}
                aria-label="Next page"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Zoom controls */}
            <div className="viewer-zoom-controls">
              <button
                type="button"
                className="viewer-zoom-btn"
                onClick={handleZoomOut}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut size={16} />
              </button>

              <span className="viewer-zoom-label">
                {Math.round(zoomScale * 100)}%
              </span>

              <button
                type="button"
                className="viewer-zoom-btn"
                onClick={handleZoomIn}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn size={16} />
              </button>

              <button
                type="button"
                className="viewer-fit-btn"
                onClick={handleFitWidth}
                title="Fit to width"
              >
                <Maximize2 size={13} />
                <span>Fit</span>
              </button>
            </div>
          </div>
        )}

        <div className="viewer-toolbar-right">
          {/* Search bar */}
          <div className="viewer-search-box">
            <Search size={14} className="text-muted" />
            <input
              type="text"
              className="viewer-search-input"
              placeholder="Highlight text..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Action buttons */}
          <button
            type="button"
            className="viewer-action-btn"
            onClick={handleDownload}
            disabled={!fileBlob}
            title="Download document file"
          >
            <Download size={15} />
            <span>Download</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleReattachFile}
          />
          <button
            type="button"
            className="viewer-action-btn"
            onClick={() => fileInputRef.current?.click()}
            title="Re-attach original file"
          >
            <Upload size={15} />
            <span>Attach File</span>
          </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="viewer-viewport" ref={viewportRef}>
        {loading && (
          <div className="viewer-center-card">
            <div className="viewer-card-icon">
              <RefreshCw size={24} className="spin-slow" />
            </div>
            <h3 className="viewer-card-title">{loadingMessage}</h3>
            <p className="viewer-card-desc">Preparing pages and text layer...</p>
          </div>
        )}

        {!loading && needsFileReattach && (
          <div className="viewer-center-card">
            <div className="viewer-card-icon">
              <FileText size={26} />
            </div>
            <h3 className="viewer-card-title">Original File Not on This Device</h3>
            <p className="viewer-card-desc">
              To view source pages with exact highlights, re-attach the original file (
              <strong>{documentMetadata?.filename || 'document.pdf'}</strong>).
              Your file remains private and local.
            </p>
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleReattachFile}
            />
            <button
              type="button"
              className="viewer-card-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReattaching}
            >
              <Upload size={16} />
              <span>{isReattaching ? 'Verifying...' : 'Select Original File'}</span>
            </button>
          </div>
        )}

        {!loading && isPasswordProtected && (
          <div className="viewer-center-card">
            <div className="viewer-card-icon">
              <Lock size={26} />
            </div>
            <h3 className="viewer-card-title">Password Protected PDF</h3>
            <p className="viewer-card-desc">
              Please enter the password to decrypt and view this document.
            </p>
            <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
              <input
                type="password"
                className="viewer-page-input"
                style={{ flex: 1, textAlign: 'left', padding: '8px 12px' }}
                placeholder="Enter PDF password..."
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') initPdf(fileBlob, passwordInput);
                }}
              />
              <button
                type="button"
                className="viewer-card-btn"
                onClick={() => initPdf(fileBlob, passwordInput)}
              >
                Unlock
              </button>
            </div>
          </div>
        )}

        {!loading && error && !needsFileReattach && !isPasswordProtected && (
          <div className="viewer-center-card">
            <div className="viewer-card-icon is-error">
              <AlertTriangle size={26} />
            </div>
            <h3 className="viewer-card-title">Unable to Render Document</h3>
            <p className="viewer-card-desc">{error}</p>
            <button
              type="button"
              className="viewer-card-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={16} />
              <span>Re-upload File</span>
            </button>
          </div>
        )}

        {/* PDF Render Stage */}
        {!loading && !error && !needsFileReattach && fileType === 'pdf' && (
          <div className="viewer-page-stage">
            <canvas ref={canvasRef} className="viewer-canvas" />
          </div>
        )}

        {/* Image Render Stage */}
        {!loading && !error && !needsFileReattach && fileType === 'image' && (
          <div className="viewer-page-stage" style={{ maxWidth: '90%' }}>
            <img
              src={imagePreviewUrl}
              alt={documentMetadata?.filename || 'Document Image'}
              style={{ width: '100%', height: 'auto', display: 'block' }}
            />
          </div>
        )}

        {/* Plain Text Render Stage */}
        {!loading && !error && !needsFileReattach && fileType === 'text' && (
          <div
            className="viewer-page-stage"
            style={{
              maxWidth: '800px',
              width: '100%',
              padding: '24px 32px',
              color: '#111827',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              fontSize: '0.95rem'
            }}
          >
            {textPreview}
          </div>
        )}
      </main>

      {/* Floating Quote Banner */}
      {showQuoteBanner && highlightQuote && (
        <div className="viewer-quote-banner" role="complementary" aria-label="Referenced excerpt">
          <Quote size={18} className="quote-icon" />
          <div className="quote-content">
            <div className="quote-title">Source Excerpt (Page {currentPage})</div>
            <p className="quote-text">"{highlightQuote}"</p>
          </div>
          <button
            type="button"
            className="viewer-quote-close"
            onClick={() => setShowQuoteBanner(false)}
            aria-label="Dismiss excerpt banner"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
