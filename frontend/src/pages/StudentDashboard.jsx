import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles,
  BookOpen,
  CheckCircle,
  Clock,
  TrendingUp,
  RotateCcw,
  Play,
  ListFilter,
  Layers,
  MapPin,
  Calendar,
  AlertTriangle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
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

import RouteMap from '../components/planner/RouteMap';
import RelatedTopicsCard from '../components/planner/RelatedTopicsCard';
import CourseStatusCard from '../components/planner/CourseStatusCard';
import RemindersCard from '../components/planner/RemindersCard';
import NotesAnalysisSection from '../components/planner/NotesAnalysisSection';
import MyNotesCard from '../components/planner/MyNotesCard';
import CompactUploadCard from '../components/planner/CompactUploadCard';
import DashboardResultsPanel from '../components/planner/DashboardResultsPanel';
import '../styles/planner.css';

export default function StudentDashboard({ onToast = () => {} }) {
  const { user, isAuthenticated, loading: authLoading, openAuthModal } = useAuth();
  const navigate = useNavigate();

  // Overview data from backend
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSubjectId, setSelectedSubjectId] = useState(null);
  const [activeBookId, setActiveBookId] = useState(null);

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

  // In-Dashboard Document Results Panel State
  const [activeDocId, setActiveDocId] = useState(null);
  const [activeDocData, setActiveDocData] = useState(null);
  const [activeConcepts, setActiveConcepts] = useState([]);
  const [activeTopics, setActiveTopics] = useState([]);
  const [isResultsLoading, setIsResultsLoading] = useState(false);

  // Planner controls state
  const [days, setDays] = useState(7);
  const [scopeChapterId, setScopeChapterId] = useState('');
  const [orderMode, setOrderMode] = useState('syllabus');
  const [viewMode, setViewMode] = useState('flowchart'); // 'flowchart' | 'list'
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

  // Load unified dashboard summary (one source of truth)
  const loadOverview = useCallback(async (subId = null) => {
    try {
      setLoading(true);
      const data = await getDashboardSummary({
        subjectId: subId || selectedSubjectId,
        days,
        orderMode,
        scopeChapterId,
        chapterForRelations: relationsChapterId
      });
      setOverview(data);

      if (data?.subject) {
        setSelectedSubjectId(data.subject.id);
      }
      if (data?.books?.length > 0) {
        if (!activeBookId || !data.books.some((b) => b.id === activeBookId)) {
          setActiveBookId(data.books[0].id);
        }
      } else {
        setActiveBookId(null);
      }

      if (data?.route) {
        setPreviewRoute(data.route);
      }

      if (data?.selected_chapter_id && !relationsChapterId) {
        setRelationsChapterId(data.selected_chapter_id);
      }

      // If there's an active plan, set initial planner controls to match
      if (data?.active_plan) {
        setDays(data.active_plan.days || 7);
        setOrderMode(data.active_plan.order_mode || 'syllabus');
        setScopeChapterId(data.active_plan.scope_chapter_id || '');
      }
    } catch (err) {
      console.error('Failed to load dashboard summary:', err);
      try {
        const fallbackData = await getPlannerOverview(subId);
        setOverview(fallbackData);
      } catch (fallbackErr) {
        onToast({
          type: 'error',
          message: err.message || 'Could not load study planner'
        });
      }
    } finally {
      setLoading(false);
    }
  }, [activeBookId, selectedSubjectId, days, orderMode, scopeChapterId, relationsChapterId, onToast]);

  useEffect(() => {
    if (isAuthenticated) {
      loadOverview(selectedSubjectId);
    }
  }, [isAuthenticated, selectedSubjectId, loadOverview]);

  // Load full extracted document results (concepts, tree, flowchart) for the in-dashboard results panel
  const loadDocResults = useCallback(async (docId) => {
    if (!docId) return;
    setIsResultsLoading(true);
    try {
      const [docDetail, conceptsResp] = await Promise.all([
        getDocument(docId),
        getDocumentConcepts(docId)
      ]);
      setActiveDocId(docId);
      setActiveDocData(docDetail);
      setActiveConcepts(conceptsResp.concepts || []);
      setActiveTopics(conceptsResp.topics || []);
    } catch (err) {
      console.error('Failed to load document results:', err);
      onToast({
        type: 'error',
        message: err.message || 'Could not load document details'
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
          }, 400);
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
    setLastUploadedFile(file);
    setIsUploading(true);
    setProcessingError(null);
    setProcessingStage('reading');
    setProcessingProgress(8);
    setProcessingMessage(`Uploading ${file.name}...`);
    setProcessingDoc({ filename: file.name });

    try {
      const resp = await uploadDocument(file, options);
      setProcessingDoc({ id: resp.id, filename: resp.filename });
      startPolling(resp.id);
    } catch (err) {
      setIsUploading(false);
      setProcessingError(err.message || 'Upload failed. Please try again.');
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
        list.push({ ...ch, bookFilename: b.filename });
      });
    });
    return list;
  }, [overview]);

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
          <span>{statusLineMessage}</span>
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
          <div className="planner-stat-val">{stats.total_concepts}</div>
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
            {stats.chapters_done} / {stats.total_chapters}
          </div>
          <div className="planner-stat-context">
            {stats.total_chapters - stats.chapters_done} remaining to master
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
          <div className="planner-stat-val">{stats.study_time_left}h</div>
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
          <div className="planner-stat-val">{stats.mastery_percent}%</div>
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

      {/* In-Dashboard Results Panel: Concept Tree, Flowchart, Concepts */}
      {activeDocId && activeDocData && (
        <DashboardResultsPanel
          documentData={activeDocData}
          concepts={activeConcepts}
          topics={activeTopics}
          chapterCount={activeDocData.chapter_count || activeTopics.length}
          isLoading={isResultsLoading}
          onClose={() => {
            setActiveDocId(null);
            setActiveDocData(null);
          }}
          onDeleteDocument={handleDeleteDocument}
          onRenameDocument={handleRenameDocument}
          onToast={onToast}
        />
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
          <MyNotesCard onToast={onToast} />

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

                {/* Flowchart / List toggle */}
                <button
                  type="button"
                  className="view-toggle-btn"
                  onClick={() => setViewMode(viewMode === 'flowchart' ? 'list' : 'flowchart')}
                  title="Switch between Flowchart and List view"
                >
                  <ListFilter size={15} />
                  <span>{viewMode === 'flowchart' ? 'List View' : 'Flowchart View'}</span>
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
            {viewMode === 'flowchart' ? (
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
            activePlan={activePlan}
          />

          {/* 8. Reminders */}
          <RemindersCard onToast={onToast} />
        </div>
      </div>
    </div>
  );
}
