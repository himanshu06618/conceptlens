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
  Play,
  ListFilter,
  MapPin,
  Calendar,
  AlertTriangle,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getDashboardBootstrap,
  getDashboardSummary,
  renameDocument,
  getPlannerOverview,
  updateChapterProgress,
  updateChapterMeta,
  previewStudyPlan,
  createStudyPlan,
  togglePlanDay,
  resetStudyPlan,
  uploadDocument,
  getDocumentStatus,
  getDocument,
  getDocumentConcepts,
  deleteDocument
} from '../api/client';
import { getDashboardCache, saveDashboardCache } from '../utils/dashboardCache';

import RouteMap from '../components/planner/RouteMap';
import RelatedTopicsCard from '../components/planner/RelatedTopicsCard';
import CourseStatusCard from '../components/planner/CourseStatusCard';
import RemindersCard from '../components/planner/RemindersCard';
import NotesAnalysisSection from '../components/planner/NotesAnalysisSection';
import MyNotesCard from '../components/planner/MyNotesCard';
import CompactUploadCard from '../components/planner/CompactUploadCard';
import BookshelfLoader from '../components/ui/BookshelfLoader';
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

  // Bootstrap preview items for notes and reminders (zero waterfall requests)
  const [bootstrapNotes, setBootstrapNotes] = useState(null);
  const [bootstrapNotesCount, setBootstrapNotesCount] = useState(null);
  const [bootstrapReminders, setBootstrapReminders] = useState(null);

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

  // Planner controls state
  const [days, setDays] = useState(7);
  const [scopeChapterId, setScopeChapterId] = useState('');
  const [orderMode, setOrderMode] = useState('syllabus');
  const [viewMode, setViewMode] = useState('route'); // 'route' | 'list'
  const [previewRoute, setPreviewRoute] = useState(null);
  const [isStartingPlan, setIsStartingPlan] = useState(false);
  const [animTrigger, setAnimTrigger] = useState(0);

  // Selected chapter for relations card
  const [relationsChapterId, setRelationsChapterId] = useState(null);

  // Redirect teachers or unauthenticated users
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      openAuthModal('signin', 'Sign in to access your study planner, reminders, and progress tracking.');
      navigate('/');
    } else if (user?.role === 'teacher') {
      navigate('/teacher/dashboard');
    }
  }, [isAuthenticated, authLoading, user, navigate, openAuthModal]);

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
          if (cached.overview.route) {
            setPreviewRoute(cached.overview.route);
          }
          if (cached.overview.selected_chapter_id && !relationsChapterId) {
            setRelationsChapterId(cached.overview.selected_chapter_id);
          }
          if (cached.overview.active_plan) {
            setDays(cached.overview.active_plan.days || 7);
            setOrderMode(cached.overview.active_plan.order_mode || 'syllabus');
            setScopeChapterId(cached.overview.active_plan.scope_chapter_id || '');
          }
        }
        if (cached.notes_preview) {
          setBootstrapNotes(cached.notes_preview.items || []);
          setBootstrapNotesCount(cached.notes_preview.total || 0);
        }
        if (cached.reminders) {
          setBootstrapReminders(cached.reminders || []);
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
          subjectId: subId || selectedSubjectId,
          days,
          orderMode,
          scopeChapterId
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
          if (data.overview.route) {
            setPreviewRoute(data.overview.route);
          }
          if (data.overview.selected_chapter_id && !relationsChapterId) {
            setRelationsChapterId(data.overview.selected_chapter_id);
          }
          if (data.overview.active_plan) {
            setDays(data.overview.active_plan.days || 7);
            setOrderMode(data.overview.active_plan.order_mode || 'syllabus');
            setScopeChapterId(data.overview.active_plan.scope_chapter_id || '');
          }
        }

        if (data?.notes_preview) {
          setBootstrapNotes(data.notes_preview.items || []);
          setBootstrapNotesCount(data.notes_preview.total || 0);
        }
        if (data?.reminders) {
          setBootstrapReminders(data.reminders || []);
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
    [selectedSubjectId, days, orderMode, scopeChapterId, relationsChapterId, activeBookId, user?.id, onToast]
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

  useEffect(() => {
    if (isAuthenticated) {
      loadBootstrap(selectedSubjectId);
    }
    return () => {
      if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
    };
  }, [isAuthenticated, selectedSubjectId, loadBootstrap]);

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
    try {
      await deleteDocument(docId);
      onToast({
        type: 'info',
        message: 'Document removed'
      });
      if (activeDocId === docId) {
        setActiveDocId(null);
        setActiveDocData(null);
        setActiveConcepts([]);
        setActiveTopics([]);
      }
      loadOverview(selectedSubjectId);
    } catch (err) {
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

  // Fetch or compute preview route whenever days, scope, or order changes
  useEffect(() => {
    if (!selectedSubjectId) return;

    // If an active plan exists and matches the current settings, show the active plan route
    if (
      overview?.active_plan &&
      overview.active_plan.days === days &&
      overview.active_plan.order_mode === orderMode &&
      (overview.active_plan.scope_chapter_id || '') === scopeChapterId
    ) {
      setPreviewRoute(overview.active_plan.route);
      return;
    }

    // Otherwise fetch preview from API
    let isCancelled = false;
    previewStudyPlan({
      subject_id: selectedSubjectId,
      days,
      order_mode: orderMode,
      scope_chapter_id: scopeChapterId || null
    })
      .then((res) => {
        if (!isCancelled && res?.route) {
          setPreviewRoute(res.route);
          setAnimTrigger((prev) => prev + 1);
        }
      })
      .catch((err) => {
        console.warn('Preview generation failed:', err);
      });

    return () => {
      isCancelled = true;
    };
  }, [days, scopeChapterId, orderMode, selectedSubjectId, overview?.active_plan]);

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

  // Start / Save Plan
  const handleStartPlan = async () => {
    if (!selectedSubjectId) return;
    setIsStartingPlan(true);
    try {
      const res = await createStudyPlan({
        subject_id: selectedSubjectId,
        days,
        order_mode: orderMode,
        scope_chapter_id: scopeChapterId || null
      });
      if (res?.plan) {
        onToast({
          type: 'success',
          message: `Active study plan started (${days} days)!`
        });
        loadOverview(selectedSubjectId);
        setAnimTrigger((prev) => prev + 1);
      }
    } catch (err) {
      onToast({
        type: 'error',
        message: err.message || 'Could not start study plan'
      });
    } finally {
      setIsStartingPlan(false);
    }
  };

  // Toggle Day Done
  const handleToggleDayDone = async (dayIndex) => {
    const planId = overview?.active_plan?.id;
    if (!planId) return;
    try {
      const res = await togglePlanDay(planId, dayIndex);
      if (res?.plan) {
        setOverview((prev) => ({
          ...prev,
          active_plan: res.plan,
          plan_status: res.plan_status
        }));
      }
    } catch (err) {
      onToast({
        type: 'error',
        message: 'Could not update day status'
      });
    }
  };

  // Reset Plan
  const handleResetPlan = async () => {
    const planId = overview?.active_plan?.id;
    if (!planId) return;
    if (!window.confirm('Are you sure you want to reset your current study plan?')) return;

    try {
      await resetStudyPlan(planId);
      onToast({
        type: 'info',
        message: 'Study plan reset'
      });
      loadOverview(selectedSubjectId);
    } catch (err) {
      onToast({
        type: 'error',
        message: 'Could not reset study plan'
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
    const name = user?.display_name || user?.username || 'Student';
    return name.split(' ')[0];
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
    total_concepts: 0,
    chapters_done: 0,
    total_chapters: 0,
    study_time_left: 0,
    mastery_percent: 0
  };

  // One line status message
  const statusLineMessage = useMemo(() => {
    if (overview?.status_line) {
      return overview.status_line;
    }
    if (activePlan) {
      const todayIdx = planStatus?.today_index || 1;
      const todayDayItem = activePlan.route?.find((d) => d.day_index === todayIdx);
      const chNames = todayDayItem?.items?.map((it) => it.chapter).join(', ') || 'Review session';
      const daysLeft = Math.max(1, (planStatus?.days_left ?? activePlan.days));
      const dailyPace = (stats.study_time_left / daysLeft).toFixed(1);
      return `Day ${todayIdx} of your ${activePlan.days}-day plan (${dailyPace}h/day needed). Today: ${chNames}`;
    }
    const subName = overview?.subject?.name || 'Core Curriculum';
    if (stats.study_time_left > 0) {
      return `${stats.study_time_left}h of study material in ${subName}. Choose a deadline to start your plan.`;
    }
    return `You have 0h left in ${subName}. Choose a deadline to begin.`;
  }, [overview?.status_line, activePlan, planStatus, overview?.subject?.name, stats.study_time_left]);

  const displayRoute = activePlan?.route || previewRoute || [];

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

      {/* 1. Header Greeting Section */}
      <section className="planner-header-section">
        <h1 className="planner-greeting">
          {greetingTime}, {firstName}!
        </h1>
        <div className="planner-greeting-date">
          <Calendar size={14} style={{ display: 'inline', marginRight: 6 }} />
          {todayDateFormatted}
        </div>
        <div className="planner-status-line">
          <span className="badge">Status</span>
          {loading && !overview ? (
            <span className="skeleton-text-pill skeleton-pulse" style={{ width: 280, height: 16, display: 'inline-block' }} />
          ) : (
            <span>{statusLineMessage}</span>
          )}
          {isUpdating && (
            <span className="planner-updating-badge" title="Fetching latest updates from server">
              <RotateCw size={11} className="spin-slow" />
              Updating...
            </span>
          )}
        </div>
      </section>

      {/* 2. Subject Pills */}
      {overview?.subjects && overview.subjects.length > 0 && (
        <div className="planner-subject-pills" role="tablist" aria-label="Available Subjects">
          {overview.subjects.map((sub) => {
            const isSelected = sub.id === selectedSubjectId;
            return (
              <button
                key={sub.id}
                type="button"
                className={`planner-subject-pill ${isSelected ? 'active' : ''}`}
                onClick={() => setSelectedSubjectId(sub.id)}
                role="tab"
                aria-selected={isSelected}
              >
                <BookOpen size={16} />
                <span>{sub.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 4 Stat Cards */}
      <section className="planner-stat-grid" aria-label="Study Progress Statistics">
        {/* Concepts */}
        <div className="planner-stat-card">
          <div className="planner-stat-top">
            <span className="planner-stat-label">Concepts</span>
            <div className="planner-stat-icon-wrap">
              <Sparkles size={18} />
            </div>
          </div>
          <div className="planner-stat-val">
            {loading && !overview ? (
              <span className="skeleton-text-pill skeleton-pulse" style={{ width: 48, height: 26, display: 'inline-block' }} />
            ) : (
              stats.total_concepts
            )}
          </div>
          <div className="planner-stat-context">Extracted from your notes & readings</div>
        </div>

        {/* Chapters Done */}
        <div className="planner-stat-card">
          <div className="planner-stat-top">
            <span className="planner-stat-label">Chapters Done</span>
            <div className="planner-stat-icon-wrap" style={{ background: 'var(--planner-peach-light)', color: 'var(--planner-orange)' }}>
              <CheckCircle size={18} />
            </div>
          </div>
          <div className="planner-stat-val">
            {loading && !overview ? (
              <span className="skeleton-text-pill skeleton-pulse" style={{ width: 60, height: 26, display: 'inline-block' }} />
            ) : (
              `${stats.chapters_done} / ${stats.total_chapters}`
            )}
          </div>
          <div className="planner-stat-context">
            {loading && !overview ? (
              <span className="skeleton-text-pill skeleton-pulse" style={{ width: 120, height: 14, display: 'inline-block' }} />
            ) : (
              `${stats.total_chapters - stats.chapters_done} remaining to master`
            )}
          </div>
        </div>

        {/* Study Time Left */}
        <div className="planner-stat-card">
          <div className="planner-stat-top">
            <span className="planner-stat-label">Study Time Left</span>
            <div className="planner-stat-icon-wrap">
              <Clock size={18} />
            </div>
          </div>
          <div className="planner-stat-val">
            {loading && !overview ? (
              <span className="skeleton-text-pill skeleton-pulse" style={{ width: 48, height: 26, display: 'inline-block' }} />
            ) : (
              `${stats.study_time_left}h`
            )}
          </div>
          <div className="planner-stat-context">Estimated at your personalized pace</div>
        </div>

        {/* Mastery */}
        <div className="planner-stat-card">
          <div className="planner-stat-top">
            <span className="planner-stat-label">Mastery</span>
            <div className="planner-stat-icon-wrap" style={{ background: 'var(--planner-peach-light)', color: 'var(--planner-orange)' }}>
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="planner-stat-val">
            {loading && !overview ? (
              <span className="skeleton-text-pill skeleton-pulse" style={{ width: 48, height: 26, display: 'inline-block' }} />
            ) : (
              `${stats.mastery_percent}%`
            )}
          </div>
          <div className="planner-stat-context">Based on completed chapter milestones</div>
        </div>
      </section>

      {/* Compact In-Dashboard Upload Card */}
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

      {/* Main Layout: Left Column (Analysis & Route) / Right Column (Relations, Status, Reminders) */}
      <div className="planner-main-layout">
        {/* Left Column */}
        <div className="planner-left-col">
          {/* 3. Notes Analysis Section */}
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

          {/* Personal Notes Card */}
          <MyNotesCard
            onToast={onToast}
            initialNotes={bootstrapNotes}
            initialTotalCount={bootstrapNotesCount}
          />

          {/* 4 & 5. Study Route Planner & RouteMap */}
          <section className="planner-section-card">
            <div className="planner-section-title">
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <MapPin size={20} color="var(--planner-mint)" />
                Study Route Planner
              </span>

              {activePlan && (
                <button
                  type="button"
                  onClick={handleResetPlan}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--planner-orange)',
                    fontSize: '0.85rem',
                    fontFamily: 'var(--planner-font-title)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                  title="Reset saved plan"
                >
                  <RotateCcw size={14} />
                  Reset Plan
                </button>
              )}
            </div>

            {/* Controls Bar */}
            <div className="planner-controls-bar">
              {/* Deadline Chips: 7 days, 15 days, 1 month */}
              <div className="deadline-chips-group" role="group" aria-label="Target Deadline">
                <button
                  type="button"
                  className={`deadline-chip ${days === 7 ? 'active' : ''}`}
                  onClick={() => setDays(7)}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  className={`deadline-chip ${days === 15 ? 'active' : ''}`}
                  onClick={() => setDays(15)}
                >
                  15 Days
                </button>
                <button
                  type="button"
                  className={`deadline-chip ${days === 30 ? 'active' : ''}`}
                  onClick={() => setDays(30)}
                >
                  1 Month
                </button>
              </div>

              {/* Scope & Order dropdowns */}
              <div className="planner-select-group">
                <select
                  value={scopeChapterId}
                  onChange={(e) => setScopeChapterId(e.target.value)}
                  className="planner-select"
                  aria-label="Planning Scope"
                >
                  <option value="">Whole Subject</option>
                  {allChapters.map((ch) => (
                    <option key={ch.id} value={ch.id} disabled={ch.status === 2}>
                      {ch.name} {ch.status === 2 ? '(Done)' : ''}
                    </option>
                  ))}
                </select>

                <select
                  value={orderMode}
                  onChange={(e) => setOrderMode(e.target.value)}
                  className="planner-select"
                  aria-label="Chapter Ordering"
                >
                  <option value="syllabus">Syllabus Order</option>
                  <option value="easy">Easiest First</option>
                  <option value="hard">Hardest First</option>
                </select>

                {/* Timeline / List toggle */}
                <button
                  type="button"
                  className="view-toggle-btn"
                  onClick={() => setViewMode(viewMode === 'route' ? 'list' : 'route')}
                  title="Switch between Timeline and List view"
                >
                  <ListFilter size={15} />
                  <span>{viewMode === 'route' ? 'List View' : 'Timeline View'}</span>
                </button>

                {/* Start this plan button */}
                <button
                  type="button"
                  className="start-plan-btn"
                  onClick={handleStartPlan}
                  disabled={isStartingPlan}
                >
                  <Play size={16} fill="#ffffff" />
                  <span>{activePlan ? 'Update Plan' : 'Start this plan'}</span>
                </button>
              </div>
            </div>

            {/* Route Rendering */}
            {viewMode === 'route' ? (
              <RouteMap
                route={displayRoute}
                subjectName={overview?.subject?.name || 'Core Curriculum'}
                scopeChapterId={scopeChapterId}
                activePlan={activePlan}
                todayIndex={planStatus?.today_index || 1}
                doneDays={activePlan?.done_days || []}
                onToggleDayDone={handleToggleDayDone}
                animationTrigger={animTrigger}
              />
            ) : (
              /* List View alternative */
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {displayRoute.map((day) => {
                  const isDone = activePlan?.done_days?.includes(day.day_index);
                  const isToday = day.day_index === (planStatus?.today_index || 1);

                  return (
                    <div
                      key={day.day_index}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 'var(--planner-radius-sm)',
                        border: '1px solid var(--planner-card-border)',
                        background: isDone
                          ? 'var(--planner-mint-light)'
                          : isToday
                          ? 'var(--planner-orange-light)'
                          : 'var(--planner-card-bg)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div>
                        <strong style={{ fontFamily: 'var(--planner-font-title)' }}>
                          Day {day.day_index}
                        </strong>{' '}
                        <span style={{ fontSize: '0.85rem', color: 'var(--planner-text-muted)' }}>
                          ({day.date} • {day.hours}h)
                        </span>
                        <div style={{ fontSize: '0.85rem', marginTop: 4 }}>
                          {day.items?.map((it) => `${it.chapter}: ${it.topics.join(', ')}`).join(' | ')}
                        </div>
                      </div>

                      {activePlan && (
                        <button
                          type="button"
                          onClick={() => handleToggleDayDone(day.day_index)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '999px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: isDone ? 'var(--planner-mint)' : 'var(--planner-card-border)',
                            color: isDone ? '#ffffff' : 'var(--planner-text-muted)'
                          }}
                        >
                          {isDone ? 'Completed' : 'Mark Done'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Right Column */}
        <div className="planner-right-col">
          {/* 7. Course Status Card */}
          <CourseStatusCard
            activePlan={activePlan}
            planStatus={planStatus}
            totalChapters={stats.total_chapters}
            doneChapters={stats.chapters_done}
          />

          {/* 6. Related Topics Card */}
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

          {/* 8. Reminders */}
          <RemindersCard
            onToast={onToast}
            initialReminders={bootstrapReminders}
          />
        </div>
      </div>
    </div>
  );
}
