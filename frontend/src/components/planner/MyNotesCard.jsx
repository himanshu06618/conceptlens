import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Plus, 
  Pin, 
  ArrowRight, 
  Sparkles,
  Tag as TagIcon
} from 'lucide-react';
import { listNotes } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

function formatRelativeTime(isoString) {
  if (!isoString) return '';
  try {
    const now = new Date();
    const date = new Date(isoString);
    const diffSec = Math.max(0, Math.floor((now - date) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDays = Math.floor(diffHour / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function MyNotesCard({ onToast = () => {}, initialNotes = null, initialTotalCount = null }) {
  const { isAuthenticated, openAuthModal } = useAuth();
  const navigate = useNavigate();

  const [notes, setNotes] = useState(() => initialNotes || []);
  const [totalCount, setTotalCount] = useState(() => initialTotalCount ?? (initialNotes ? initialNotes.length : 0));
  const [loading, setLoading] = useState(() => initialNotes === null);

  useEffect(() => {
    if (initialNotes !== null && initialNotes !== undefined) {
      setNotes(initialNotes);
      setTotalCount(initialTotalCount ?? initialNotes.length);
      setLoading(false);
    }
  }, [initialNotes, initialTotalCount]);

  const fetchNotes = useCallback(async () => {
    if (!isAuthenticated) {
      setNotes([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const data = await listNotes({ limit: 4, page: 1 });
      setNotes(data.items || []);
      setTotalCount(data.total || 0);
    } catch (err) {
      console.error('Failed to load recent notes:', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (initialNotes === null || initialNotes === undefined) {
      fetchNotes();
    }
  }, [fetchNotes, initialNotes]);

  const handleOpenNewNote = (e) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('signin', 'Sign in to create and save your study notes.');
      return;
    }
    navigate('/notes?new=true');
  };

  const handleViewAll = (e) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      openAuthModal('signin', 'Sign in to view your personal study notebook.');
      return;
    }
    navigate('/notes');
  };

  const handleOpenNote = (noteId) => {
    if (!isAuthenticated) {
      openAuthModal('signin', 'Sign in to access your notes.');
      return;
    }
    navigate(`/notes?id=${encodeURIComponent(noteId)}`);
  };

  return (
    <div className="planner-section-card my-notes-card">
      <div className="planner-section-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={20} color="var(--planner-mint)" />
          <span>My Notes</span>
          {totalCount > 0 && (
            <span 
              className="mastery-badge"
              style={{ fontSize: '0.8rem', padding: '2px 8px', marginLeft: 4 }}
            >
              {totalCount}
            </span>
          )}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="my-notes-new-btn"
            onClick={handleOpenNewNote}
            title="Create new note"
            aria-label="New note"
          >
            <Plus size={14} strokeWidth={2.2} />
            <span>New note</span>
          </button>

          <button
            type="button"
            className="my-notes-view-all-btn"
            onClick={handleViewAll}
            title="View all personal notes"
            aria-label="View all notes"
          >
            <span>View all</span>
            <ArrowRight size={14} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="my-notes-skeleton-list">
          {[1, 2, 3].map((i) => (
            <div key={i} className="my-notes-skeleton-item">
              <div className="my-notes-skeleton-line short" />
              <div className="my-notes-skeleton-line" />
            </div>
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="my-notes-empty-state">
          <div className="my-notes-empty-icon-wrap">
            <Sparkles size={24} color="var(--planner-mint)" />
          </div>
          <p className="my-notes-empty-text">
            No notes yet. Write your first note to start building your study notebook.
          </p>
          <button
            type="button"
            onClick={handleOpenNewNote}
            className="start-plan-btn"
            style={{ margin: '14px auto 0', padding: '8px 18px', fontSize: '0.92rem' }}
          >
            <Plus size={15} />
            <span>Create First Note</span>
          </button>
        </div>
      ) : (
        <div className="my-notes-list" role="list" aria-label="Recent study notes">
          {notes.map((note) => {
            const displayTitle = note.title ? note.title.trim() : 'Untitled Note';
            const previewText = note.content
              ? note.content.slice(0, 140).trim()
              : 'No content yet…';

            return (
              <div
                key={note.id}
                role="listitem"
                tabIndex={0}
                className={`my-note-item ${note.pinned ? 'is-pinned' : ''}`}
                onClick={() => handleOpenNote(note.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleOpenNote(note.id);
                  }
                }}
              >
                <div className="my-note-item-header">
                  <div className="my-note-title-wrap">
                    {note.pinned && (
                      <span className="my-note-pin-badge" title="Pinned note">
                        <Pin size={13} fill="currentColor" />
                      </span>
                    )}
                    <span className="my-note-title">{displayTitle}</span>
                  </div>
                  <span className="my-note-time">
                    {formatRelativeTime(note.updated_at)}
                  </span>
                </div>

                <p className="my-note-preview">
                  {previewText}
                </p>

                <div className="my-note-footer">
                  {Array.isArray(note.tags) && note.tags.length > 0 && (
                    <div className="my-note-tags">
                      {note.tags.slice(0, 3).map((tag, idx) => (
                        <span key={idx} className="my-note-tag-chip">
                          #{tag}
                        </span>
                      ))}
                      {note.tags.length > 3 && (
                        <span className="my-note-tag-more">
                          +{note.tags.length - 3}
                        </span>
                      )}
                    </div>
                  )}

                  {note.chapter && (
                    <span className="my-note-chapter-badge" title={`Linked to chapter: ${note.chapter}`}>
                      {note.chapter}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
