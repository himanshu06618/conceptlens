import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Camera, 
  FileText, 
  RotateCcw, 
  X, 
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { compressImageIfNeeded } from '../../utils/imageCompressor';
import { BookshelfLoader } from '../ui';

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md';
const ALLOWED_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md'];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * CompactUploadCard — "Flux" Health-Dashboard Inspired Quick Dropzone
 * LIME card (#D7F25C) with dashed dropzone:
 * - "Browse files" (black button)
 * - "Take photo" (white button)
 * - Camera capture + client-side photo optimization preserved.
 */
export default function CompactUploadCard({
  onUpload,
  isUploading = false,
  processingDoc = null,
  processingStage = 'reading',
  processingProgress = 5,
  processingMessage = '',
  processingError = null,
  onRetryUpload,
  onCancelProcessing,
  onToast = () => {}
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [retryPassword, setRetryPassword] = useState('');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  const inFlightRef = useRef(false);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploading || inFlightRef.current) return;
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
    if (isUploading || inFlightRef.current) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndProcess(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (isUploading || inFlightRef.current) return;
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      e.target.value = '';
      validateAndProcess(selected);
    }
  };

  const validateAndProcess = async (file) => {
    if (isUploading || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!ALLOWED_EXTS.includes(ext)) {
        onToast({
          type: 'error',
          message: `Unsupported file format '.${ext}'. Allowed: PDF, PNG, JPG, JPEG, WEBP, TXT, MD.`
        });
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
        onToast({
          type: 'error',
          message: `File size (${sizeMb} MB) exceeds maximum allowed limit of ${MAX_FILE_SIZE_MB} MB.`
        });
        return;
      }

      if (file.type.startsWith('image/')) {
        setIsCompressing(true);
        try {
          const compressed = await compressImageIfNeeded(file);
          await onUpload(compressed);
        } catch (err) {
          console.warn('Image compression fallback:', err);
          await onUpload(file);
        } finally {
          setIsCompressing(false);
        }
      } else {
        await onUpload(file);
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  // Processing state view
  if (isUploading || processingDoc) {
    return (
      <div className="flux-card flux-card-lime compact-upload-card is-processing">
        <div className="compact-processing-content">
          <div className="compact-processing-header">
            <div className="compact-processing-icon-wrap">
              <BookshelfLoader size="sm" />
            </div>
            <div className="compact-processing-text">
              <strong className="compact-processing-filename">
                {processingDoc?.filename || 'Analyzing notes...'}
              </strong>
              <span className="compact-processing-status">
                {processingMessage || `Processing: ${processingStage}...`}
              </span>
            </div>
            {onCancelProcessing && (
              <button
                type="button"
                className="compact-processing-cancel-btn"
                onClick={onCancelProcessing}
                title="Cancel upload"
                aria-label="Cancel upload"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="compact-processing-progress-bar">
            <div
              className="compact-processing-progress-fill"
              style={{ width: `${Math.min(100, Math.max(5, processingProgress))}%` }}
            />
          </div>

          {processingError && (
            <div className="compact-processing-error">
              <div className="compact-error-msg">
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{processingError}</span>
              </div>
              {processingError.includes('password') ? (
                <div className="compact-password-retry">
                  <input
                    type="password"
                    placeholder="PDF password..."
                    value={retryPassword}
                    onChange={(e) => setRetryPassword(e.target.value)}
                    className="compact-password-input"
                  />
                  <button
                    type="button"
                    className="flux-btn btn-dark btn-sm"
                    onClick={() => onRetryUpload && onRetryUpload({ password: retryPassword })}
                  >
                    Retry
                  </button>
                </div>
              ) : (
                onRetryUpload && (
                  <button
                    type="button"
                    className="flux-btn btn-dark btn-sm"
                    onClick={() => onRetryUpload()}
                  >
                    <RotateCcw size={14} />
                    <span>Try Again</span>
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flux-card flux-card-lime compact-upload-card ${isDragActive ? 'is-drag-active' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      <div className="compact-upload-inner">
        <div className="compact-upload-header-row">
          <div className="compact-upload-title-group">
            <div className="compact-upload-icon-chip" aria-hidden="true">
              <Upload size={18} strokeWidth={2.4} />
            </div>
            <div>
              <h3 className="compact-upload-title">Drop your notes here</h3>
              <p className="compact-upload-subtitle">PDF, camera photos, textbook pages & markdown</p>
            </div>
          </div>
          <span className="compact-upload-badge">Fast OCR</span>
        </div>

        {/* Dashed Dropzone */}
        <div className="compact-upload-dashed-dropzone" onClick={() => fileInputRef.current?.click()}>
          <div className="compact-dropzone-icon">
            <FileText size={28} strokeWidth={1.8} />
          </div>
          <p className="compact-dropzone-prompt">
            Drag & drop course notes here, or choose an action
          </p>

          <div className="compact-upload-actions" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="flux-btn btn-dark compact-browse-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={15} />
              <span>Browse files</span>
            </button>

            <button
              type="button"
              className="flux-btn btn-outline compact-camera-btn"
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera size={15} />
              <span>Take photo</span>
            </button>
          </div>
        </div>

        {/* Hidden Native File Inputs */}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        <div className="compact-upload-footer-hint">
          <span>Max 10 MB per file</span>
          <span>•</span>
          <span>Auto-compressed on device</span>
        </div>
      </div>
    </div>
  );
}
