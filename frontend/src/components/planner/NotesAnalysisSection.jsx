import React, { useState } from 'react';
import { BookOpen, Edit2, Check, Clock, Sparkles, Search, GitBranch, Trash2 } from 'lucide-react';

export default function NotesAnalysisSection({
  books = [],
  activeBookId = null,
  onSelectBook = () => {},
  onOpenDocumentResults = () => {},
  onDeleteDocument = () => {},
  onUpdateChapterStatus = () => {},
  onUpdateChapterMeta = () => {}
}) {
  const [editingHoursId, setEditingHoursId] = useState(null);
  const [editingHoursVal, setEditingHoursVal] = useState('');
  const [docSearchQuery, setDocSearchQuery] = useState('');

  const filteredBooks = books.filter((b) => {
    if (!docSearchQuery.trim()) return true;
    const q = docSearchQuery.toLowerCase();
    const nameMatch = b.filename?.toLowerCase().includes(q);
    const chapterMatch = (b.chapters || []).some((ch) => ch.name?.toLowerCase().includes(q));
    return nameMatch || chapterMatch;
  });

  const currentBook =
    filteredBooks.find((b) => b.id === activeBookId) ||
    books.find((b) => b.id === activeBookId) ||
    filteredBooks[0] ||
    books[0] ||
    null;

  const handleCycleStatus = (chapter) => {
    const nextStatus = ((chapter.status || 0) + 1) % 3;
    onUpdateChapterStatus(chapter.id, nextStatus);
  };

  const handleStartEditHours = (chapter) => {
    setEditingHoursId(chapter.id);
    setEditingHoursVal(String(chapter.est_hours || 1.0));
  };

  const handleSaveHours = (chapterId) => {
    const val = parseFloat(editingHoursVal);
    if (!isNaN(val) && val > 0) {
      onUpdateChapterMeta(chapterId, { est_hours: val });
    }
    setEditingHoursId(null);
  };

  const difficultyLabels = {
    0: 'Easy',
    1: 'Medium',
    2: 'Hard'
  };

  const difficultyClasses = {
    0: 'diff-easy',
    1: 'diff-med',
    2: 'diff-hard'
  };

  const statusLabels = {
    0: 'Not started',
    1: 'In progress',
    2: 'Done'
  };

  const statusBtnClasses = {
    0: 'status-btn-0',
    1: 'status-btn-1',
    2: 'status-btn-2'
  };

  const statusFillClasses = {
    0: 'fill-not-started',
    1: 'fill-in-progress',
    2: 'fill-done'
  };

  return (
    <div className="planner-section-card">
      <div className="planner-section-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <BookOpen size={20} color="var(--planner-mint)" />
          Notes Analysis & Chapters
        </span>
      </div>

      {/* Document Search Bar */}
      {books.length > 0 && (
        <div style={{ marginBottom: '16px', position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--planner-text-muted)' }} />
          <input
            type="search"
            placeholder="Search notes & chapters..."
            value={docSearchQuery}
            onChange={(e) => setDocSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px 8px 34px',
              borderRadius: 'var(--planner-radius-sm)',
              border: '1px solid var(--planner-card-border)',
              background: 'var(--planner-chip-bg)',
              color: 'var(--planner-text-main)',
              fontSize: '0.88rem',
              boxSizing: 'border-box',
              outline: 'none'
            }}
            aria-label="Search notes and chapters"
          />
        </div>
      )}

      {books.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: 'var(--planner-text-muted)', background: 'var(--planner-chip-bg)', borderRadius: 'var(--planner-radius-sm)' }}>
          No documents uploaded yet. Upload course notes to view automatic chapter breakdowns and difficulty ratings!
        </div>
      ) : (
        <>
          {/* Book Tabs with Mastery % */}
          <div className="planner-book-tabs" role="tablist" aria-label="Course Books">
            {filteredBooks.map((b) => {
              const isActive = (currentBook && currentBook.id === b.id);
              const displayName = b.filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

              return (
                <button
                  key={b.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`planner-book-tab ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    onSelectBook(b.id);
                    onOpenDocumentResults(b.id);
                  }}
                >
                  <span>{displayName}</span>
                  <span className="mastery-badge">
                    {b.mastery_pct || 0}% mastered
                  </span>
                </button>
              );
            })}
          </div>

          {/* Active Book Actions Toolbar */}
          {currentBook && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'var(--planner-chip-bg)',
              borderRadius: 'var(--planner-radius-sm)',
              marginBottom: '16px',
              border: '1px solid var(--planner-card-border)'
            }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--planner-text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <BookOpen size={16} color="var(--planner-mint)" />
                <span style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={currentBook.filename}>
                  {currentBook.filename}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => onOpenDocumentResults(currentBook.id)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 12px',
                    borderRadius: '6px',
                    background: 'rgba(154, 230, 46, 0.2)',
                    border: '1px solid var(--planner-mint-border)',
                    color: 'var(--planner-text-main)',
                    fontSize: '0.82rem',
                    fontFamily: 'var(--planner-font-title)',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="Open Concepts, Concept Tree & Roadmap in results panel"
                >
                  <GitBranch size={13} color="var(--planner-mint)" />
                  <span>Open Results</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete "${currentBook.filename}" and its chapters?`)) {
                      onDeleteDocument(currentBook.id);
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '6px',
                    borderRadius: '6px',
                    background: 'transparent',
                    border: '1px solid var(--planner-card-border)',
                    color: 'var(--planner-text-muted)',
                    cursor: 'pointer'
                  }}
                  title={`Delete ${currentBook.filename}`}
                  aria-label={`Delete ${currentBook.filename}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Chapter Rows */}
          {currentBook && (
            <div className="planner-chapters-list" role="list" aria-label="Chapters in current document">
              {currentBook.chapters?.length === 0 ? (
                <div style={{ padding: '16px', color: 'var(--planner-text-muted)', fontSize: '0.9rem' }}>
                  No chapters defined for this document yet.
                </div>
              ) : (
                currentBook.chapters?.map((chapter) => {
                  const status = chapter.status ?? 0;
                  const isEditingHours = editingHoursId === chapter.id;

                  return (
                    <div key={chapter.id} className="planner-chapter-row" role="listitem">
                      {/* Name & Concepts */}
                      <div className="chapter-title-col">
                        <span className="chapter-name">{chapter.name}</span>
                        <span className="chapter-meta-sub">
                          {chapter.concept_count} {chapter.concept_count === 1 ? 'concept' : 'concepts'}
                        </span>
                      </div>

                      {/* Est Hours (Editable) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.88rem' }}>
                        {isEditingHours ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={editingHoursVal}
                              onChange={(e) => setEditingHoursVal(e.target.value)}
                              style={{
                                width: '54px',
                                padding: '3px 6px',
                                borderRadius: '4px',
                                border: '1.5px solid var(--planner-mint)',
                                fontFamily: 'var(--planner-font-title)'
                              }}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveHours(chapter.id);
                                if (e.key === 'Escape') setEditingHoursId(null);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveHours(chapter.id)}
                              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--planner-mint)' }}
                              aria-label="Save hours"
                            >
                              <Check size={16} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleStartEditHours(chapter)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              color: 'var(--planner-text-main)',
                              fontFamily: 'var(--planner-font-title)',
                              fontWeight: 600
                            }}
                            title="Click to edit estimated study hours"
                          >
                            <Clock size={13} color="var(--planner-text-muted)" />
                            <span>{chapter.est_hours}h</span>
                            <Edit2 size={12} color="var(--planner-text-muted)" style={{ opacity: 0.6 }} />
                          </button>
                        )}
                      </div>

                      {/* Difficulty Chip */}
                      <div>
                        <span className={`difficulty-chip ${difficultyClasses[chapter.difficulty ?? 1]}`}>
                          {difficultyLabels[chapter.difficulty ?? 1]}
                        </span>
                      </div>

                      {/* Progress Bar */}
                      <div className="chapter-progress-bar-wrap" title={`Status: ${statusLabels[status]}`}>
                        <div className={`chapter-progress-fill ${statusFillClasses[status]}`} />
                      </div>

                      {/* Status Button & Explicit Mark Complete Control */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {status !== 2 && (
                          <button
                            type="button"
                            className="status-cycle-btn mark-complete-btn"
                            style={{
                              background: 'rgba(154, 230, 46, 0.15)',
                              borderColor: 'var(--planner-mint)',
                              color: 'var(--planner-text-main)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '4px 10px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                            onClick={() => onUpdateChapterStatus(chapter.id, 2)}
                            title="Mark chapter complete"
                            aria-label={`Mark chapter ${chapter.name} complete`}
                          >
                            <Check size={13} color="var(--planner-mint)" />
                            <span>Mark complete</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className={`status-cycle-btn ${statusBtnClasses[status]}`}
                          onClick={() => handleCycleStatus(chapter)}
                          title="Click to cycle: Not started → In progress → Done"
                          aria-label={`Current status: ${statusLabels[status]}. Click to update`}
                        >
                          {statusLabels[status]}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
