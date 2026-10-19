import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Search,
  Clock,
  Edit2,
  Check,
  GitBranch,
  Trash2,
  RotateCw,
  FileText
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getDashboardBootstrap,
  updateChapterProgress,
  updateChapterMeta,
  deleteDocument
} from '../api/client';
import { getDashboardCache, saveDashboardCache } from '../utils/dashboardCache';
import { deleteLocalFile } from '../utils/fileStore';
import '../styles/planner.css';

export default function NotesAnalysisView({ onToast = () => {} }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [books, setBooks] = useState([]);
  const [activeBookId, setActiveBookId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingHoursId, setEditingHoursId] = useState(null);
  const [editingHoursVal, setEditingHoursVal] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Load overview from cache then fresh bootstrap
  const loadData = useCallback(async () => {
    if (user?.id) {
      try {
        const cached = await getDashboardCache(user.id);
        if (cached?.overview?.books?.length) {
          setBooks(cached.overview.books);
          if (!activeBookId) {
            setActiveBookId(cached.overview.books[0].id);
          }
          setLoading(false);
        }
      } catch (_) {}
    }

    try {
      const data = await getDashboardBootstrap();
      if (data?.books) {
        setBooks(data.books);
        if (!activeBookId && data.books.length > 0) {
          setActiveBookId(data.books[0].id);
        }
        if (user?.id) {
          saveDashboardCache(user.id, { overview: data });
        }
      }
    } catch (err) {
      console.warn('Could not load notes analysis data:', err);
    } finally {
      setLoading(false);
    }
  }, [user, activeBookId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Filter books by search query
  const filteredBooks = books.filter((b) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
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

  const handleUpdateStatus = async (chapterId, status) => {
    try {
      await updateChapterProgress(chapterId, status);
      // Optimistic update
      setBooks((prev) =>
        prev.map((b) => ({
          ...b,
          chapters: (b.chapters || []).map((ch) =>
            ch.id === chapterId ? { ...ch, status } : ch
          )
        }))
      );
      loadData();
    } catch {
      onToast({ type: 'error', message: 'Failed to update chapter progress' });
    }
  };

  const handleCycleStatus = (chapter) => {
    const nextStatus = ((chapter.status || 0) + 1) % 3;
    handleUpdateStatus(chapter.id, nextStatus);
  };

  const handleStartEditHours = (chapter) => {
    setEditingHoursId(chapter.id);
    setEditingHoursVal(String(chapter.est_hours || 1.0));
  };

  const handleSaveHours = async (chapterId) => {
    const val = parseFloat(editingHoursVal);
    if (!isNaN(val) && val > 0) {
      try {
        await updateChapterMeta(chapterId, { est_hours: val });
        setBooks((prev) =>
          prev.map((b) => ({
            ...b,
            chapters: (b.chapters || []).map((ch) =>
              ch.id === chapterId ? { ...ch, est_hours: val } : ch
            )
          }))
        );
        onToast({ type: 'success', message: 'Estimated study hours updated' });
        loadData();
      } catch {
        onToast({ type: 'error', message: 'Failed to save study hours' });
      }
    }
    setEditingHoursId(null);
  };

  const handleDeleteBook = async (docId) => {
    try {
      await deleteDocument(docId);
      try {
        await deleteLocalFile(user?.id, docId);
      } catch (_) {}
      onToast({ type: 'info', message: 'Document removed' });
      setBooks((prev) => prev.filter((b) => b.id !== docId));
      if (activeBookId === docId) {
        setActiveBookId(null);
      }
      loadData();
    } catch (err) {
      onToast({ type: 'error', message: err.message || 'Failed to delete document' });
    }
  };

  const difficultyLabels = { 0: 'Easy', 1: 'Medium', 2: 'Hard' };
  const difficultyBgs = {
    0: 'rgba(215, 242, 92, 0.25)',
    1: 'rgba(183, 169, 242, 0.25)',
    2: 'rgba(245, 196, 107, 0.25)'
  };
  const difficultyColors = { 0: '#111113', 1: '#111113', 2: '#111113' };

  const statusLabels = { 0: 'Not started', 1: 'In progress', 2: 'Done' };
  const statusColors = {
    0: { bg: 'rgba(17, 17, 19, 0.08)', text: 'var(--muted)' },
    1: { bg: 'rgba(183, 169, 242, 0.22)', text: '#111113' },
    2: { bg: 'var(--lime)', text: '#111113' }
  };

  return (
    <div className="planner-container" style={{ paddingBottom: '40px' }}>
      {/* 1. Page Header */}
      <section className="flux-page-header">
        <div className="flux-page-header-left">
          <h1 className="flux-page-title" style={{ fontSize: '40px', fontWeight: 700, letterSpacing: '-1.5px' }}>
            Notes Analysis
          </h1>
          <div className="flux-page-subtitle-row">
            <span className="flux-page-subtitle">
              Detailed chapter breakdowns, estimated study hours & mastery milestones
            </span>
          </div>
        </div>

        <div className="flux-page-header-right">
          <button
            type="button"
            className="pill card--lime"
            onClick={() => navigate('/notes')}
            style={{ border: 'none', cursor: 'pointer', padding: '8px 18px', fontWeight: 700 }}
          >
            Upload Notes
          </button>
        </div>
      </section>

      {/* 2. White Card Container */}
      <div className="card" style={{ padding: '28px', gap: '20px' }}>
        {/* Search Field */}
        <div style={{ position: 'relative', width: '100%' }}>
          <Search
            size={18}
            style={{
              position: 'absolute',
              left: 16,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--muted)'
            }}
          />
          <input
            type="search"
            placeholder="Search notes, chapters, topics..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 18px 12px 46px',
              borderRadius: '9999px',
              border: 'none',
              background: 'var(--surface-subtle, #F0F0F2)',
              color: 'var(--text)',
              fontSize: '14px',
              fontWeight: 500,
              boxSizing: 'border-box',
              outline: 'none',
              fontFamily: 'inherit'
            }}
            aria-label="Search notes and chapters"
          />
        </div>

        {/* Empty State */}
        {books.length === 0 && !loading ? (
          <div style={{ padding: '48px 24px', textAlign: 'center', background: 'var(--surface-subtle, #F0F0F2)', borderRadius: '20px' }}>
            <FileText size={40} color="var(--muted)" style={{ margin: '0 auto 12px', opacity: 0.6 }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
              No notes analyzed yet
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--muted)', margin: '0 0 16px' }}>
              Upload course notes or textbook slides to generate instant chapter breakdowns and study time estimates.
            </p>
            <button
              type="button"
              className="pill card--lime"
              onClick={() => navigate('/notes')}
              style={{ border: 'none', cursor: 'pointer', padding: '10px 22px', fontWeight: 700, fontSize: '14px' }}
            >
              Upload Notes
            </button>
          </div>
        ) : (
          <>
            {/* File/Chapter Tabs with Mastery Pills */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                overflowX: 'auto',
                paddingBottom: '4px',
                scrollbarWidth: 'none'
              }}
              role="tablist"
              aria-label="Document Tabs"
            >
              {filteredBooks.map((b) => {
                const isActive = currentBook && currentBook.id === b.id;
                const displayName = (b.filename || '').replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

                return (
                  <button
                    key={b.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveBookId(b.id)}
                    className="pill"
                    style={{
                      background: isActive ? '#111113' : 'var(--surface-subtle, #F0F0F2)',
                      color: isActive ? '#FFFFFF' : 'var(--text)',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: 600,
                      gap: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span>{displayName}</span>
                    <span
                      className="pill"
                      style={{
                        background: isActive ? 'var(--lime)' : 'rgba(17, 17, 19, 0.08)',
                        color: '#111113',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px'
                      }}
                    >
                      {b.mastery_pct || 0}% mastered
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Active File Header Toolbar with "Open Results" and Delete */}
            {currentBook && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '14px 18px',
                  background: 'var(--surface-subtle, #F0F0F2)',
                  borderRadius: '16px',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'var(--lime)',
                      color: '#111113',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}
                  >
                    <BookOpen size={16} strokeWidth={2.2} />
                  </div>
                  <span
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '320px'
                    }}
                    title={currentBook.filename}
                  >
                    {currentBook.filename}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    className="pill"
                    onClick={() => navigate(`/?tab=tree&docId=${currentBook.id}`)}
                    style={{
                      background: 'var(--lime)',
                      color: '#111113',
                      height: '36px',
                      padding: '0 16px',
                      fontSize: '12px',
                      fontWeight: 700,
                      border: 'none',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                    title="Open Concepts, Concept Tree & Roadmap"
                  >
                    <GitBranch size={14} strokeWidth={2.2} />
                    <span>Open Results</span>
                  </button>

                  {confirmDeleteId !== currentBook.id ? (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(currentBook.id)}
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer'
                      }}
                      title="Delete document"
                      aria-label={`Delete ${currentBook.filename}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  ) : (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <button
                        type="button"
                        className="pill"
                        onClick={() => handleDeleteBook(currentBook.id)}
                        style={{
                          background: '#EF4444',
                          color: '#FFFFFF',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '4px 10px',
                          border: 'none',
                          cursor: 'pointer'
                        }}
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--muted)',
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Chapter Rows */}
            {currentBook && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} role="list">
                {(currentBook.chapters || []).length === 0 ? (
                  <div style={{ padding: '20px', color: 'var(--muted)', fontSize: '14px', textAlign: 'center' }}>
                    No chapters defined for this document yet.
                  </div>
                ) : (
                  currentBook.chapters.map((chapter) => {
                    const status = chapter.status ?? 0;
                    const isEditingHours = editingHoursId === chapter.id;
                    const statusStyle = statusColors[status] || statusColors[0];

                    return (
                      <div
                        key={chapter.id}
                        role="listitem"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '16px',
                          padding: '14px 18px',
                          borderRadius: '16px',
                          background: 'var(--surface-subtle, #F0F0F2)',
                          minHeight: '44px',
                          flexWrap: 'wrap',
                          transition: 'background 0.15s ease'
                        }}
                      >
                        {/* Title & Concept Count */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '180px', flex: '1 1 200px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text)' }}>
                            {chapter.name}
                          </span>
                          <span style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>
                            {chapter.concept_count} {chapter.concept_count === 1 ? 'concept' : 'concepts'}
                          </span>
                        </div>

                        {/* Time estimate with inline edit */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isEditingHours ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <input
                                type="number"
                                step="0.5"
                                min="0.5"
                                value={editingHoursVal}
                                onChange={(e) => setEditingHoursVal(e.target.value)}
                                style={{
                                  width: '60px',
                                  padding: '4px 8px',
                                  borderRadius: '8px',
                                  border: '2px solid var(--lime)',
                                  background: 'var(--card)',
                                  color: 'var(--text)',
                                  fontFamily: 'inherit',
                                  fontWeight: 600,
                                  fontSize: '13px'
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
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: '4px' }}
                                aria-label="Save hours"
                              >
                                <Check size={16} strokeWidth={2.4} />
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
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                color: 'var(--text)',
                                fontSize: '13px',
                                fontWeight: 600,
                                padding: '4px 8px',
                                borderRadius: '8px'
                              }}
                              title="Click to edit estimated study hours"
                            >
                              <Clock size={14} color="var(--muted)" />
                              <span>{chapter.est_hours || 1}h</span>
                              <Edit2 size={12} color="var(--muted)" style={{ opacity: 0.6 }} />
                            </button>
                          )}
                        </div>

                        {/* Difficulty Pill (Easy/Medium/Hard) */}
                        <div>
                          <span
                            className="pill"
                            style={{
                              background: difficultyBgs[chapter.difficulty ?? 1] || difficultyBgs[1],
                              color: difficultyColors[chapter.difficulty ?? 1] || difficultyColors[1],
                              fontSize: '11px',
                              fontWeight: 700,
                              padding: '3px 10px'
                            }}
                          >
                            {difficultyLabels[chapter.difficulty ?? 1] || 'Medium'}
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div
                          style={{
                            width: '90px',
                            height: '6px',
                            background: 'rgba(17, 17, 19, 0.08)',
                            borderRadius: '999px',
                            overflow: 'hidden'
                          }}
                          title={`Status: ${statusLabels[status]}`}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: status === 2 ? '100%' : status === 1 ? '50%' : '8%',
                              background: status === 2 ? 'var(--lime)' : status === 1 ? 'var(--lavender)' : 'rgba(17, 17, 19, 0.15)',
                              borderRadius: '999px',
                              transition: 'width 0.3s ease'
                            }}
                          />
                        </div>

                        {/* "Mark complete" button and status pill */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {status !== 2 && (
                            <button
                              type="button"
                              className="pill"
                              onClick={() => handleUpdateStatus(chapter.id, 2)}
                              style={{
                                background: 'rgba(215, 242, 92, 0.35)',
                                color: '#111113',
                                fontSize: '12px',
                                fontWeight: 700,
                                padding: '6px 12px',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                              title="Mark chapter complete"
                            >
                              <Check size={13} strokeWidth={2.4} />
                              <span>Mark complete</span>
                            </button>
                          )}

                          <button
                            type="button"
                            className="pill"
                            onClick={() => handleCycleStatus(chapter)}
                            style={{
                              background: statusStyle.bg,
                              color: statusStyle.text,
                              fontSize: '12px',
                              fontWeight: 700,
                              padding: '6px 14px',
                              border: 'none',
                              cursor: 'pointer'
                            }}
                            title="Click to cycle status"
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
    </div>
  );
}
