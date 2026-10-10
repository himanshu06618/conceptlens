import React, { useState, useMemo, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  FileText, 
  FileCode, 
  Image as ImageIcon,
  Search,
  X,
  BookOpen,
} from 'lucide-react';
import { Button, IconButton, Logo } from './ui';

/**
 * Premium Workspace Sidebar (288px)
 * - Gold "New upload" button
 * - Compact note search field
 * - "Previous notes" grouped by Today / This week / Earlier
 * - File-type icon, clean title (truncated), concept count, status dot
 * - Active note: gold left accent line and tinted surface-2 background
 * - Elegant empty state
 * - One quiet guest line at the bottom ("Guest: 2 of 5 uploads used" + inline "Sign in")
 */
export default function Sidebar({
  documents = [],
  activeDocId,
  onSelectDoc,
  onNewUpload,
  onDeleteDoc,
  isOpen = false,
  onClose,
  isCollapsed = false,
  guestStatus = null,
  user = null,
  onOpenAuth
}) {
  const [searchQuery, setSearchQuery] = useState('');

  // Close drawer on Escape key (mobile)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && onClose) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Group notes into Today / This week / Earlier
  const groupedNotes = useMemo(() => {
    const filtered = documents.filter((doc) =>
      doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    const groups = {
      today: [],
      thisWeek: [],
      earlier: []
    };

    filtered.forEach((doc) => {
      const createdTime = new Date(doc.created_at).getTime();
      if (isNaN(createdTime) || createdTime >= todayStart) {
        groups.today.push(doc);
      } else if (createdTime >= weekStart) {
        groups.thisWeek.push(doc);
      } else {
        groups.earlier.push(doc);
      }
    });

    return groups;
  }, [documents, searchQuery]);

  const getFileIcon = (fileType) => {
    const type = (fileType || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(type)) {
      return <ImageIcon size={16} strokeWidth={1.8} className="file-type-icon image" />;
    }
    if (['txt', 'md'].includes(type)) {
      return <FileCode size={16} strokeWidth={1.8} className="file-type-icon code" />;
    }
    return <FileText size={16} strokeWidth={1.8} className="file-type-icon pdf" />;
  };

  const renderNoteRow = (doc) => {
    const isActive = activeDocId === doc.id;
    return (
      <div
        key={doc.id}
        className={`sidebar-note-row ${isActive ? 'active' : ''}`}
        onClick={() => {
          onSelectDoc(doc.id);
          if (onClose) onClose();
        }}
        role="button"
        tabIndex={0}
      >
        <div className="note-row-leading">
          {getFileIcon(doc.file_type)}
        </div>

        <div className="note-row-center">
          <div className="note-row-title" title={doc.filename}>
            {doc.filename}
          </div>
          <div className="note-row-sub">
            {doc.status === 'processing' ? (
              <>
                <span className="status-dot status-processing" />
                <span className="note-count-label">Processing...</span>
              </>
            ) : doc.status === 'failed' ? (
              <>
                <span className="status-dot status-failed" />
                <span className="note-count-label failed">Failed</span>
              </>
            ) : (
              <span className="note-count-label">
                {doc.concept_count} {doc.concept_count === 1 ? 'concept' : 'concepts'}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="note-row-delete-btn"
          title={`Delete ${doc.filename}`}
          aria-label={`Delete ${doc.filename}`}
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete "${doc.filename}" and its concepts?`)) {
              onDeleteDoc(doc.id);
            }
          }}
        >
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </div>
    );
  };

  return (
    <>
      {/* Mobile Drawer Dimmed Backdrop */}
      {isOpen && (
        <div 
          className="sidebar-backdrop" 
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside 
        className={`workspace-sidebar ${isOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`} 
        aria-label="Documents navigation"
      >
        {/* Mobile top bar */}
        <div className="sidebar-top-bar">
          <div 
            className="sidebar-brand-click" 
            onClick={() => {
              onNewUpload();
              if (onClose) onClose();
            }}
          >
            <Logo size={26} />
          </div>

          {onClose && (
            <IconButton 
              icon={X} 
              onClick={onClose}
              aria-label="Close sidebar"
              size="sm"
              variant="ghost"
            />
          )}
        </div>

        {/* Desktop Header Row: Title + Count */}
        <div className="sidebar-header-row">
          <div className="sidebar-header-meta">
            <span className="sidebar-header-title">Notes</span>
            {documents.length > 0 && (
              <span className="sidebar-count-chip">{documents.length}</span>
            )}
          </div>
        </div>

        {/* Primary Action: Gold New Upload Button */}
        <div className="sidebar-upload-wrap">
          <Button 
            variant="primary"
            size="md"
            icon={Plus}
            fullWidth
            onClick={() => {
              onNewUpload();
              if (onClose) onClose();
            }}
          >
            New upload
          </Button>
        </div>

        {/* Compact Search Field */}
        <div className="sidebar-search-wrap">
          <div className="sidebar-search-input">
            <Search size={15} strokeWidth={1.8} className="sidebar-search-icon" />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search previous notes"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={13} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        {/* Previous Notes Groups */}
        <div className="sidebar-scroll-area">
          {documents.length === 0 ? (
            <div className="sidebar-empty-state">
              <div className="empty-illustration-wrap">
                <BookOpen size={28} strokeWidth={1.5} className="empty-book-icon" />
              </div>
              <p className="empty-main-text">Your notes will appear here</p>
              <p className="empty-hint-text">Upload a PDF or image to extract concepts</p>
            </div>
          ) : (
            <div className="sidebar-groups-list">
              {groupedNotes.today.length > 0 && (
                <div className="sidebar-group">
                  <div className="sidebar-group-heading">Today</div>
                  <div className="sidebar-group-items">
                    {groupedNotes.today.map(renderNoteRow)}
                  </div>
                </div>
              )}

              {groupedNotes.thisWeek.length > 0 && (
                <div className="sidebar-group">
                  <div className="sidebar-group-heading">This week</div>
                  <div className="sidebar-group-items">
                    {groupedNotes.thisWeek.map(renderNoteRow)}
                  </div>
                </div>
              )}

              {groupedNotes.earlier.length > 0 && (
                <div className="sidebar-group">
                  <div className="sidebar-group-heading">Earlier</div>
                  <div className="sidebar-group-items">
                    {groupedNotes.earlier.map(renderNoteRow)}
                  </div>
                </div>
              )}

              {groupedNotes.today.length === 0 &&
               groupedNotes.thisWeek.length === 0 &&
               groupedNotes.earlier.length === 0 && (
                <div className="sidebar-no-results">
                  <span>No notes match "{searchQuery}"</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Quiet Guest Usage Footer: ONE quiet place only */}
        {!user && guestStatus && (
          <div className="sidebar-guest-footer">
            <span className="guest-footer-label">
              Guest: {guestStatus.uploads_count || 0} of {guestStatus.upload_limit || 5} uploads used
            </span>
            <button
              type="button"
              className="guest-footer-link"
              onClick={() => onOpenAuth && onOpenAuth('signin')}
            >
              Sign in
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
