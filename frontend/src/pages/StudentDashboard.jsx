import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  BookOpen,
  CheckCircle,
  Clock,
  TrendingUp,
  RotateCcw,
  RotateCw,
  Calendar,
  AlertTriangle,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getDisplayName } from '../utils/userUtils';
import {
  getDashboardBootstrap,
  renameDocument,
  updateChapterProgress,
  updateChapterMeta,
  uploadDocument,
  getDocumentStatus,
  getDocument,
  getDocumentConcepts,
  deleteDocument,
  listDocuments
} from '../api/client';
import { getDashboardCache, saveDashboardCache } from '../utils/dashboardCache';

import CourseStatusCard from '../components/planner/CourseStatusCard';
import CompactUploadCard from '../components/planner/CompactUploadCard';
import BookshelfLoader from '../components/ui/BookshelfLoader';
import AskAnswerCard from '../components/results/AskAnswerCard';
import { StatCard, DotMatrixStreakCard } from '../components/ui';
import '../styles/planner.css';
import '../styles/results-panel.css';

export default function StudentDashboard({ onToast = () => {} }) {
  const { user, isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const navigate = useNavigate();

  // Overview data from backend / cache
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState(null);
  const [activeBookId, setActiveBookId] = useState(null);
  const [isAskOpen, setIsAskOpen] = useState(false);

  // Honest server wake-up banner & backoff retry states
  const [showWakingBanner, setShowWakingBanner] = useState(false);
  const [wakingError, setWakingError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const waitingTimerRef = useRef(null);
  const isFetchingBootstrapRef = useRef(false);

  // In-Dashboard Document Upload & Processing State
  const [isUploading, setIsUploading] = useState(false);
  const [processingDoc, setProcessingDoc] = useState(null);
  const [processingStage, setProcessingStage] = useState('reading');
  const [processingProgress, setProcessingProgress] = useState(5);
  const [processingMessage, setProcessingMessage] = useState('Initializing note analysis...');
  const [processingError, setProcessingError] = useState(null);
  const [lastUploadedFile, setLastUploadedFile] = useState(null);
  const pollingRef = useRef(null);
  const progressTimerRef = useRef(null);
  const uploadInFlightRef = useRef(false);
  const completedJobsRef = useRef(new Set());

  // In-Dashboard Document Results Panel State
  const [activeDocId, setActiveDocId] = useState(null);
  const [activeDocData, setActiveDocData] = useState(null);
  const [activeConcepts, setActiveConcepts] = useState([]);
  const [activeTopics, setActiveTopics] = useState([]);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState(null);

  // Uploaded documents list for switching & deletion
  const [documentsList, setDocumentsList] = useState([]);
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(false);

  // Redirect teachers
  useEffect(() => {
    if (user?.role === 'teacher') {
      navigate('/teacher/dashboard');
    }
  }, [user, navigate]);

  // 1. Stale-while-revalidate: read cached dashboard immediately from IndexedDB
  useEffect(() => {
    let isMounted = true;
    if (!user?.id) return;

    getDashboardCache(user.id)
      .then((cached) => {
        if (!isMounted || !cached) return;
        if (cached.overview) {
          setOverview(cached.overview);
          if (cached.overview.subject) {
            setSelectedSubjectId(cached.overview.subject.id);
          }
          if (cached.overview.books?.length > 0) {
            setActiveBookId(cached.overview.books[0].id);
          }
        }
        // Cached data is ready immediately: show instant paint
        setLoading(false);
        setIsUpdating(true);
      })
      .catch((err) => {
        console.warn('Dashboard cache read failed:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // 2. Fetch fresh bootstrap data with honest waking banner & exponential backoff retries
  const loadBootstrap = useCallback(
    async (subId = null, attempt = 0) => {
      if (isFetchingBootstrapRef.current) return;
      isFetchingBootstrapRef.current = true;

      // Start 3-second timer for honest waking banner
      if (attempt === 0) {
        if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
        waitingTimerRef.current = setTimeout(() => {
          setShowWakingBanner(true);
        }, 3000);
      }

      try {
        const data = await getDashboardBootstrap({
          subjectId: subId || selectedSubjectId
        });

        // Backend answered: clear waking timer and banner
        if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
        setShowWakingBanner(false);
        setWakingError(false);
        setRetryCount(0);

        if (data?.overview) {
          setOverview(data.overview);
          if (data.overview.subject) {
            setSelectedSubjectId(data.overview.subject.id);
          }
          if (data.overview.books?.length > 0) {
            if (!activeBookId || !data.overview.books.some((b) => b.id === activeBookId)) {
              setActiveBookId(data.overview.books[0].id);
            }
          } else {
            setActiveBookId(null);
          }
        }

        // Save fresh per-user payload in IndexedDB
        if (user?.id) {
          saveDashboardCache(user.id, data).catch((err) => {
            console.warn('Failed to cache dashboard bootstrap:', err);
          });
        }
      } catch (err) {
        console.error('Failed to load dashboard bootstrap:', err);
        if (attempt < 3) {
          // Auto-retry with backoff: 2s, 4s, 6s
          const backoffMs = (attempt + 1) * 2000;
          setRetryCount(attempt + 1);
          setShowWakingBanner(true);
          setTimeout(() => {
            isFetchingBootstrapRef.current = false;
            loadBootstrap(subId, attempt + 1);
          }, backoffMs);
          return;
        }

        // Retries exhausted
        if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
        setWakingError(true);
        setShowWakingBanner(true);
        onToast({
          type: 'error',
          message: err.message || 'Could not connect to server'
        });
      } finally {
        isFetchingBootstrapRef.current = false;
        setLoading(false);
        setIsUpdating(false);
      }
    },
    [selectedSubjectId, activeBookId, user?.id, onToast]
  );

  const handleManualRetry = () => {
    setWakingError(false);
    setRetryCount(0);
    setShowWakingBanner(true);
    isFetchingBootstrapRef.current = false;
    loadBootstrap(selectedSubjectId, 0);
  };

  const loadOverview = useCallback(
    (subId = null) => {
      loadBootstrap(subId, 0);
    },
    [loadBootstrap]
  );

  // Fetch uploaded documents list
  const loadDocumentsList = useCallback(async () => {
    if (!isAuthenticated) {
      setDocumentsList([]);
      return;
    }
    setIsDocumentsLoading(true);
    try {
      const docs = await listDocuments();
      if (Array.isArray(docs)) {
        setDocumentsList(docs);
      }
    } catch (err) {
      console.warn('Failed to load documents list:', err);
    } finally {
      setIsDocumentsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadBootstrap(selectedSubjectId);
      loadDocumentsList();
    } else {
      setDocumentsList([]);
    }
    return () => {
      if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    };
  }, [isAuthenticated, selectedSubjectId, loadBootstrap, loadDocumentsList]);

  // Load full extracted document results (concepts, tree, roadmap) for the in-dashboard results panel
  const loadDocResults = useCallback(async (docId) => {
    if (!docId) return;
    setActiveDocId(docId);
    setIsResultsLoading(true);
    setResultsError(null);
    try {
      const [docDetail, conceptsResp] = await Promise.all([
        getDocument(docId),
        getDocumentConcepts(docId)
      ]);
      setActiveDocData(docDetail);
      setActiveConcepts(conceptsResp.concepts || []);
      setActiveTopics(conceptsResp.topics || []);
      setResultsError(null);
    } catch (err) {
      console.error('Failed to load document results:', err);
      const friendlyMsg = "Can't open the results right now. Please try again.";
      setResultsError({ docId, message: friendlyMsg });
      onToast({
        type: 'error',
        message: friendlyMsg
      });
    } finally {
      setIsResultsLoading(false);
    }
  }, [onToast]);

  // Clean up polling timers on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  // Poll processing status every 1.5s
  const startPolling = useCallback((docId) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    let pollInFlight = false;

    progressTimerRef.current = setInterval(() => {
      setProcessingProgress((prev) => (prev < 92 ? prev + 1 : prev));
    }, 450);

    pollingRef.current = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const doc = await getDocumentStatus(docId);
        setProcessingStage(doc.stage || 'reading');
        if (typeof doc.progress === 'number' && doc.progress > 0) {
          setProcessingProgress((prev) => Math.max(prev, doc.progress));
        }
        if (doc.stage_message) {
          setProcessingMessage(doc.stage_message);
        }

        if (doc.status === 'completed') {
          clearInterval(pollingRef.current);
          if (progressTimerRef.current) clearInterval(progressTimerRef.current);

          if (!completedJobsRef.current.has(docId)) {
            completedJobsRef.current.add(docId);
            setProcessingProgress(100);
            setProcessingMessage('Extraction completed successfully!');

            setTimeout(async () => {
              setIsUploading(false);
              setProcessingDoc(null);
              setProcessingError(null);
              await loadDocResults(docId);
              await loadOverview(selectedSubjectId);
              loadDocumentsList();
              onToast({
                type: 'success',
                message: 'Concepts successfully extracted!'
              });
              navigate(`/files/${docId}`);
            }, 300);
          }
        } else if (doc.status === 'failed') {
          clearInterval(pollingRef.current);
          if (progressTimerRef.current) clearInterval(progressTimerRef.current);
          setIsUploading(false);
          setProcessingError(doc.error || 'Failed to extract concepts from document.');
        }
      } catch (err) {
        console.error('Polling error:', err);
      } finally {
        pollInFlight = false;
      }
    }, 1500);
  }, [loadDocResults, loadOverview, selectedSubjectId, onToast, navigate]);

  // Start document upload from dashboard
  const handleUpload = async (file, options = {}) => {
    if (uploadInFlightRef.current || isUploading) return;
    uploadInFlightRef.current = true;
    setLastUploadedFile(file);
    setIsUploading(true);
    setProcessingError(null);
    setProcessingStage('reading');
    setProcessingProgress(8);
    setProcessingMessage(`Uploading ${file.name}...`);
    setProcessingDoc({ filename: file.name });

    try {
      const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const resp = await uploadDocument(file, { ...options, idempotencyKey });
      setProcessingDoc({ id: resp.id, filename: resp.filename });

      if (resp.status === 'completed') {
        if (!completedJobsRef.current.has(resp.id)) {
          completedJobsRef.current.add(resp.id);
          setIsUploading(false);
          setProcessingDoc(null);
          setProcessingError(null);
          await loadDocResults(resp.id);
          await loadOverview(selectedSubjectId);
          loadDocumentsList();
          onToast({
            type: 'success',
            message: 'Document loaded successfully!'
          });
          navigate(`/files/${resp.id}`);
        }
      } else {
        startPolling(resp.id);
      }
    } catch (err) {
      setIsUploading(false);
      setProcessingError(err.message || 'Upload failed. Please try again.');
    } finally {
      uploadInFlightRef.current = false;
    }
  };

  const handleRetryUpload = (options = {}) => {
    if (lastUploadedFile) {
      handleUpload(lastUploadedFile, options);
    }
  };

  const handleCancelProcessing = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    setIsUploading(false);
    setProcessingDoc(null);
    setProcessingError(null);
    setProcessingProgress(0);
  };

  const handleDeleteDocument = async (docId) => {
    const previousDocuments = documentsList;
    // Optimistic removal so user instantly sees the deleted file disappear without lag
    setDocumentsList((prev) => (Array.isArray(prev) ? prev.filter((d) => d.id !== docId && String(d.id) !== String(docId)) : []));
    if (activeDocId === docId || String(activeDocId) === String(docId)) {
      setActiveDocId(null);
      setActiveBookId(null);
      setActiveDocData(null);
      setActiveConcepts([]);
      setActiveTopics([]);
    }
    try {
      await deleteDocument(docId);
      onToast({
        type: 'info',
        message: 'Document removed'
      });
      loadOverview(selectedSubjectId);
      loadDocumentsList();
    } catch (err) {
      // Rollback if server responded with error
      setDocumentsList(previousDocuments);
      onToast({
        type: 'error',
        message: err.message || 'Failed to delete document'
      });
    }
  };

  const handleRenameDocument = async (docId, newTitle) => {
    try {
      await renameDocument(docId, newTitle);
      setActiveDocData((prev) => (prev ? { ...prev, filename: newTitle } : prev));
      loadOverview(selectedSubjectId);
      loadDocumentsList();
      onToast({
        type: 'success',
        message: 'Document title updated'
      });
    } catch (err) {
      onToast({
        type: 'error',
        message: err.message || 'Failed to rename document'
      });
    }
  };

  // All chapters across books in selected subject
  const allChapters = useMemo(() => {
    const list = [];
    (overview?.books || []).forEach((b) => {
      (b.chapters || []).forEach((ch) => {
        list.push({ ...ch, bookFilename: b.filename, documentId: b.id });
      });
    });
    return list;
  }, [overview]);

  // Concept to highlight/open in the unified results panel
  const [selectedConceptForResults, setSelectedConceptForResults] = useState(null);

  const handleOpenConceptInResults = useCallback(async (chapterId, conceptName) => {
    const targetChapter = allChapters.find((ch) => ch.id === chapterId);
    const targetDocId = targetChapter?.documentId || targetChapter?.book_id || activeBookId;

    setSelectedConceptForResults(conceptName);

    if (targetDocId && activeDocId !== targetDocId) {
      await loadDocResults(targetDocId);
      setActiveBookId(targetDocId);
    }

    setTimeout(() => {
      const resultsEl = document.querySelector('.results-panel-container') ||
                        document.querySelector('.planner-results-loading-card');
      if (resultsEl) {
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 200);
  }, [allChapters, activeBookId, activeDocId, loadDocResults]);



  // Handlers for Chapter Progress & Meta
  const handleUpdateChapterStatus = async (chapterId, status) => {
    try {
      await updateChapterProgress(chapterId, status);
      // Reload overview to refresh remaining hours, mastery %, etc.
      loadOverview(selectedSubjectId);
    } catch (err) {
      onToast({
        type: 'error',
        message: 'Failed to update chapter progress'
      });
    }
  };

  const handleUpdateChapterMeta = async (chapterId, meta) => {
    try {
      await updateChapterMeta(chapterId, meta);
      loadOverview(selectedSubjectId);
      onToast({
        type: 'success',
        message: 'Chapter study time updated'
      });
    } catch (err) {
      onToast({
        type: 'error',
        message: 'Failed to update chapter metadata'
      });
    }
  };

  // Greeting logic
  const greetingTime = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = useMemo(() => {
    const name = getDisplayName(user, 'Himanshu');
    return name.split(' ')[0] || 'Himanshu';
  }, [user]);

  const todayDateFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }, []);

  const activePlan = overview?.active_plan;
  const planStatus = overview?.plan_status;

  const fileCount = documentsList.length || (overview?.books?.length || 0);

  const combinedStats = useMemo(() => {
    if (fileCount === 0) {
      return {
        total_concepts: 0,
        chapters_done: 0,
        total_chapters: 0,
        remaining_chapters: 0,
        study_time_left: 0,
        mastery_percent: 0,
        concepts_growth: null,
        chapters_growth: null,
        time_growth: null,
        mastery_growth: null
      };
    }

    const books = overview?.books || [];
    const allChs = books.flatMap((b) => b.chapters || []);

    // Concepts: sum over files in documentsList or overview books
    const docConceptsSum = documentsList.reduce((sum, d) => sum + (d.concept_count || 0), 0);
    const bookConceptsSum = books.reduce((sum, b) => {
      const bConcepts = b.concepts_count || b.chapters?.reduce((cSum, ch) => cSum + (ch.concept_count || 0), 0) || 0;
      return sum + bConcepts;
    }, 0);
    const totalConcepts = docConceptsSum > 0
      ? docConceptsSum
      : (bookConceptsSum > 0 ? bookConceptsSum : (overview?.stats?.total_concepts || 0));

    // Chapters Done / total (1 uploaded file = 1 chapter)
    const totalChapters = fileCount > 0 ? fileCount : (books.length || (overview?.stats?.total_chapters || 0));
    const chaptersDone = books.filter((b) => {
      if (b.mastery_pct !== undefined && b.mastery_pct >= 100) return true;
      if (b.chapters && b.chapters.length > 0) {
        return b.chapters.every((ch) => ch.status === 2 || ch.completed);
      }
      return false;
    }).length || allChs.filter((ch) => ch.status === 2 || ch.status === 'completed').length;
    const remainingChapters = Math.max(0, totalChapters - chaptersDone);

    // Study Time Left: sum of remaining hours across all files
    let remainingTime = 0;
    if (allChs.length > 0) {
      remainingTime = allChs.reduce((sum, ch) => {
        if (ch.status === 2 || ch.status === 'completed') return sum;
        const hrs = Number(ch.est_hours) || Number(ch.estimated_hours) || 1.5;
        return sum + hrs;
      }, 0);
    }
    const studyTimeLeft = overview?.stats?.study_time_left > 0
      ? Number(overview.stats.study_time_left.toFixed(1))
      : (remainingTime > 0 ? Number(remainingTime.toFixed(1)) : 0);

    // Mastery: average weighted by concept count across all files
    let masteryPercent = 0;
    if (overview?.stats?.mastery_percent !== undefined) {
      masteryPercent = Math.round(overview.stats.mastery_percent);
    } else if (totalConcepts > 0 && overview?.stats?.studied_concepts_count) {
      masteryPercent = Math.round((overview.stats.studied_concepts_count / totalConcepts) * 100);
    }

    return {
      total_concepts: totalConcepts,
      chapters_done: chaptersDone,
      total_chapters: totalChapters,
      remaining_chapters: remainingChapters,
      study_time_left: studyTimeLeft,
      mastery_percent: masteryPercent,
      concepts_growth: null,
      chapters_growth: null,
      time_growth: null,
      mastery_growth: null
    };
  }, [fileCount, documentsList, overview]);

  // One line status message
  const statusLineMessage = useMemo(() => {
    if (fileCount === 0) {
      return '0h of study material across your 0 uploaded files. Upload notes to begin.';
    }
    return `${combinedStats.study_time_left}h of study material across your ${fileCount} uploaded files. Choose a deadline to start your plan.`;
  }, [fileCount, combinedStats.study_time_left]);

  return (
    <div className="planner-container">
      {/* Honest Waiting Banner for Backend Wake-Up */}
      {showWakingBanner && (
        <div className="planner-waking-banner" role="alert" aria-live="polite">
          <div className="planner-waking-content">
            <div className="planner-waking-left">
              {!wakingError ? (
                <div className="planner-waking-spinner" />
              ) : (
                <AlertTriangle size={24} color="#ef4444" style={{ flexShrink: 0 }} />
              )}
              <div>
                <strong className="planner-waking-title">
                  {wakingError
                    ? 'Backend Server Connection Failed'
                    : 'Waking up the server. On the free plan this can take up to a minute.'}
                </strong>
                <div className="planner-waking-sub">
                  {wakingError
                    ? 'Unable to reach the server. Please check your connection and click Retry.'
                    : retryCount > 0
                    ? `Waiting for backend instance to start (attempt ${retryCount} of 3)...`
                    : "Spinning up free-tier compute. Your dashboard will appear automatically as soon as it's ready."}
                </div>
              </div>
            </div>
            {wakingError && (
              <button
                type="button"
                className="planner-waking-retry-btn"
                onClick={handleManualRetry}
              >
                <RotateCcw size={14} />
                Retry
              </button>
            )}
          </div>
          {!wakingError && (
            <div className="planner-waking-progress-bar">
              <div className="planner-waking-progress-fill" />
            </div>
          )}
        </div>
      )}

      {/* Signed-Out Locked State Hero Card */}
      {!isAuthenticated && (
        <div className="card card--dark locked-hero-card" style={{ marginBottom: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, margin: 0, color: '#FFFFFF' }}>
                Sign in to your workspace
              </h2>
              <p style={{ fontSize: '14px', color: '#A8A8B0', margin: '4px 0 0 0' }}>
                Your notes, concepts and personalized study plan stay private to you.
              </p>
            </div>
            <button
              type="button"
              className="pill card--lime"
              onClick={() => openAuthModal('signin')}
              style={{
                fontSize: '14px',
                fontWeight: 700,
                padding: '10px 24px',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Sign in
            </button>
          </div>
        </div>
      )}

      {/* 1. Flux Page Header Pattern (Giant bold title, muted subtitle, date + Today pill) */}
      <section className="flux-page-header">
        <div className="flux-page-header-left">
          <h1 className="flux-page-title">
            {greetingTime}, {firstName}!
          </h1>
          <div className="flux-page-subtitle-row">
            <span className="flux-page-subtitle">
              {loading && !overview ? 'Synchronizing notes & learning route...' : statusLineMessage}
            </span>
            {isUpdating && (
              <span className="flux-updating-badge" title="Fetching latest updates from server">
                <RotateCw size={11} className="spin-slow" />
                <span>Updating...</span>
              </span>
            )}
          </div>
        </div>

        <div className="flux-page-header-right">
          <div className="flux-date-pill">
            <span>{todayDateFormatted}</span>
          </div>
          <div className="flux-today-pill">
            <span>Today</span>
          </div>
          <button
            type="button"
            className="flux-core-curriculum-pill"
            onClick={() => {
              if (overview?.subjects?.length > 1) {
                const nextIdx = (overview.subjects.findIndex(s => s.id === selectedSubjectId) + 1) % overview.subjects.length;
                setSelectedSubjectId(overview.subjects[nextIdx].id);
              }
            }}
          >
            <span>Core Curriculum</span>
            <span className="flux-core-chip">{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
          </button>
        </div>
      </section>

      {/* 2. Subject Pills (if multiple subjects exist) */}
      {overview?.subjects && overview.subjects.length > 1 && (
        <div className="flux-subject-pills-row" role="tablist" aria-label="Available Subjects">
          {overview.subjects.map((sub) => {
            const isSelected = sub.id === selectedSubjectId;
            return (
              <button
                key={sub.id}
                type="button"
                className={`flux-subject-pill ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedSubjectId(sub.id)}
                role="tab"
                aria-selected={isSelected}
              >
                <BookOpen size={15} />
                <span>{sub.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 3. 4 Standardized Stat Cards combining all files */}
      <section className="flux-stat-grid" aria-label="Study Progress Statistics">
        <StatCard
          label="Concepts"
          value={combinedStats.total_concepts}
          icon={Sparkles}
          iconColor="#111113"
          iconBg="#D7F25C"
          growth={combinedStats.concepts_growth}
          progress={combinedStats.total_concepts > 0 ? Math.round(((overview?.stats?.studied_concepts_count || 0) / combinedStats.total_concepts) * 100) : 0}
          progressColor="var(--text)"
          contextText={fileCount === 0 ? "Combined from 0 files" : `Combined from ${fileCount} files`}
        />

        <StatCard
          label="Chapters Done"
          value={`${combinedStats.chapters_done} / ${combinedStats.total_chapters}`}
          icon={CheckCircle}
          iconColor="#111113"
          iconBg="#B7A9F2"
          growth={combinedStats.chapters_growth}
          progress={combinedStats.total_chapters > 0 ? (combinedStats.chapters_done / combinedStats.total_chapters) * 100 : 0}
          progressColor="#B7A9F2"
          contextText={fileCount === 0 ? "0 chapters left across all files" : `${combinedStats.remaining_chapters} chapters left across all files`}
        />

        <StatCard
          label="Study Time Left"
          value={combinedStats.study_time_left}
          unit="h"
          icon={Clock}
          iconColor="#111113"
          iconBg="#E6E6E8"
          growth={combinedStats.time_growth}
          progress={combinedStats.total_chapters > 0 ? Math.round((combinedStats.chapters_done / combinedStats.total_chapters) * 100) : 0}
          progressColor="#D7F25C"
          contextText="All files at your pace"
        />

        <StatCard
          label="Mastery"
          value={combinedStats.mastery_percent}
          unit="%"
          icon={TrendingUp}
          iconColor="#111113"
          iconBg="#D7F25C"
          growth={combinedStats.mastery_growth}
          progress={combinedStats.mastery_percent}
          progressColor="#B7A9F2"
          contextText="Average across all files"
        />
      </section>

      {/* 4. Full-Width Drop Your Notes Here Card (NEW position: directly under the 4 stat cards) */}
      <section className="flux-drop-card-row" style={{ width: '100%', marginBottom: '24px' }}>
        <CompactUploadCard
          onUpload={handleUpload}
          isUploading={isUploading}
          processingDoc={processingDoc}
          processingStage={processingStage}
          processingProgress={processingProgress}
          processingMessage={processingMessage}
          processingError={processingError}
          onRetryUpload={handleRetryUpload}
          onCancelProcessing={handleCancelProcessing}
          onToast={onToast}
          emphasis={fileCount === 0}
        />
      </section>

      {/* 5. Course Pacing (Day N of 7) + Study Consistency Row */}
      <section className="flux-row-2-grid" aria-label="Course Pacing and Consistency" style={{ marginBottom: '24px' }}>
        <CourseStatusCard
          activePlan={activePlan}
          planStatus={planStatus}
          totalChapters={combinedStats.total_chapters}
          doneChapters={combinedStats.chapters_done}
          subtitle={fileCount === 0 ? 'Upload notes to start' : `One route for all ${fileCount} files`}
        />
        <DotMatrixStreakCard
          score={9.2}
          maxScore={10}
          streakDays={5}
          subtitle={fileCount === 0 ? 'Upload notes to start' : `5-day streak active · all ${fileCount} files combined`}
        />
      </section>



      {/* Floating Ask Your Notes Button & Drawer (Screen 3) */}
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
          <div className="floating-ask-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ask Your Notes">
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
                documentId={activeDocId}
                initialQuestion=""
                onSelectConcept={(concept) => {
                  if (concept.document_id) {
                    setActiveBookId(concept.document_id);
                    loadDocResults(concept.document_id);
                  }
                  setIsAskOpen(false);
                }}
                isAuthenticated={isAuthenticated}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
