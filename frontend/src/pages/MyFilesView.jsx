import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Folder,
  FileText,
  FileCode,
  Image as ImageIcon,
  Trash2,
  Sparkles,
  BookOpen,
  Clock,
  RotateCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Plus,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { listDocuments, deleteDocument } from '../api/client';
import { deleteLocalFile } from '../utils/fileStore';
import '../styles/planner.css';

export default function MyFilesView({ onToast = () => {} }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const docs = await listDocuments();
      setDocuments(docs || []);
    } catch (err) {
      console.warn('Failed to load documents:', err);
      onToast({ type: 'error', message: 'Could not load files list' });
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleDelete = async (docId) => {
    try {
      await deleteDocument(docId);
      try {
        await deleteLocalFile(user?.id, docId);
      } catch (_) {}
      onToast({ type: 'info', message: 'Document deleted' });
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      setConfirmDeleteId(null);
    } catch (err) {
      onToast({ type: 'error', message: err.message || 'Failed to delete file' });
    }
  };

  const filteredDocs = useMemo(() => {
    if (!searchQuery.trim()) return documents;
    const q = searchQuery.toLowerCase().trim();
    return documents.filter((d) => (d.filename || '').toLowerCase().includes(q));
  }, [documents, searchQuery]);

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
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  const getFileIcon = (fileType = '', filename = '') => {
    const ext = (fileType || filename.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      return (
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'rgba(215, 242, 92, 0.25)',
            color: '#111113',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
          aria-hidden="true"
        >
          <ImageIcon size={18} strokeWidth={2.2} />
        </div>
      );
    }
    if (['txt', 'md'].includes(ext)) {
      return (
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'rgba(183, 169, 242, 0.25)',
            color: '#111113',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
          aria-hidden="true"
        >
          <FileCode size={18} strokeWidth={2.2} />
        </div>
      );
    }
    return (
      <div
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          background: 'rgba(239, 68, 68, 0.12)',
          color: '#DC2626',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}
        aria-hidden="true"
      >
        <FileText size={18} strokeWidth={2.2} />
      </div>
    );
  };

  return (
    <div className="planner-container" style={{ paddingBottom: '40px' }}>
      {/* 1. Page Header */}
      <section className="flux-page-header">
        <div className="flux-page-header-left">
          <h1 className="flux-page-title" style={{ fontSize: '40px', fontWeight: 700, letterSpacing: '-1.5px' }}>
            My Files
          </h1>
          <div className="flux-page-subtitle-row">
            <span className="flux-page-subtitle">
              All uploaded course notes, textbook chapters and study materials
            </span>
          </div>
        </div>

        <div className="flux-page-header-right">
          <span
            className="pill"
            style={{
              background: 'var(--surface-subtle, #F0F0F2)',
              color: 'var(--text)',
              fontSize: '13px',
              fontWeight: 700,
              padding: '8px 16px'
            }}
          >
            {documents.length} {documents.length === 1 ? 'file' : 'files'}
          </span>

          <button
            type="button"
            className="pill"
            onClick={fetchDocuments}
            disabled={loading}
            style={{
              background: 'var(--surface-subtle, #F0F0F2)',
              color: 'var(--text)',
              padding: '8px 14px',
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}
            title="Refresh files list"
            aria-label="Refresh files list"
          >
            <RotateCw size={14} className={loading ? 'spin-animation' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            className="pill card--lime"
            onClick={() => navigate('/notes')}
            style={{ border: 'none', cursor: 'pointer', padding: '8px 18px', fontWeight: 700 }}
          >
            <Plus size={15} strokeWidth={2.4} />
            <span>Upload New</span>
          </button>
        </div>
      </section>

      {/* 2. White Card Listing Files as Rows */}
      <div className="card" style={{ padding: '28px', gap: '18px' }}>
        {/* Search Field if documents exist */}
        {documents.length > 2 && (
          <div style={{ position: 'relative', width: '100%' }}>
            <Search
              size={18}
              style={{
                position: 'absolute',
                left: 16,
                top: '50%',
                transform: 'translateY(-50)',
                color: 'var(--muted)'
              }}
            />
            <input
              type="search"
              placeholder="Search uploaded files by name..."
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
              aria-label="Search uploaded files"
            />
          </div>
        )}

        {/* Empty State */}
        {documents.length === 0 && !loading ? (
          <div style={{ padding: '56px 24px', textAlign: 'center', background: 'var(--surface-subtle, #F0F0F2)', borderRadius: '20px' }}>
            <Folder size={44} color="var(--muted)" style={{ margin: '0 auto 12px', opacity: 0.5 }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
              No files uploaded yet
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--muted)', margin: '0 0 18px' }}>
              Drag & drop course notes, lecture PDFs or photos to start learning.
            </p>
            <button
              type="button"
              className="pill card--lime"
              onClick={() => navigate('/notes')}
              style={{ border: 'none', cursor: 'pointer', padding: '10px 24px', fontWeight: 700, fontSize: '14px' }}
            >
              Upload Your First File
            </button>
          </div>
        ) : filteredDocs.length === 0 ? (
          <div style={{ padding: '36px', textAlign: 'center', color: 'var(--muted)' }}>
            No files matched "{searchQuery}".
          </div>
        ) : (
          /* File Rows */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }} role="list">
            {filteredDocs.map((doc) => {
              const isDeleting = confirmDeleteId === doc.id;
              const isProcessing = doc.status === 'processing';
              const isFailed = doc.status === 'failed';

              return (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  className="my-files-row"
                  onClick={() => navigate(`/files/${doc.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/files/${doc.id}`);
                    }
                  }}
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
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease'
                  }}
                  aria-label={`Open file dashboard for ${doc.filename}`}
                >
                  {/* Left: File-type Icon + Filename with ellipsis */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      flex: '1 1 240px',
                      minWidth: 0
                    }}
                  >
                    {getFileIcon(doc.file_type, doc.filename)}
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span
                        style={{
                          fontSize: '15px',
                          fontWeight: 700,
                          color: 'var(--text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={doc.filename}
                      >
                        {doc.filename}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={11} />
                        <span>{formatDate(doc.created_at)}</span>
                      </span>
                    </div>
                  </div>

                  {/* Middle: Concept Count & Page Count */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexShrink: 0 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                      <Sparkles size={14} color="#B7A9F2" />
                      <span>{doc.concept_count || 0} concepts</span>
                    </div>

                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '13px', fontWeight: 500, color: 'var(--muted)' }}>
                      <BookOpen size={14} />
                      <span>{doc.page_count || 1} {doc.page_count === 1 ? 'page' : 'pages'}</span>
                    </div>
                  </div>

                  {/* Right: Status Pill, Delete Button & Chevron */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                    {isProcessing ? (
                      <span
                        className="pill"
                        style={{
                          background: 'rgba(183, 169, 242, 0.25)',
                          color: '#111113',
                          fontSize: '11px',
                          fontWeight: 700
                        }}
                      >
                        {doc.progress || 10}%
                      </span>
                    ) : isFailed ? (
                      <span
                        className="pill"
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          color: '#DC2626',
                          fontSize: '11px',
                          fontWeight: 700,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <AlertCircle size={12} />
                        <span>Failed</span>
                      </span>
                    ) : (
                      <span
                        className="pill card--lime"
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '4px 10px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <CheckCircle2 size={12} />
                        <span>Ready</span>
                      </span>
                    )}

                    {!isDeleting ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(doc.id);
                        }}
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
                        title={`Delete ${doc.filename}`}
                        aria-label={`Delete ${doc.filename}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    ) : (
                      <div
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="pill"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(doc.id);
                          }}
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
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
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

                    <ChevronRight size={18} color="var(--muted)" style={{ flexShrink: 0, marginLeft: '2px' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
