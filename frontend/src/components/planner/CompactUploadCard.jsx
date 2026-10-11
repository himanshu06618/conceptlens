import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Camera, 
  AlertCircle, 
  CheckCircle,
  FileText,
  RotateCcw,
  X,
  Sparkles
} from 'lucide-react';
import { compressImageIfNeeded } from '../../utils/imageCompressor';
import { BookshelfLoader } from '../ui';

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md';
const ALLOWED_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md'];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

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

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isUploading) return;
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
    if (isUploading) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndProcess(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      validateAndProcess(e.target.files[0]);
      e.target.value = '';
    }
  };

  const validateAndProcess = async (file) => {
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

  const handleOpenFilePicker = (e) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleOpenCamera = (e) => {
    e.stopPropagation();
    // On mobile, capture="environment" immediately opens rear camera.
    // On desktop, opens file selector configured for image capture.
    cameraInputRef.current?.click();
  };

  return (
    <section 
      className={`compact-upload-card ${isDragActive ? 'drag-active' : ''} ${isUploading ? 'is-processing' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      aria-label="Upload notes drop card"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        aria-hidden="true"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileSelect}
        aria-hidden="true"
      />

      {/* Progress / Processing State */}
      {processingDoc || isUploading ? (
        <div className="compact-upload-processing">
          {processingError ? (
            <div className="compact-upload-error-state">
              <div className="compact-error-leading">
                <AlertCircle size={28} className="compact-error-icon" />
              </div>
              <div className="compact-error-body">
                <div className="compact-error-title">Processing failed</div>
                <div className="compact-error-msg">{processingError}</div>
                {processingError.toLowerCase().includes('password') && (
                  <div className="compact-password-retry-row">
                    <input
                      type="password"
                      placeholder="Enter PDF password..."
                      value={retryPassword}
                      onChange={(e) => setRetryPassword(e.target.value)}
                      className="compact-password-input"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && retryPassword && onRetryUpload) {
                          onRetryUpload({ password: retryPassword });
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      className="compact-btn compact-btn-primary"
                      disabled={!retryPassword}
                      onClick={() => onRetryUpload && onRetryUpload({ password: retryPassword })}
                    >
                      Unlock & Retry
                    </button>
                  </div>
                )}
              </div>
              <div className="compact-error-actions">
                {onRetryUpload && !processingError.toLowerCase().includes('password') && (
                  <button
                    type="button"
                    className="compact-btn compact-btn-primary"
                    onClick={() => onRetryUpload()}
                    title="Retry extraction"
                  >
                    <RotateCcw size={15} />
                    <span>Retry</span>
                  </button>
                )}
                {onCancelProcessing && (
                  <button
                    type="button"
                    className="compact-btn compact-btn-secondary"
                    onClick={onCancelProcessing}
                    title="Dismiss"
                  >
                    <X size={15} />
                    <span>Dismiss</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="compact-upload-active-progress">
              <div className="compact-progress-anim">
                <BookshelfLoader size="sm" />
              </div>
              <div className="compact-progress-info">
                <div className="compact-progress-filename-row">
                  <span className="compact-progress-filename" title={processingDoc?.filename}>
                    {processingDoc?.filename || 'Analyzing document...'}
                  </span>
                  <span className="compact-progress-pct">{Math.round(processingProgress)}%</span>
                </div>
                <div className="compact-progress-bar-wrap">
                  <div 
                    className="compact-progress-bar-fill" 
                    style={{ width: `${Math.min(100, Math.max(5, processingProgress))}%` }} 
                  />
                </div>
                <div className="compact-progress-status-msg">
                  {isCompressing ? 'Optimizing photo...' : (processingMessage || 'Extracting concepts and chapter relations...')}
                </div>
              </div>
              {onCancelProcessing && (
                <button
                  type="button"
                  className="compact-cancel-btn"
                  onClick={onCancelProcessing}
                  title="Cancel upload"
                  aria-label="Cancel upload"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Default Drop Card State: Compact (140-200px), short, interactive */
        <div 
          className="compact-upload-content"
          onClick={handleOpenFilePicker}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleOpenFilePicker(e);
            }
          }}
        >
          <div className="compact-upload-icon-wrap" aria-hidden="true">
            <Upload size={22} className="compact-upload-icon" />
          </div>

          <div className="compact-upload-text-group">
            <h2 className="compact-upload-title">
              {isDragActive ? 'Release to upload your notes' : 'Drop your notes here'}
            </h2>
            <p className="compact-upload-hint">
              PDF, PNG, JPG, WEBP, TXT, MD up to 10 MB
            </p>
          </div>

          <div className="compact-upload-buttons-row" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="compact-btn compact-btn-primary"
              onClick={handleOpenFilePicker}
              aria-label="Browse files to upload"
            >
              <Upload size={16} strokeWidth={2} />
              <span>Browse files</span>
            </button>

            <button
              type="button"
              className="compact-btn compact-btn-secondary"
              onClick={handleOpenCamera}
              aria-label="Take photo with camera"
            >
              <Camera size={16} strokeWidth={2} />
              <span>Take photo</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
