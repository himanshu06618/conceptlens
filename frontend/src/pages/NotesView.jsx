import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileText,
  Plus,
  Search,
  Pin,
  Trash2,
  Check,
  RotateCcw,
  Download,
  Eye,
  Edit3,
  X,
  ArrowLeft,
  Link as LinkIcon,
  BookOpen,
  LayoutDashboard,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { 
  listNotes, 
  getNote, 
  createNote, 
  updateNote, 
  deleteNote,
  listDocuments
} from '../api/client';
import '../styles/notes.css';

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

/**
 * Safe, sanitised markdown & formatted text renderer using pure React elements.
 * Never uses dangerouslySetInnerHTML, completely immune to XSS.
 */
function SafeMarkdownViewer({ content = '' }) {
  if (!content || !content.trim()) {
    return <p style={{ color: 'var(--planner-text-muted)', fontStyle: 'italic' }}>No content to preview.</p>;
  }

  const lines = content.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeBlockLines = [];

  lines.forEach((line, index) => {
    // Code block toggle
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${index}`}>
            <code>{codeBlockLines.join('\n')}</code>
          </pre>
        );
        codeBlockLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      return;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      return;
    }

    // Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={index}>{line.slice(2)}</h1>);
      return;
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={index}>{line.slice(3)}</h2>);
      return;
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={index}>{line.slice(4)}</h3>);
      return;
    }

    // Bullet points
    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      elements.push(
        <ul key={index}>
          <li>{line.trim().slice(2)}</li>
        </ul>
      );
      return;
    }

    // Blank line
    if (!line.trim()) {
      elements.push(<div key={index} style={{ height: '8px' }} />);
      return;
    }

    // Regular paragraph
    elements.push(<p key={index}>{line}</p>);
  });

  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <pre key="code-end">
        <code>{codeBlockLines.join('\n')}</code>
      </pre>
    );
  }

  return <div className="notes-preview-container">{elements}</div>;
}

const COLOR_OPTIONS = [
  { id: '', label: 'Default', class: 'dot-default' },
  { id: 'mint', label: 'Mint', class: 'dot-mint' },
  { id: 'peach', label: 'Peach', class: 'dot-peach' },
  { id: 'purple', label: 'Purple', class: 'dot-purple' },
  { id: 'blue', label: 'Blue', class: 'dot-blue' },
  { id: 'coral', label: 'Coral', class: 'dot-coral' },
  { id: 'lemon', label: 'Lemon', class: 'dot-lemon' },
];

export default function NotesView({ onToast = () => {} }) {
  const { user, isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Notes list state
  const [notes, setNotes] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingList, setLoadingList] = useState(true);

  // Filters state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [filterPinned, setFilterPinned] = useState(false);

  // Active note in editor
  const [activeNote, setActiveNote] = useState(null);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorTags, setEditorTags] = useState([]);
  const [editorColor, setEditorColor] = useState('');
  const [editorPinned, setEditorPinned] = useState(false);
  const [editorDocId, setEditorDocId] = useState('');
  const [editorChapter, setEditorChapter] = useState('');
  const [newTagInput, setNewTagInput] = useState('');

  // Mode toggles
  const [viewMode, setViewMode] = useState('edit'); // 'edit' | 'preview'
  const [mobilePane, setMobilePane] = useState('list'); // 'list' | 'editor'

  // Autosave status: 'saved' | 'saving' | 'error' | 'idle'
  const [autosaveStatus, setAutosaveStatus] = useState('idle');
  const autosaveTimerRef = useRef(null);

  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // User uploaded documents for linking
  const [userDocs, setUserDocs] = useState([]);

  // Check guest / auth status
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      openAuthModal('signin', 'Sign in to create, organize, and access your study notes.');
    }
  }, [isAuthenticated, authLoading, openAuthModal]);

  // Load uploaded documents for the link-to dropdown
  useEffect(() => {
    if (isAuthenticated) {
      listDocuments()
        .then((docs) => setUserDocs(docs || []))
        .catch(() => setUserDocs([]));
    }
  }, [isAuthenticated]);

  // Fetch notes from backend
  const fetchNotes = useCallback(async (selectId = null) => {
    if (!isAuthenticated) {
      setNotes([]);
      setLoadingList(false);
      return;
    }

    try {
      setLoadingList(true);
      const data = await listNotes({
        search: searchQuery.trim(),
        tag: selectedTag,
        pinned: filterPinned ? true : null,
        limit: 100,
        page: 1,
      });

      const items = data.items || [];
      setNotes(items);
      setTotalCount(data.total || 0);

      // Select active note
      if (selectId) {
        const found = items.find((n) => n.id === selectId);
        if (found) {
          selectNote(found);
        } else {
          // Try fetching by ID directly
          try {
            const single = await getNote(selectId);
            selectNote(single);
          } catch {
            if (items.length > 0) selectNote(items[0]);
          }
        }
      } else if (!activeNote && items.length > 0 && mobilePane !== 'editor') {
        selectNote(items[0]);
      }
    } catch (err) {
      console.error('Failed to load notes:', err);
    } finally {
      setLoadingList(false);
    }
  }, [isAuthenticated, searchQuery, selectedTag, filterPinned]);

  // Debounced fetch on search or filters
  useEffect(() => {
    const timer = setTimeout(() => {
      const urlId = searchParams.get('id');
      fetchNotes(urlId);
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchNotes, searchParams]);

  // Handle URL params on initial mount
  useEffect(() => {
    if (searchParams.get('new') === 'true') {
      handleCreateNewNote();
      setSearchParams({});
    }
  }, [searchParams]);

  // Select a note for editing
  const selectNote = (note) => {
    if (!note) return;
    setActiveNote(note);
    setEditorTitle(note.title || '');
    setEditorContent(note.content || '');
    setEditorTags(Array.isArray(note.tags) ? note.tags : []);
    setEditorColor(note.color || '');
    setEditorPinned(Boolean(note.pinned));
    setEditorDocId(note.document_id || '');
    setEditorChapter(note.chapter || '');
    setAutosaveStatus('saved');
    setMobilePane('editor');
  };

  // Collect all unique tags across loaded notes for filter chips
  const allUniqueTags = useMemo(() => {
    const set = new Set();
    notes.forEach((n) => {
      if (Array.isArray(n.tags)) {
        n.tags.forEach((t) => {
          if (t && t.trim()) set.add(t.trim());
        });
      }
    });
    return Array.from(set);
  }, [notes]);

  // Autosave trigger function (debounced 800ms)
  const triggerAutosave = useCallback((updatedFields) => {
    if (!activeNote || !activeNote.id) return;

    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
    }

    setAutosaveStatus('saving');

    autosaveTimerRef.current = setTimeout(async () => {
      try {
        const savedNote = await updateNote(activeNote.id, updatedFields);
        setAutosaveStatus('saved');
        setActiveNote(savedNote);

        // Update item in local list smoothly
        setNotes((prev) =>
          prev.map((n) => (n.id === savedNote.id ? savedNote : n))
        );
      } catch (err) {
        console.error('Autosave error:', err);
        setAutosaveStatus('error');
      }
    }, 800);
  }, [activeNote]);

  // Field change handlers with autosave
  const handleTitleChange = (val) => {
    if (val.length > 150) return;
    setEditorTitle(val);
    triggerAutosave({ title: val });
  };

  const handleContentChange = (val) => {
    if (val.length > 20000) return;
    setEditorContent(val);
    triggerAutosave({ content: val });
  };

  const handleTogglePinned = () => {
    const next = !editorPinned;
    setEditorPinned(next);
    triggerAutosave({ pinned: next });
  };

  const handleColorChange = (colId) => {
    setEditorColor(colId);
    triggerAutosave({ color: colId });
  };

  const handleDocChange = (docId) => {
    setEditorDocId(docId);
    triggerAutosave({ document_id: docId || null });
  };

  const handleChapterChange = (chapterName) => {
    setEditorChapter(chapterName);
    triggerAutosave({ chapter: chapterName });
  };

  const handleAddTag = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = newTagInput.trim().replace(/^#/, '');
      if (!tag) return;
      if (tag.length > 30) {
        if (onToast) onToast('Tag cannot exceed 30 characters.', 'warning');
        return;
      }
      if (editorTags.length >= 10) {
        if (onToast) onToast('A note can have at most 10 tags.', 'warning');
        return;
      }
      if (!editorTags.includes(tag)) {
        const nextTags = [...editorTags, tag];
        setEditorTags(nextTags);
        setNewTagInput('');
        triggerAutosave({ tags: nextTags });
      } else {
        setNewTagInput('');
      }
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    const nextTags = editorTags.filter((t) => t !== tagToRemove);
    setEditorTags(nextTags);
    triggerAutosave({ tags: nextTags });
  };

  // Create new note
  const handleCreateNewNote = async () => {
    if (!isAuthenticated) {
      openAuthModal('signin', 'Sign in to create a personal study note.');
      return;
    }

    try {
      const newNote = await createNote({
        title: '',
        content: '',
        tags: selectedTag ? [selectedTag] : [],
        pinned: filterPinned,
      });

      setNotes((prev) => [newNote, ...prev]);
      setTotalCount((prev) => prev + 1);
      selectNote(newNote);
    } catch (err) {
      if (onToast) onToast(err.message || 'Failed to create note', 'error');
    }
  };

  // Delete note
  const confirmDeleteNote = async () => {
    if (!activeNote) return;
    setIsDeleting(true);
    try {
      await deleteNote(activeNote.id);
      const remaining = notes.filter((n) => n.id !== activeNote.id);
      setNotes(remaining);
      setTotalCount((prev) => Math.max(0, prev - 1));
      setShowDeleteModal(false);

      if (remaining.length > 0) {
        selectNote(remaining[0]);
      } else {
        setActiveNote(null);
        setMobilePane('list');
      }

      if (onToast) onToast('Note deleted', 'info');
    } catch (err) {
      if (onToast) onToast(err.message || 'Failed to delete note', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  // Export note as .txt or .md file
  const handleExportNote = (format = 'md') => {
    if (!activeNote) return;
    const title = (editorTitle || 'Untitled Note').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${title}.${format}`;
    const fileContent = format === 'md'
      ? `# ${editorTitle || 'Untitled Note'}\n\n${editorTags.length > 0 ? `Tags: ${editorTags.map(t => `#${t}`).join(' ')}\n\n` : ''}${editorContent}`
      : `${editorTitle || 'Untitled Note'}\n\n${editorContent}`;

    const blob = new Blob([fileContent], { type: format === 'md' ? 'text/markdown' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (onToast) onToast(`Exported as ${filename}`, 'success');
  };

  // Compute word and character count
  const wordCount = useMemo(() => {
    if (!editorContent.trim()) return 0;
    return editorContent.trim().split(/\s+/).length;
  }, [editorContent]);

  const charCount = editorContent.length;

  return (
    <div className="notes-page-container">
      {/* Top Breadcrumb Navigation */}
      <div className="notes-top-bar">
        <div className="notes-breadcrumb">
          <button
            type="button"
            className="notes-breadcrumb-back"
            onClick={() => navigate(user?.role === 'teacher' ? '/teacher/dashboard' : '/student/dashboard')}
            aria-label="Back to Study Planner Dashboard"
          >
            <LayoutDashboard size={15} />
            <span>Dashboard</span>
          </button>
          <span className="notes-breadcrumb-sep">/</span>
          <span className="notes-breadcrumb-current">My Study Notes</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="notes-new-btn-primary"
            onClick={handleCreateNewNote}
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>New Note</span>
          </button>
        </div>
      </div>

      {/* Main Two-Pane Layout */}
      <div className={`notes-view-layout mobile-mode show-${mobilePane}`}>
        {/* Left Pane: Searchable Notes List */}
        <div className="notes-list-pane">
          <div className="notes-pane-header">
            <h2 className="notes-pane-title">
              <FileText size={19} color="var(--planner-mint)" />
              <span>Notes</span>
              <span className="notes-count-badge">{totalCount}</span>
            </h2>
          </div>

          {/* Search Box */}
          <div className="notes-search-wrap">
            <Search size={15} className="notes-search-icon" />
            <input
              type="text"
              className="notes-search-input"
              placeholder="Search title, content, #tags…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search notes"
            />
            {searchQuery && (
              <button
                type="button"
                className="notes-search-clear"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filters Row */}
          <div className="notes-filters-row" role="group" aria-label="Filter notes">
            <button
              type="button"
              className={`notes-filter-chip ${!filterPinned && !selectedTag ? 'active' : ''}`}
              onClick={() => {
                setFilterPinned(false);
                setSelectedTag('');
              }}
            >
              All
            </button>

            <button
              type="button"
              className={`notes-filter-chip ${filterPinned ? 'active' : ''}`}
              onClick={() => setFilterPinned((prev) => !prev)}
            >
              <Pin size={11} fill={filterPinned ? 'currentColor' : 'none'} />
              <span>Pinned</span>
            </button>

            {allUniqueTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={`notes-filter-chip ${selectedTag === tag ? 'active' : ''}`}
                onClick={() => setSelectedTag((prev) => (prev === tag ? '' : tag))}
              >
                #{tag}
              </button>
            ))}
          </div>

          {/* Scrollable list */}
          <div className="notes-scroll-list" role="list">
            {loadingList ? (
              <div className="my-notes-skeleton-list">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="my-notes-skeleton-item">
                    <div className="my-notes-skeleton-line short" />
                    <div className="my-notes-skeleton-line" />
                  </div>
                ))}
              </div>
            ) : notes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--planner-text-muted)' }}>
                <p style={{ margin: '0 0 12px', fontSize: '0.92rem' }}>
                  {searchQuery || selectedTag || filterPinned
                    ? 'No notes match your active filters.'
                    : 'No notes yet. Write your first note to start building your study notebook.'}
                </p>
                <button
                  type="button"
                  className="my-notes-new-btn"
                  onClick={handleCreateNewNote}
                  style={{ margin: '0 auto' }}
                >
                  <Plus size={13} />
                  <span>Create note</span>
                </button>
              </div>
            ) : (
              notes.map((note) => {
                const isSelected = activeNote && activeNote.id === note.id;
                const noteTitle = note.title ? note.title.trim() : 'Untitled Note';
                const preview = note.content ? note.content.slice(0, 90).trim() : 'No content…';

                return (
                  <div
                    key={note.id}
                    role="listitem"
                    tabIndex={0}
                    className={`notes-card-item ${isSelected ? 'selected' : ''} ${note.color ? `color-${note.color}` : ''}`}
                    onClick={() => selectNote(note)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectNote(note);
                      }
                    }}
                  >
                    <div className="notes-card-item-top">
                      <span className="notes-card-item-title">{noteTitle}</span>
                      {note.pinned && (
                        <span className="notes-card-item-pin" title="Pinned">
                          <Pin size={12} fill="currentColor" />
                        </span>
                      )}
                    </div>

                    <p className="notes-card-item-preview">{preview}</p>

                    <div className="notes-card-item-meta">
                      <div className="notes-card-item-tags">
                        {Array.isArray(note.tags) && note.tags.slice(0, 2).map((t, idx) => (
                          <span key={idx} className="notes-item-tag">
                            #{t}
                          </span>
                        ))}
                      </div>
                      <span className="notes-item-time">{formatRelativeTime(note.updated_at)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Pane: Note Editor */}
        <div className="notes-editor-pane">
          {/* Mobile Back Button */}
          <button
            type="button"
            className="notes-mobile-back-btn"
            onClick={() => setMobilePane('list')}
            aria-label="Back to notes list"
          >
            <ArrowLeft size={16} />
            <span>Back to Notes list</span>
          </button>

          {!activeNote ? (
            <div className="notes-empty-selection">
              <div className="notes-empty-selection-icon">
                <FileText size={28} />
              </div>
              <h3 style={{ fontFamily: 'var(--planner-font-title)', fontSize: '1.25rem', margin: '0 0 8px' }}>
                Select a Note
              </h3>
              <p style={{ maxWidth: '320px', margin: '0 auto 18px', fontSize: '0.92rem' }}>
                Choose a note from the left to read and edit, or write a new one to begin your study notes.
              </p>
              <button
                type="button"
                className="notes-new-btn-primary"
                onClick={handleCreateNewNote}
              >
                <Plus size={15} />
                <span>Create New Note</span>
              </button>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="notes-editor-toolbar">
                <div className="notes-editor-toolbar-left">
                  {/* Autosave status indicator */}
                  <span className={`notes-autosave-badge ${autosaveStatus}`}>
                    {autosaveStatus === 'saving' && (
                      <>
                        <RotateCcw size={12} className="spin-icon" />
                        <span>Saving…</span>
                      </>
                    )}
                    {autosaveStatus === 'saved' && (
                      <>
                        <Check size={12} />
                        <span>Saved</span>
                      </>
                    )}
                    {autosaveStatus === 'error' && (
                      <>
                        <AlertCircle size={12} />
                        <span>Couldn't save, retrying</span>
                      </>
                    )}
                  </span>

                  {/* Pin toggle */}
                  <button
                    type="button"
                    className={`notes-tool-btn ${editorPinned ? 'active' : ''}`}
                    onClick={handleTogglePinned}
                    title={editorPinned ? 'Unpin note' : 'Pin note to top'}
                  >
                    <Pin size={13} fill={editorPinned ? 'currentColor' : 'none'} />
                    <span>{editorPinned ? 'Pinned' : 'Pin'}</span>
                  </button>

                  {/* Color dots */}
                  <div className="notes-color-picker" title="Color tag">
                    {COLOR_OPTIONS.map((col) => (
                      <button
                        key={col.id}
                        type="button"
                        aria-label={`Color ${col.label}`}
                        className={`notes-color-dot ${col.class} ${editorColor === col.id ? 'active' : ''}`}
                        onClick={() => handleColorChange(col.id)}
                      />
                    ))}
                  </div>
                </div>

                <div className="notes-editor-toolbar-right">
                  {/* Edit / Preview toggle */}
                  <button
                    type="button"
                    className="notes-tool-btn"
                    onClick={() => setViewMode((prev) => (prev === 'edit' ? 'preview' : 'edit'))}
                    title="Toggle preview"
                  >
                    {viewMode === 'edit' ? (
                      <>
                        <Eye size={13} />
                        <span>Preview</span>
                      </>
                    ) : (
                      <>
                        <Edit3 size={13} />
                        <span>Edit</span>
                      </>
                    )}
                  </button>

                  {/* Export */}
                  <button
                    type="button"
                    className="notes-tool-btn"
                    onClick={() => handleExportNote('md')}
                    title="Export as Markdown (.md)"
                  >
                    <Download size={13} />
                    <span>Export</span>
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    className="notes-tool-btn danger"
                    onClick={() => setShowDeleteModal(true)}
                    title="Delete note"
                    aria-label="Delete note"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Link to Document / Chapter row */}
              <div className="notes-link-row">
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--planner-text-muted)', fontSize: '0.84rem' }}>
                  <LinkIcon size={14} />
                  <span>Link:</span>
                </span>

                <select
                  className="notes-link-select"
                  value={editorDocId}
                  onChange={(e) => handleDocChange(e.target.value)}
                  aria-label="Link to course document"
                >
                  <option value="">No linked document</option>
                  {userDocs.map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.filename}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  className="notes-link-input"
                  placeholder="Chapter name (optional)"
                  value={editorChapter}
                  onChange={(e) => handleChapterChange(e.target.value)}
                  maxLength={100}
                  aria-label="Linked chapter name"
                />
              </div>

              {/* Title input */}
              <input
                type="text"
                className="notes-title-input"
                placeholder="Note Title…"
                value={editorTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                maxLength={150}
                aria-label="Note Title"
              />

              {/* Tags editor */}
              <div className="notes-tags-editor">
                {editorTags.map((tag, idx) => (
                  <span key={idx} className="notes-tag-chip-editable">
                    #{tag}
                    <button
                      type="button"
                      className="notes-tag-remove-btn"
                      onClick={() => handleRemoveTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}

                {editorTags.length < 10 && (
                  <input
                    type="text"
                    className="notes-tag-input-inline"
                    placeholder="+ add tag (Enter)"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    maxLength={30}
                    aria-label="Add tag"
                  />
                )}
              </div>

              {/* Content area: Edit mode (textarea) or Preview mode */}
              <div className="notes-content-wrap">
                {viewMode === 'edit' ? (
                  <textarea
                    className="notes-textarea"
                    placeholder="Write your study notes, formulas, or concepts here (supports markdown headers, bullets, code blocks)…"
                    value={editorContent}
                    onChange={(e) => handleContentChange(e.target.value)}
                    maxLength={20000}
                    aria-label="Note content"
                  />
                ) : (
                  <SafeMarkdownViewer content={editorContent} />
                )}
              </div>

              {/* Bottom status bar */}
              <div className="notes-editor-footer">
                <div className="notes-word-count">
                  <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
                  <span>·</span>
                  <span>{charCount} / 20,000 characters</span>
                </div>

                <span>
                  Last saved: {formatRelativeTime(activeNote.updated_at)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="notes-modal-overlay" role="dialog" aria-modal="true">
          <div className="notes-modal-box">
            <h3 className="notes-modal-title">Delete Note</h3>
            <p className="notes-modal-body">
              Are you sure you want to delete &ldquo;{editorTitle || 'Untitled Note'}&rdquo;? This note will be permanently removed.
            </p>
            <div className="notes-modal-actions">
              <button
                type="button"
                className="notes-modal-cancel-btn"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="notes-modal-confirm-btn"
                onClick={confirmDeleteNote}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
