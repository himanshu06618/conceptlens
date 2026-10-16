import React, { useState, useMemo } from 'react';
import { 
  Files, 
  FileText, 
  FileCode, 
  Image as ImageIcon, 
  Trash2, 
  Sparkles, 
  Clock, 
  BookOpen, 
  CheckCircle2, 
  ArrowRight, 
  Search, 
  RotateCw,
  AlertCircle,
  FileCheck2,
  X
} from 'lucide-react';
import '../../styles/planner.css';

/**
 * UploadedFilesSection:
 * Dedicated dashboard section allowing users to see all their uploaded files,
 * switch active documents with 1 click, inspect file status and concept counts,
 * and securely delete files with confirmation.
 */
export default function UploadedFilesSection({
  documents = [],
  activeDocId = null,
  onSelectDoc = () => {},
  onDeleteDoc = () => {},
  isLoading = false,
  onRefresh = () => {}
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Filtered documents by search
  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase().trim();
    return documents.filter((d) => (d.filename || '').toLowerCase().includes(q));
  }, [documents, searchQuery]);

  // Format date helper
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Recently';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Recently';
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return `Today at ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      }
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return 'Recently';
    }
  };

  const getFileIcon = (fileType = '', filename = '') => {
    const ext = (fileType || filename.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return (
        <div className="uploaded-file-icon-box image-type" aria-hidden="true">
          <ImageIcon size={18} />
        </div>
      );
    }
    if (['txt', 'md'].includes(ext)) {
      return (
        <div className="uploaded-file-icon-box code-type" aria-hidden="true">
          <FileCode size={18} />
        </div>
      );
    }
    return (
      <div className="uploaded-file-icon-box pdf-type" aria-hidden="true">
        <FileText size={18} />
      </div>
    );
  };

  return (
    <section 
      className="planner-section-card uploaded-files-section-card" 
      aria-label="Uploaded Notes & Materials"
      id="my-uploaded-files-section"
    >
      {/* Section Header */}
      <div className="uploaded-files-header">
        <div className="uploaded-files-title-wrap">
          <div className="uploaded-files-title-row">
            <span className="uploaded-files-icon-pill">
              <Files size={20} color="var(--planner-mint)" />
            </span>
            <h2 className="uploaded-files-heading">My Uploaded Files</h2>
            <span className="uploaded-files-count-badge">
              {documents.length} {documents.length === 1 ? 'file' : 'files'}
            </span>
          </div>
          <p className="uploaded-files-subtitle">
            Click any file below to switch between your notes and view extracted concepts, or delete files you no longer need.
          </p>
        </div>

        <div className="uploaded-files-header-actions">
          {documents.length > 2 && (
            <div className="uploaded-files-search-wrap">
              <Search size={14} className="uploaded-files-search-icon" />
              <input
                type="search"
                placeholder="Find uploaded note..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="uploaded-files-search-input"
                aria-label="Search uploaded files"
              />
            </div>
          )}

          <button
            type="button"
            onClick={onRefresh}
            className="uploaded-files-refresh-btn"
            title="Refresh files list"
            disabled={isLoading}
            aria-label="Refresh files list"
          >
            <RotateCw size={14} className={isLoading ? 'spin-animation' : ''} />
          </button>
        </div>
      </div>

      {/* Quick Switcher Bar when user has 2 or more files */}
      {documents.length >= 2 && (
        <div className="uploaded-files-quick-switch-bar" role="toolbar" aria-label="Quick File Switcher">
          <span className="quick-switch-label">Switch File:</span>
          <div className="quick-switch-pills-list">
            {documents.map((doc) => {
              const isActive = activeDocId === doc.id;
              const cleanName = (doc.filename || 'Untitled').replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
              return (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => onSelectDoc(doc.id)}
                  className={`quick-switch-pill ${isActive ? 'is-active' : ''}`}
                  title={`Switch to ${doc.filename}`}
                  aria-pressed={isActive}
                >
                  <span className={`quick-switch-dot ${isActive ? 'pulse' : ''}`} />
                  <span className="quick-switch-name">{cleanName}</span>
                  {isActive && <span className="quick-switch-active-tag">Active</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Files Grid */}
      {documents.length === 0 ? (
        <div className="uploaded-files-empty-state">
          <div className="empty-icon-wrap">
            <BookOpen size={32} color="var(--planner-mint)" />
          </div>
          <h3 className="empty-title">No files uploaded yet</h3>
          <p className="empty-desc">
            Use the upload card above to upload course PDFs, lecture slides, or notes. All your uploaded materials will appear here with instant switching.
          </p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="uploaded-files-empty-state">
          <Search size={28} color="var(--planner-text-muted)" />
          <h3 className="empty-title">No matching files found</h3>
          <p className="empty-desc">
            No files matched "{searchQuery}". Clear your search query to see all notes.
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="uploaded-files-clear-search-btn"
          >
            Clear Search
          </button>
        </div>
      ) : (
        <div className="uploaded-files-grid" role="list">
          {filteredDocs.map((doc) => {
            const isActive = activeDocId === doc.id;
            const isCompleted = doc.status === 'completed';
            const isProcessing = doc.status === 'processing';
            const isFailed = doc.status === 'failed';
            const isDeleting = confirmDeleteId === doc.id;
            const ext = (doc.file_type || doc.filename?.split('.').pop() || 'pdf').toUpperCase();

            return (
              <div
                key={doc.id}
                className={`uploaded-file-card ${isActive ? 'is-active' : ''} ${isProcessing ? 'is-processing' : ''}`}
                role="listitem"
                aria-current={isActive ? 'true' : undefined}
              >
                {/* Active Indicator Ribbon */}
                {isActive && (
                  <div className="file-card-active-indicator">
                    <span className="active-glow-dot" />
                    <span>Currently Viewing</span>
                  </div>
                )}

                {/* Card Top: Icon, Title & Delete Trigger */}
                <div className="file-card-header">
                  <div className="file-card-icon-title">
                    {getFileIcon(doc.file_type, doc.filename)}
                    <div className="file-card-name-group">
                      <div 
                        className="file-card-filename" 
                        title={doc.filename}
                        onClick={() => onSelectDoc(doc.id)}
                      >
                        {doc.filename}
                      </div>
                      <div className="file-card-type-tag">{ext} Note</div>
                    </div>
                  </div>

                  {/* Delete Button */}
                  {!isDeleting ? (
                    <button
                      type="button"
                      className="file-card-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(doc.id);
                      }}
                      title={`Delete "${doc.filename}"`}
                      aria-label={`Delete "${doc.filename}"`}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </div>

                {/* Inline Confirmation Prompt */}
                {isDeleting && (
                  <div className="file-card-delete-confirm-box" role="alert">
                    <div className="delete-confirm-text">
                      <AlertCircle size={14} color="#ef4444" />
                      <span>Delete this file and all its extracted concepts?</span>
                    </div>
                    <div className="delete-confirm-actions">
                      <button
                        type="button"
                        className="delete-confirm-btn cancel"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="delete-confirm-btn confirm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                          onDeleteDoc(doc.id);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}

                {/* Card Metadata Row */}
                <div className="file-card-meta-row">
                  <span className="file-card-meta-item" title="Extracted concepts">
                    <Sparkles size={13} color="var(--planner-mint)" />
                    <span>{doc.concept_count || 0} concepts</span>
                  </span>

                  <span className="file-card-meta-item" title="Document pages">
                    <BookOpen size={13} color="var(--planner-text-muted)" />
                    <span>{doc.page_count || 1} {doc.page_count === 1 ? 'page' : 'pages'}</span>
                  </span>

                  <span className="file-card-meta-item" title="Upload time">
                    <Clock size={13} color="var(--planner-text-muted)" />
                    <span>{formatDate(doc.created_at)}</span>
                  </span>
                </div>

                {/* Status Bar */}
                <div className="file-card-status-bar">
                  {isProcessing ? (
                    <div className="status-badge processing">
                      <span className="status-spinner" />
                      <span>Extracting ({doc.progress || 10}%)</span>
                    </div>
                  ) : isFailed ? (
                    <div className="status-badge failed">
                      <AlertCircle size={12} />
                      <span>Extraction Failed</span>
                    </div>
                  ) : (
                    <div className="status-badge ready">
                      <CheckCircle2 size={12} />
                      <span>Ready to Study</span>
                    </div>
                  )}
                </div>

                {/* Bottom Action Button */}
                <div className="file-card-actions">
                  {isActive ? (
                    <button
                      type="button"
                      className="file-card-switch-btn active"
                      disabled
                      aria-label={`Currently viewing ${doc.filename}`}
                    >
                      <FileCheck2 size={16} />
                      <span>Viewing Now</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="file-card-switch-btn"
                      onClick={() => onSelectDoc(doc.id)}
                      title={`Switch active note to ${doc.filename}`}
                      aria-label={`Switch to ${doc.filename} and view concepts`}
                    >
                      <span>Switch to this file</span>
                      <ArrowRight size={15} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
