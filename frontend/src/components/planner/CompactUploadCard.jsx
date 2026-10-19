import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Camera, 
  X, 
  RotateCcw,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { compressImageIfNeeded } from '../../utils/imageCompressor';

const ACCEPTED_TYPES = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md';
const ALLOWED_EXTS = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md'];
const MAX_FILE_SIZE_MB = 10;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const CompactUploadCard = React.forwardRef(function CompactUploadCard({
  onUpload,
  isUploading = false,
  processingDoc = null,
  processingStage = 'reading',
  processingProgress = 5,
  processingMessage = '',
  processingError = null,
  onRetryUpload,
  onCancelProcessing,
  onToast = () => {},
  emphasis = false,
  onClose = null
}, ref) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [retryPassword, setRetryPassword] = useState('');
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const inFlightRef = useRef(false);

  React.useImperativeHandle(ref, () => ({
    openFilePicker: () => fileInputRef.current?.click(),
    openCamera: () => cameraInputRef.current?.click()
  }));

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

  return (
    <div
      className={`card card--lime flux-drop-card ${emphasis ? 'card--emphasis' : ''}`}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      role="region"
      aria-label="Upload Course Notes"
      style={{ position: 'relative' }}
    >
      {onClose && !isUploading && !processingDoc && (
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: 'rgba(17, 17, 19, 0.08)',
            border: 'none',
            color: '#111113',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 3
          }}
          title="Close upload card"
          aria-label="Close upload card"
        >
          <X size={16} />
        </button>
      )}
      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Hidden camera capture input */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Left Column: Title, Description, Icon, Badges */}
      <div className="flux-drop-card-left">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div className="flux-drop-card-chip" aria-hidden="true">
            <Upload size={26} strokeWidth={2.4} />
          </div>
          <h2 className="flux-drop-card-title">
            Drop your notes here
          </h2>
          <p className="flux-drop-card-desc">
            PDF, camera photos, textbook pages & markdown. Fast OCR extracts every concept for you.
          </p>
        </div>

        <div className="flux-drop-card-badges">
          <span className="flux-drop-badge">Max 10 MB per file</span>
          <span className="flux-drop-badge">Auto-compressed on device</span>
        </div>
      </div>

      {/* Right Column: Interactive Dropzone Box */}
      <div className="flux-drop-card-right">
        <div
          className={`flux-dropzone-box ${isDragActive ? 'drag-active' : ''}`}
          onClick={() => {
            if (!isUploading) fileInputRef.current?.click();
          }}
          tabIndex={0}
          role="button"
          aria-label="Select files to upload"
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {isUploading || processingDoc ? (
            /* Uploading / Processing In-Dropzone View */
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: '#FFFFFF',
                  color: '#111113',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.08)'
                }}
              >
                <Upload size={22} className="spin-slow" />
              </div>

              <strong
                style={{
                  fontSize: '15px',
                  color: '#111113',
                  fontWeight: 700,
                  maxWidth: '320px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {processingDoc?.filename || (isCompressing ? 'Compressing on device...' : 'Analyzing notes...')}
              </strong>

              <span style={{ fontSize: '13px', color: 'rgba(17, 17, 19, 0.75)', fontWeight: 500 }}>
                {processingMessage || `Processing: ${processingStage}...`}
              </span>

              <div
                style={{
                  width: '85%',
                  maxWidth: '320px',
                  height: '8px',
                  background: 'rgba(17, 17, 19, 0.15)',
                  borderRadius: '999px',
                  overflow: 'hidden',
                  marginTop: '4px'
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, Math.max(8, processingProgress))}%`,
                    height: '100%',
                    background: '#111113',
                    borderRadius: '999px',
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>

              {onCancelProcessing && (
                <button
                  type="button"
                  onClick={onCancelProcessing}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(17, 17, 19, 0.7)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 8px',
                    marginTop: '2px',
                    textDecoration: 'underline'
                  }}
                >
                  Cancel upload
                </button>
              )}
            </div>
          ) : processingError ? (
            /* Error State Inside Dropzone */
            <div
              style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'rgba(239, 68, 68, 0.16)',
                  color: '#991B1B',
                  borderRadius: '9999px',
                  padding: '8px 18px',
                  fontSize: '12px',
                  fontWeight: 600,
                  maxWidth: '90%',
                  textAlign: 'center'
                }}
              >
                <AlertCircle size={15} color="#DC2626" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {processingError}
                </span>
              </div>

              {processingError.toLowerCase().includes('password') && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                  <input
                    type="password"
                    placeholder="PDF password..."
                    value={retryPassword}
                    onChange={(e) => setRetryPassword(e.target.value)}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      border: '1px solid rgba(17,17,19,0.2)',
                      background: '#FFFFFF',
                      fontSize: '13px'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => onRetryUpload?.({ password: retryPassword })}
                    className="pill pill--dark"
                    style={{ padding: '8px 14px', fontSize: '12px' }}
                  >
                    Unlock
                  </button>
                </div>
              )}

              {onRetryUpload && !processingError.toLowerCase().includes('password') && (
                <button
                  type="button"
                  onClick={() => onRetryUpload()}
                  className="pill pill--dark"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 18px',
                    fontSize: '12px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '4px'
                  }}
                >
                  <RotateCcw size={13} />
                  <span>Retry Upload</span>
                </button>
              )}
            </div>
          ) : (
            /* Normal Initial Dropzone View */
            <>
              <div className="flux-dropzone-circle" aria-hidden="true">
                <Upload size={22} strokeWidth={2.4} />
              </div>

              <p className="flux-dropzone-primary-text">
                Drag & drop course notes here
              </p>
              <span className="flux-dropzone-sub-text">
                or choose an action below
              </span>

              <div
                className="flux-dropzone-btn-row"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="flux-browse-pill-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={16} strokeWidth={2.4} />
                  <span>Browse files</span>
                </button>

                <button
                  type="button"
                  className="flux-camera-pill-btn"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera size={16} strokeWidth={2.4} />
                  <span>Take photo</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
});

export default CompactUploadCard;
