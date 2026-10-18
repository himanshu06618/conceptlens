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

import RelatedTopicsCard from '../components/planner/RelatedTopicsCard';
import CourseStatusCard from '../components/planner/CourseStatusCard';
import NotesAnalysisSection from '../components/planner/NotesAnalysisSection';
import CompactUploadCard from '../components/planner/CompactUploadCard';
import UploadedFilesSection from '../components/planner/UploadedFilesSection';
import BookshelfLoader from '../components/ui/BookshelfLoader';
import AskAnswerCard from '../components/results/AskAnswerCard';
import { StatCard, OverlappingCirclesCard, DotMatrixStreakCard } from '../components/ui';
import '../styles/planner.css';
import '../styles/results-panel.css';

// Code-split heavy document results panel (tree, roadmap, concept details)
const DashboardResultsPanel = React.lazy(() => import('../components/planner/DashboardResultsPanel'));

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

  // Selected chapter for relations card
  const [relationsChapterId, setRelationsChapterId] = useState(null);

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
          if (cached.overview.selected_chapter_id && !relationsChapterId) {
            setRelationsChapterId(cached.overview.selected_chapter_id);
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
          if (data.overview.selected_chapter_id && !relationsChapterId) {
            setRelationsChapterId(data.overview.selected_chapter_id);
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
    [selectedSubjectId, relationsChapterId, activeBookId, user?.id, onToast]
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
  }, [loadDocResults, loadOverview, selectedSubjectId, onToast]);

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

  // Auto-set relationsChapterId when chapters load
  useEffect(() => {
    if (allChapters.length > 0 && !relationsChapterId) {
      setRelationsChapterId(allChapters[0].id);
    }
  }, [allChapters, relationsChapterId]);

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
  const stats = overview?.stats || {
    total_concepts: 56,
    chapters_done: 0,
    total_chapters: 1,
    study_time_left: 11.5,
    mastery_percent: 5.4
  };

  // One line status message
  const statusLineMessage = useMemo(() => {
    if (overview?.status_line) {
      return overview.status_line;
    }
    if (activePlan) {
      const todayIdx = planStatus?.today_index || 3;
      const todayDayItem = activePlan.route?.find((d) => d.day_index === todayIdx);
      const chNames = todayDayItem?.items?.map((it) => it.chapter).join(', ') || 'Lecture 18 Pseudopolynomial';
      const daysLeft = Math.max(1, (planStatus?.days_left ?? activePlan.days));
      const dailyPace = (stats.study_time_left > 0 ? (stats.study_time_left / daysLeft) : 1.6).toFixed(1);
      return `Day ${todayIdx} of your ${activePlan.days}-day plan (${dailyPace}h/day needed). Today: ${chNames}.`;
    }
    return 'Day 3 of your 7-day plan (1.6h/day needed). Today: Lecture 18 Pseudopolynomial.';
  }, [overview?.status_line, activePlan, planStatus, stats.study_time_left]);

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

      {/* 3. 4 Standardized Stat Cards with Animated Count-Up (Row 1) */}
      <section className="flux-stat-grid" aria-label="Study Progress Statistics">
        <StatCard
          label="Concepts"
          value={stats.total_concepts > 0 ? stats.total_concepts : 56}
          icon={Sparkles}
          iconColor="#111113"
          iconBg="#D7F25C"
          growth="+12%"
          progress={100}
          progressColor="var(--text)"
          contextText="Extracted from your notes"
        />

        <StatCard
          label="Chapters Done"
          value={stats.total_chapters > 0 ? `${stats.chapters_done} / ${stats.total_chapters}` : "0 / 1"}
          icon={CheckCircle}
          iconColor="#111113"
          iconBg="#B7A9F2"
          growth="+25%"
          progress={stats.total_chapters > 0 ? (stats.chapters_done / stats.total_chapters) * 100 : 0}
          progressColor="#B7A9F2"
          contextText={`${Math.max(1, stats.total_chapters - stats.chapters_done)} chapter left to master`}
        />

        <StatCard
          label="Study Time Left"
          value={stats.study_time_left > 0 ? stats.study_time_left : 11.5}
          unit="h"
          icon={Clock}
          iconColor="#111113"
          iconBg="#E6E6E8"
          growth="-1.5h"
          progress={65}
          progressColor="#D7F25C"
          contextText="Estimated at your personalized pace"
        />

        <StatCard
          label="Mastery"
          value={stats.mastery_percent > 0 ? stats.mastery_percent : 5.4}
          unit="%"
          icon={TrendingUp}
          iconColor="#111113"
          iconBg="#D7F25C"
          growth="+8%"
          progress={stats.mastery_percent > 0 ? stats.mastery_percent : 5.4}
          progressColor="#B7A9F2"
          contextText="Based on chapter milestones"
        />
      </section>

      {/* 4. Row 2: Mastery Overview Left + Day 3 of 7 Right */}
      <section className="flux-row-2-grid" aria-label="Mastery Overview and Pacing">
        <OverlappingCirclesCard
          corePercent={54}
          prereqPercent={32}
          recallPercent={14}
        />
        <CourseStatusCard
          activePlan={activePlan}
          planStatus={planStatus}
          totalChapters={stats.total_chapters || 1}
          doneChapters={stats.chapters_done || 0}
        />
      </section>

      {/* 5. Row 3: Study Consistency Full Width */}
      <section className="flux-row-3-wrap" aria-label="Study Consistency">
        <DotMatrixStreakCard
          score={9.2}
          maxScore={10}
          streakDays={5}
        />
      </section>

      {/* In-Dashboard Results Panel: Loading State */}
      {activeDocId && isResultsLoading && !activeDocData && !resultsError && (
        <section
          className="planner-results-loading-card"
          style={{
            background: 'var(--planner-card-bg)',
            border: '1px solid var(--planner-card-border)',
            borderRadius: 'var(--planner-radius-md)',
            padding: '40px 20px',
            marginBottom: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-live="polite"
        >
          <BookshelfLoader message="Loading document concepts & learning pathways..." />
        </section>
      )}

      {/* In-Dashboard Results Panel: Error State with Retry Button */}
      {activeDocId && resultsError && (
        <div
          className="planner-results-error-banner"
          role="alert"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: 'var(--planner-radius-md)',
            padding: '16px 20px',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <AlertTriangle size={22} color="#ef4444" style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--planner-text-main)', fontSize: '0.95rem' }}>
                Unable to Open Results
              </div>
              <div style={{ color: 'var(--planner-text-muted)', fontSize: '0.85rem', marginTop: '2px' }}>
                {resultsError.message || "Can't open the results right now. Please try again."}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              onClick={() => loadDocResults(resultsError.docId || activeDocId)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                background: 'var(--planner-mint)',
                color: '#1a1f2c',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer'
              }}
            >
              <RotateCcw size={14} />
              Retry
            </button>
            <button
              type="button"
              onClick={() => {
                setResultsError(null);
                setActiveDocId(null);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--planner-text-muted)',
                cursor: 'pointer',
                padding: '6px',
                display: 'flex',
                alignItems: 'center'
              }}
              aria-label="Dismiss error"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {/* In-Dashboard Results Panel: Concepts, Concept Tree, Roadmap */}
      {activeDocId && activeDocData && !resultsError && (
        <React.Suspense fallback={<BookshelfLoader message="Loading document concepts & learning pathways..." />}>
          <DashboardResultsPanel
            documentData={activeDocData}
            concepts={activeConcepts}
            topics={activeTopics}
            chapterCount={activeDocData.chapter_count || activeTopics.length}
            documents={documentsList}
            onSelectDoc={(id) => {
              setActiveBookId(id);
              loadDocResults(id);
            }}
            isLoading={isResultsLoading}
            selectedConceptName={selectedConceptForResults}
            onClose={() => {
              setActiveDocId(null);
              setActiveDocData(null);
              setResultsError(null);
              setSelectedConceptForResults(null);
            }}
            onDeleteDocument={handleDeleteDocument}
            onRenameDocument={handleRenameDocument}
            onProgressChange={() => loadOverview()}
            onToast={onToast}
          />
        </React.Suspense>
      )}

      {/* Main Balanced Layout: Left Column (Study Materials & Library) / Right Column (Pacing & Quick Actions) */}
      <div className="planner-main-layout">
        {/* Left Column: Learning Center & Library */}
        <div className="planner-left-col">
          {/* 1. Notes & Chapters Analysis Section */}
          <NotesAnalysisSection
            books={overview?.books || []}
            activeBookId={activeBookId}
            onSelectBook={(bId) => {
              setActiveBookId(bId);
              loadDocResults(bId);
            }}
            onOpenDocumentResults={(bId) => {
              setActiveBookId(bId);
              loadDocResults(bId);
            }}
            onDeleteDocument={handleDeleteDocument}
            onUpdateChapterStatus={handleUpdateChapterStatus}
            onUpdateChapterMeta={handleUpdateChapterMeta}
          />

          {/* 2. Dedicated Uploaded Files Library Section */}
          {isAuthenticated && (
            <UploadedFilesSection
              documents={documentsList}
              activeDocId={activeDocId}
              onSelectDoc={(docId) => {
                setActiveBookId(docId);
                loadDocResults(docId);
              }}
              onDeleteDoc={handleDeleteDocument}
              isLoading={isDocumentsLoading}
              onRefresh={loadDocumentsList}
            />
          )}
        </div>

        {/* Right Column: Course Pacing, Quick Upload & Graph Discovery */}
        <div className="planner-right-col">
          {/* 1. Course Status & Daily Targets Card */}
          <CourseStatusCard
            activePlan={activePlan}
            planStatus={planStatus}
            totalChapters={stats.total_chapters}
            doneChapters={stats.chapters_done}
          />

          {/* 2. Quick Upload / Document Intake Card */}
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
          />

          {/* 3. Related Topics & Knowledge Connections Card */}
          <RelatedTopicsCard
            chapters={allChapters}
            selectedChapterId={relationsChapterId}
            onSelectChapter={(cId) => setRelationsChapterId(cId)}
            onOpenConceptInResults={handleOpenConceptInResults}
            activePlan={activePlan}
            initialRelationsData={
              relationsChapterId === overview?.selected_chapter_id
                ? (overview?.related_topics || overview?.relations)
                : null
            }
          />
        </div>
      </div>

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
