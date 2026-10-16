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
  Search, 
  RotateCw,
  AlertCircle
} from 'lucide-react';
import '../../styles/planner.css';

/**
 * UploadedFilesSection:
 * Compact, low-profile dashboard section allowing users to see all their uploaded files,
 * switch active documents with 1 click, inspect file status and concept counts,
 * and securely delete files with inline confirmation.
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

  // Format date helper (concise for compact card)
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
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  const getFileIcon = (fileType = '', filename = '') => {
    const ext = (fileType || filename.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return (
        <div className="compact-file-icon image-type" aria-hidden="true">
          <ImageIcon size={14} />
        </div>
      );
    }
    if (['txt', 'md'].includes(ext)) {
      return (
        <div className="compact-file-icon code-type" aria-hidden="true">
          <FileCode size={14} />
        </div>
      );
    }
    return (
      <div className="compact-file-icon pdf-type" aria-hidden="true">
        <FileText size={14} />
      </div>
    );
  };

  return (
    <section 
      className="planner-section-card uploaded-files-section-card compact-mode" 
      aria-label="Uploaded Notes & Materials"
      id="my-uploaded-files-section"
    >
      {/* Compact Section Header */}
      <div className="uploaded-files-header compact">
        <div className="uploaded-files-title-row">
          <span className="uploaded-files-icon-pill compact">
            <Files size={16} color="var(--planner-mint)" />
          </span>
          <h2 className="uploaded-files-heading compact">My Uploaded Files</h2>
          <span className="uploaded-files-count-badge compact">
            {documents.length} {documents.length === 1 ? 'file' : 'files'}
          </span>
        </div>

        <div className="uploaded-files-header-actions">
          {documents.length > 2 && (
            <div className="uploaded-files-search-wrap compact">
              <Search size={13} className="uploaded-files-search-icon" />
              <input
                type="search"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="uploaded-files-search-input compact"
                aria-label="Search uploaded files"
              />
            </div>
          )}

          <button
            type="button"
            onClick={onRefresh}
            className="uploaded-files-refresh-btn compact"
            title="Refresh files list"
            disabled={isLoading}
            aria-label="Refresh files list"
          >
            <RotateCw size={13} className={isLoading ? 'spin-animation' : ''} />
          </button>
        </div>
      </div>

      {/* Main Files Grid - Compact Cards */}
      {documents.length === 0 ? (
        <div className="uploaded-files-empty-state compact">
          <div className="empty-icon-wrap compact">
            <BookOpen size={20} color="var(--planner-mint)" />
          </div>
          <p className="empty-desc compact">
            No files uploaded yet. Use the upload card above to add lecture notes or slides.
          </p>
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="uploaded-files-empty-state compact">
          <p className="empty-desc compact">
            No files matched "{searchQuery}".
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="uploaded-files-clear-search-btn compact"
          >
            Clear Search
          </button>
        </div>
      ) : (
        <div className="uploaded-files-grid compact" role="list">
          {filteredDocs.map((doc) => {
            const isActive = activeDocId === doc.id;
            const isProcessing = doc.status === 'processing';
            const isFailed = doc.status === 'failed';
            const isDeleting = confirmDeleteId === doc.id;

            return (
              <div
                key={doc.id}
                className={`uploaded-file-card compact ${isActive ? 'is-active' : ''} ${isProcessing ? 'is-processing' : ''}`}
                role="listitem"
                aria-current={isActive ? 'true' : undefined}
                onClick={() => {
                  if (!isDeleting) onSelectDoc(doc.id);
                }}
                title={isActive ? `Currently viewing "${doc.filename}"` : `Click to switch to "${doc.filename}"`}
              >
                {/* Regular Card Content */}
                {!isDeleting ? (
                  <>
                    {/* Top Row: Icon + Filename + Active Pill + Delete Trigger */}
                    <div className="compact-file-top-row">
                      {getFileIcon(doc.file_type, doc.filename)}
                      
                      <div className="compact-file-name-wrap">
                        <span className="compact-file-name" title={doc.filename}>
                          {doc.filename}
                        </span>
                      </div>

                      {isActive && (
                        <span className="compact-active-pill" title="Currently active document">
                          <span className="active-glow-dot" />
                          <span>Viewing</span>
                        </span>
                      )}

                      <button
                        type="button"
                        className="compact-file-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(doc.id);
                        }}
                        title={`Delete "${doc.filename}"`}
                        aria-label={`Delete "${doc.filename}"`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Bottom Row: Concepts, Pages, Date & Status */}
                    <div className="compact-file-bottom-row">
                      <div className="compact-file-meta-group">
                        <span className="compact-file-meta-item" title="Concepts count">
                          <Sparkles size={11} color="var(--planner-mint)" />
                          <span>{doc.concept_count || 0}</span>
                        </span>

                        <span className="compact-file-meta-dot">•</span>

                        <span className="compact-file-meta-item" title="Pages count">
                          <BookOpen size={11} color="var(--planner-text-muted)" />
                          <span>{doc.page_count || 1}p</span>
                        </span>

                        <span className="compact-file-meta-dot">•</span>

                        <span className="compact-file-meta-item" title="Upload time">
                          <Clock size={11} color="var(--planner-text-muted)" />
                          <span>{formatDate(doc.created_at)}</span>
                        </span>
                      </div>

                      {/* Status pill */}
                      <div className="compact-file-status">
                        {isProcessing ? (
                          <span className="status-badge processing compact">
                            <span className="status-spinner" />
                            <span>{doc.progress || 10}%</span>
                          </span>
                        ) : isFailed ? (
                          <span className="status-badge failed compact" title="Extraction failed">
                            <AlertCircle size={10} />
                            <span>Failed</span>
                          </span>
                        ) : (
                          <span className="status-badge ready compact" title="Ready to study">
                            <CheckCircle2 size={10} />
                            <span>Ready</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  /* Compact Inline Delete Confirmation */
                  <div 
                    className="compact-delete-confirm-box" 
                    role="alert"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="compact-delete-text">Delete file?</span>
                    <div className="compact-delete-actions">
                      <button
                        type="button"
                        className="compact-confirm-btn cancel"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="compact-confirm-btn confirm"
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
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
