import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  CheckCircle,
  Clock,
  TrendingUp,
  AlertCircle,
  RotateCcw,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getDocument,
  getDocumentConcepts,
  listDocuments,
  deleteDocument,
  renameDocument,
  reanalyzeDocument,
  getDashboardBootstrap
} from '../api/client';
import { StatCard, DotMatrixStreakCard } from '../components/ui';
import CourseStatusCard from '../components/planner/CourseStatusCard';
import RelatedTopicsCard from '../components/planner/RelatedTopicsCard';
import UnifiedResultsPanel from '../components/results/UnifiedResultsPanel';
import AskAnswerCard from '../components/results/AskAnswerCard';
import BookshelfLoader from '../components/ui/BookshelfLoader';
import '../styles/planner.css';
import '../styles/results-panel.css';

export default function FileDashboardView({ onToast = () => {} }) {
  const { fileId } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const [documentData, setDocumentData] = useState(null);
  const [concepts, setConcepts] = useState([]);
  const [topics, setTopics] = useState([]);
  const [allDocuments, setAllDocuments] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isAskOpen, setIsAskOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  // Load document data and concepts
  const loadData = useCallback(async () => {
    if (!fileId) return;
    setLoading(true);
    setError(null);
    try {
      const [docRes, conceptsRes, docsRes, bootRes] = await Promise.allSettled([
        getDocument(fileId),
        getDocumentConcepts(fileId),
        listDocuments(),
        getDashboardBootstrap()
      ]);

      if (docRes.status === 'fulfilled' && docRes.value) {
        setDocumentData(docRes.value);
      } else {
        setError({ type: 'not_found', message: 'File not found' });
        setLoading(false);
        return;
      }

      if (conceptsRes.status === 'fulfilled' && conceptsRes.value) {
        const cVal = conceptsRes.value;
        const loadedConcepts = Array.isArray(cVal) ? cVal : (cVal.concepts || []);
        const loadedTopics = Array.isArray(cVal.topics) ? cVal.topics : [];
        setConcepts(loadedConcepts);
        setTopics(loadedTopics);
      } else {
        setConcepts([]);
        setTopics([]);
      }

      if (docsRes.status === 'fulfilled' && Array.isArray(docsRes.value)) {
        setAllDocuments(docsRes.value);
      }

      if (bootRes.status === 'fulfilled' && bootRes.value?.overview) {
        setOverview(bootRes.value.overview);
      }
    } catch (err) {
      setError({ type: 'error', message: err.message || 'Failed to load file data' });
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle document deletion
  const handleDeleteDoc = async (id) => {
    try {
      await deleteDocument(id);
      onToast({ type: 'info', message: 'Document removed' });
      navigate('/my-files');
    } catch (err) {
      onToast({ type: 'error', message: err.message || 'Failed to delete document' });
    }
  };

  // Handle document rename
  const handleRenameDoc = async (id, newTitle) => {
    try {
      await renameDocument(id, newTitle);
      setDocumentData((prev) => (prev ? { ...prev, filename: newTitle } : prev));
      onToast({ type: 'success', message: 'Document title updated' });
    } catch (err) {
      onToast({ type: 'error', message: err.message || 'Failed to rename document' });
    }
  };

  // Handle re-analyze / retry
  const handleReanalyzeDoc = async () => {
    if (!fileId || isRetrying) return;
    setIsRetrying(true);
    onToast({ type: 'info', message: 'Re-analyzing document concepts...' });
    try {
      await reanalyzeDocument(fileId);
      await loadData();
      onToast({ type: 'success', message: 'Extraction completed!' });
    } catch (err) {
      onToast({ type: 'error', message: err.message || 'Retry failed' });
    } finally {
      setIsRetrying(false);
    }
  };

  // Target book from overview corresponding to this file
  const targetBook = useMemo(() => {
    return overview?.books?.find((b) => String(b.id) === String(fileId));
  }, [overview, fileId]);

  const targetChapters = useMemo(() => {
    return targetBook?.chapters || [];
  }, [targetBook]);

  // 1 File = 1 Chapter Model: Total files uploaded by user (y)
  const totalFilesCount = useMemo(() => {
    return Math.max(1, allDocuments.length || (overview?.books?.length || 1));
  }, [allDocuments, overview]);

  // Concepts count for this file (x)
  const fileConceptsCount = concepts.length > 0 ? concepts.length : (documentData?.concept_count || 0);

  // Studied concepts count in this file
  const studiedConceptsCount = useMemo(() => {
    return concepts.filter((c) => c.status === 'studied').length;
  }, [concepts]);

  // Is this specific file completed (consisting of x concepts)?
  const isCurrentFileDone = useMemo(() => {
    if (concepts.length > 0 && studiedConceptsCount === concepts.length) return true;
    if (targetBook?.mastery_pct !== undefined && targetBook.mastery_pct >= 100) return true;
    if (targetChapters.length > 0 && targetChapters.every((ch) => ch.status === 2 || ch.completed)) return true;
    return false;
  }, [concepts, studiedConceptsCount, targetBook, targetChapters]);

  // Completed chapters count across user's uploaded files (k / y)
  const completedChaptersCount = useMemo(() => {
    const currentCompleted = isCurrentFileDone ? 1 : 0;
    const otherCompleted = (overview?.books || [])
      .filter((b) => String(b.id) !== String(fileId))
      .filter((b) => {
        if (b.mastery_pct !== undefined && b.mastery_pct >= 100) return true;
        if (b.chapters && b.chapters.length > 0) {
          return b.chapters.every((ch) => ch.status === 2 || ch.completed);
        }
        return false;
      }).length;
    return Math.min(totalFilesCount, currentCompleted + otherCompleted);
  }, [isCurrentFileDone, overview, fileId, totalFilesCount]);

  // File mastery percentage
  const fileMastery = useMemo(() => {
    if (concepts.length > 0) {
      return Math.round((studiedConceptsCount / concepts.length) * 100);
    }
    if (targetBook?.mastery_pct !== undefined) return Math.round(targetBook.mastery_pct);
    if (targetBook?.mastery_percent !== undefined) return Math.round(targetBook.mastery_percent);
    return 0;
  }, [concepts, studiedConceptsCount, targetBook]);

  // Study time left for this file only (matches chapter estimation in main dashboard)
  const studyTimeLeft = useMemo(() => {
    if (isCurrentFileDone) return 0;
    if (targetChapters.length > 0) {
      const rem = targetChapters.reduce((sum, ch) => {
        if (ch.status === 2 || ch.status === 'completed') return sum;
        return sum + (Number(ch.estimated_hours) || 1.5);
      }, 0);
      if (rem > 0) return Number(rem.toFixed(1));
    }
    let minutes = 0;
    concepts.forEach((c) => {
      if (c.status === 'studied') return;
      const imp = Math.max(1, Math.min(3, Number(c.importance) || 2));
      const dLen = (c.definition || '').length;
      minutes += 4 + imp * 3 + Math.min(8, Math.floor(dLen / 30));
    });
    if (minutes > 0) {
      return Number((minutes / 60).toFixed(1));
    }
    return 0;
  }, [targetChapters, concepts, isCurrentFileDone]);

  // Loading skeleton
  if (loading && !documentData) {
    return (
      <div className="planner-container" style={{ paddingBottom: '60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className="pill"
            onClick={() => navigate('/my-files')}
            style={{
              background: 'var(--surface-subtle, #F0F0F2)',
              color: 'var(--text)',
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 14px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            ← My Files
          </button>
        </div>
        <div style={{ padding: '60px 20px', display: 'flex', justifyContent: 'center' }}>
          <BookshelfLoader message="Loading document details & extraction..." />
        </div>
      </div>
    );
  }

  // Not found state
  if (error?.type === 'not_found' || !documentData) {
    return (
      <div className="planner-container" style={{ paddingBottom: '60px' }}>
        <div className="card" style={{ padding: '48px 24px', textAlign: 'center', borderRadius: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
            File Not Found
          </h2>
          <p style={{ fontSize: '14px', color: 'var(--muted)', margin: '0 0 20px' }}>
            The requested document could not be located or may have been deleted.
          </p>
          <button
            type="button"
            className="pill card--lime"
            onClick={() => navigate('/my-files')}
            style={{ padding: '10px 24px', fontWeight: 700, border: 'none', cursor: 'pointer', margin: '0 auto' }}
          >
            ← Back to My Files
          </button>
        </div>
      </div>
    );
  }

  // Processing state
  if (documentData.status === 'processing') {
    return (
      <div className="planner-container" style={{ paddingBottom: '60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className="pill"
            onClick={() => navigate('/my-files')}
            style={{
              background: 'var(--surface-subtle, #F0F0F2)',
              color: 'var(--text)',
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 14px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            ← My Files
          </button>
          <span style={{ color: 'var(--muted)', fontSize: '13px' }}>/</span>
          <span style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 600 }}>{documentData.filename}</span>
        </div>

        <div className="card" style={{ padding: '48px 24px', textAlign: 'center', borderRadius: '24px' }}>
          <div style={{ maxWidth: '400px', margin: '0 auto' }}>
            <Clock size={40} color="var(--lime, #D7F25C)" style={{ margin: '0 auto 16px' }} />
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>
              Extraction in progress
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--muted)', margin: '0 0 20px' }}>
              {documentData.stage_message || 'Analyzing notes, concepts and page structures...'}
            </p>
            <div
              style={{
                width: '100%',
                height: '8px',
                background: 'var(--surface-subtle, #F0F0F2)',
                borderRadius: '999px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${documentData.progress || 25}%`,
                  height: '100%',
                  background: '#111113',
                  borderRadius: '999px',
                  transition: 'width 0.3s ease'
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Failed state
  if (documentData.status === 'failed') {
    return (
      <div className="planner-container" style={{ paddingBottom: '60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            className="pill"
            onClick={() => navigate('/my-files')}
            style={{
              background: 'var(--surface-subtle, #F0F0F2)',
              color: 'var(--text)',
              fontSize: '12px',
              fontWeight: 600,
              padding: '6px 14px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            ← My Files
          </button>
          <span style={{ color: 'var(--muted)', fontSize: '13px' }}>/</span>
          <span style={{ color: 'var(--text)', fontSize: '13px', fontWeight: 600 }}>{documentData.filename}</span>
        </div>

        <div className="card" style={{ padding: '48px 24px', textAlign: 'center', borderRadius: '24px' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#DC2626',
              padding: '10px 20px',
              borderRadius: '9999px',
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '16px'
            }}
          >
            <AlertCircle size={16} />
            <span>{documentData.error || 'Failed to extract concepts from this document'}</span>
          </div>
          <div>
            <button
              type="button"
              className="pill card--lime"
              onClick={handleReanalyzeDoc}
              disabled={isRetrying}
              style={{
                padding: '10px 24px',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <RotateCcw size={14} className={isRetrying ? 'spin-animation' : ''} />
              <span>Retry Extraction</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="planner-container" style={{ paddingBottom: '60px' }}>
      {/* 1. Breadcrumbs */}
      <div
        className="file-breadcrumb-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '8px',
          flexWrap: 'wrap'
        }}
      >
        <button
          type="button"
          className="pill"
          onClick={() => navigate('/my-files')}
          style={{
            background: 'var(--surface-subtle, #F0F0F2)',
            color: 'var(--text)',
            fontSize: '12px',
            fontWeight: 600,
            padding: '6px 14px',
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px'
          }}
          aria-label="Back to My Files"
        >
          <ArrowLeft size={13} />
          <span>My Files</span>
        </button>
        <span style={{ color: 'var(--muted)', fontSize: '13px' }}>/</span>
        <span
          style={{
            color: 'var(--text)',
            fontSize: '13px',
            fontWeight: 600,
            maxWidth: '380px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={documentData.filename}
        >
          {documentData.filename}
        </span>
      </div>

      {/* 2. Title Row (large filename title, muted line, lime Ready pill, black This file only pill) */}
      <section className="flux-page-header">
        <div className="flux-page-header-left">
          <h1
            className="flux-page-title"
            style={{
              wordBreak: 'break-word',
              maxWidth: '850px'
            }}
          >
            {documentData.filename}
          </h1>
          <div className="flux-page-subtitle-row">
            <span className="flux-page-subtitle">
              This file only · {fileConceptsCount} {fileConceptsCount === 1 ? 'concept' : 'concepts'} · 1 chapter · {(documentData.file_type || 'PDF').toUpperCase()}
            </span>
          </div>
        </div>

        <div className="flux-page-header-right">
          <div
            className="flux-today-pill"
            style={{
              background: 'var(--lime, #D7F25C)',
              color: '#111113'
            }}
          >
            <span>Ready</span>
          </div>
          <div
            className="flux-core-curriculum-pill"
            style={{
              background: '#111113',
              color: '#FFFFFF',
              cursor: 'default'
            }}
          >
            <span>This file only</span>
          </div>
        </div>
      </section>

      {/* 3. 4 Stat Cards for This File Only */}
      <section className="flux-stat-grid" aria-label="File Progress Statistics">
        <StatCard
          label="Concepts"
          value={fileConceptsCount}
          icon={Sparkles}
          iconColor="#111113"
          iconBg="#D7F25C"
          progress={100}
          progressColor="var(--text)"
          contextText="Extracted from this file"
        />

        <StatCard
          label="Chapters Done"
          value={`${completedChaptersCount} / ${totalFilesCount}`}
          icon={CheckCircle}
          iconColor="#111113"
          iconBg="#B7A9F2"
          progress={totalFilesCount > 0 ? (completedChaptersCount / totalFilesCount) * 100 : 0}
          progressColor="#B7A9F2"
          contextText={
            completedChaptersCount >= totalFilesCount
              ? `All ${totalFilesCount} ${totalFilesCount === 1 ? 'chapter' : 'chapters'} completed`
              : `${Math.max(0, totalFilesCount - completedChaptersCount)} ${totalFilesCount - completedChaptersCount === 1 ? 'chapter' : 'chapters'} remaining`
          }
        />

        <StatCard
          label="Study Time Left"
          value={studyTimeLeft}
          unit="h"
          icon={Clock}
          iconColor="#111113"
          iconBg="#E6E6E8"
          progress={fileMastery}
          progressColor="#D7F25C"
          contextText="For this file only"
        />

        <StatCard
          label="Mastery"
          value={fileMastery}
          unit="%"
          icon={TrendingUp}
          iconColor="#111113"
          iconBg="#D7F25C"
          progress={fileMastery}
          progressColor="#B7A9F2"
          contextText="This file's milestones"
        />
      </section>

      {/* 4. Row: Day N of 7 (Study plan for this file) + Study Consistency (this file only) */}
      <section
        className="flux-row-2-grid"
        aria-label="Course Pacing and Consistency"
        style={{ marginBottom: '24px' }}
      >
        <CourseStatusCard
          activePlan={overview?.active_plan}
          planStatus={overview?.plan_status}
          totalChapters={1}
          doneChapters={isCurrentFileDone ? 1 : 0}
          subtitle="Study plan for this file"
        />
        <DotMatrixStreakCard
          score={9.2}
          maxScore={10}
          streakDays={5}
          subtitle="5-day streak active · this file only"
        />
      </section>

      {/* 5. Related Topics & Learning Clusters for this specific file */}
      <section className="flux-related-topics-row" style={{ width: '100%', marginBottom: '24px' }}>
        <RelatedTopicsCard
          concepts={concepts}
          fileTitle={documentData?.filename}
          activePlan={overview?.active_plan}
          onOpenConceptInResults={() => {}}
        />
      </section>

      {/* 6. Extraction Workspace as one large white card (radius 24px, padding 28px) */}
      <div
        className="card"
        style={{
          padding: '28px',
          borderRadius: '24px',
          overflow: 'hidden',
          minWidth: 0,
          background: 'var(--surface-card, #FFFFFF)'
        }}
      >
        <UnifiedResultsPanel
          documentData={documentData}
          concepts={concepts}
          topics={topics}
          documents={allDocuments}
          onSelectDoc={(id) => navigate(`/files/${id}`)}
          onDeleteDocument={handleDeleteDoc}
          onRenameDocument={handleRenameDoc}
          chapterCount={1}
          isLoading={false}
          onToast={onToast}
          onProgressChange={loadData}
          initialTab="concepts"
        />
      </div>

      {/* Floating Ask Your Notes Button & Drawer */}
      <button
        type="button"
        className="floating-ask-btn"
        onClick={() => setIsAskOpen(true)}
        aria-label="Ask your notes with Graph RAG"
      >
        <Sparkles size={18} />
        <span>Ask your notes</span>
      </button>

      {isAskOpen && (
        <div className="floating-ask-drawer-scrim" onClick={() => setIsAskOpen(false)}>
          <div
            className="floating-ask-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Ask Your Notes"
          >
            <div className="floating-ask-header">
              <div className="floating-ask-title">
                <Sparkles size={20} color="var(--brand, #9AE62E)" />
                <h3>Ask your notes</h3>
              </div>
              <button
                type="button"
                className="floating-ask-close"
                onClick={() => setIsAskOpen(false)}
                aria-label="Close ask panel"
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '16px' }}>
              <AskAnswerCard
                documentId={fileId}
                initialQuestion=""
                isAuthenticated={isAuthenticated}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
