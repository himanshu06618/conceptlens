import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Camera, 
  X, 
  RotateCcw,
  CheckCircle2
} from 'lucide-react';
import { compressImageIfNeeded } from '../../utils/imageCompressor';

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

  return (
    <div
      className="card card--lime"
      style={{
        borderRadius: '24px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        overflow: 'hidden',
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
        justifyContent: 'space-between'
      }}
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
    >
      {/* 1. Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            minWidth: '48px',
            minHeight: '48px',
            borderRadius: '14px',
            backgroundColor: '#1B1B1D',
            color: '#D7F25C',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
          aria-hidden="true"
        >
          <Upload size={22} strokeWidth={2.4} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
          <h3 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: '#111113', lineHeight: 1.2 }}>
            Drop your notes here
          </h3>
          <p style={{ fontSize: '12px', color: 'rgba(17, 17, 19, 0.75)', margin: 0, lineHeight: 1.35 }}>
            PDF, camera photos, textbook pages & markdown · Fast OCR
          </p>
        </div>
      </div>

      {/* 2. Dashed Dropzone */}
      <div
        style={{
          border: isDragActive ? '2px dashed #111113' : '2px dashed rgba(17, 17, 19, 0.35)',
          borderRadius: '20px',
          minHeight: '170px',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '20px 16px',
          background: isDragActive ? 'rgba(255, 255, 255, 0.28)' : 'transparent',
          transition: 'all 0.2s ease',
          cursor: isUploading ? 'default' : 'pointer',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}
        onClick={() => {
          if (!isUploading) fileInputRef.current?.click();
        }}
      >
        {isUploading || processingDoc ? (
          /* Uploading / Processing In-Dropzone View */
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }} onClick={(e) => e.stopPropagation()}>
            <strong style={{ fontSize: '15px', color: '#111113', fontWeight: 700, maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {processingDoc?.filename || (isCompressing ? 'Compressing on device...' : 'Analyzing notes...')}
            </strong>
            <span style={{ fontSize: '13px', color: 'rgba(17, 17, 19, 0.75)', fontWeight: 500 }}>
              {processingMessage || `Processing: ${processingStage}...`}
            </span>
            <div style={{ width: '85%', height: '8px', background: 'rgba(17, 17, 19, 0.15)', borderRadius: '999px', overflow: 'hidden', marginTop: '4px' }}>
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
                  color: 'rgba(17, 17, 19, 0.65)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: '4px 8px',
                  marginTop: '4px'
                }}
              >
                Cancel upload
              </button>
            )}
          </div>
        ) : (
          /* Normal Dropzone View */
          <>
            <p style={{ fontSize: '14px', fontWeight: 600, color: '#111113', margin: 0, maxWidth: '300px', lineHeight: 1.4 }}>
              Drag & drop course notes here, or choose an action
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                width: '100%'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="pill dropzone-action-btn"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: '#111113',
                  color: '#FFFFFF',
                  height: '44px',
                  padding: '0 20px',
                  fontSize: '13px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'transform 0.15s ease, background 0.15s ease'
                }}
              >
                <Upload size={16} strokeWidth={2.4} />
                <span>Browse files</span>
              </button>

              <button
                type="button"
                className="pill dropzone-action-btn"
                onClick={() => cameraInputRef.current?.click()}
                style={{
                  background: '#FFFFFF',
                  color: '#111113',
                  height: '44px',
                  padding: '0 20px',
                  fontSize: '13px',
                  fontWeight: 700,
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'transform 0.15s ease'
                }}
              >
                <Camera size={16} strokeWidth={2.4} />
                <span>Take photo</span>
              </button>
            </div>
          </>
        )}

        {/* Failed Upload Soft Red Pill Message */}
        {processingError && !isUploading && (
          <div
            className="pill"
            style={{
              background: 'rgba(224, 86, 86, 0.16)',
              color: '#991B1B',
              border: '1px solid rgba(224, 86, 86, 0.35)',
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 14px',
              maxWidth: '90%',
              textAlign: 'center',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span>{processingError}</span>
            {onRetryUpload && (
              <button
                type="button"
                onClick={onRetryUpload}
                style={{ background: 'none', border: 'none', color: '#991B1B', cursor: 'pointer', padding: 0 }}
                title="Retry upload"
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        )}
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

      {/* 3. Footer Chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span
          className="pill"
          style={{
            background: 'rgba(17, 17, 19, 0.12)',
            color: '#111113',
            fontSize: '11px',
            fontWeight: 600,
            padding: '5px 12px'
          }}
        >
          Max 10 MB per file
        </span>
        <span
          className="pill"
          style={{
            background: 'rgba(17, 17, 19, 0.12)',
            color: '#111113',
            fontSize: '11px',
            fontWeight: 600,
            padding: '5px 12px'
          }}
        >
          Auto-compressed on device
        </span>
      </div>
    </div>
  );
}
