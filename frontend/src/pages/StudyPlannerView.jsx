import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  Play,
  RotateCcw,
  ListFilter,
  CheckCircle2,
  BookOpen
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getPlannerOverview,
  previewStudyPlan,
  createStudyPlan,
  togglePlanDay,
  resetStudyPlan
} from '../api/client';
import RouteMap from '../components/planner/RouteMap';
import NeutralSkeleton from '../components/planner/NeutralSkeleton';
import '../styles/planner.css';

export default function StudyPlannerView({ onToast = () => {} }) {
  const navigate = useNavigate();
  const { isAuthenticated, openAuthModal } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [overview, setOverview] = useState(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState(null);
  const [activePlan, setActivePlan] = useState(null);
  const [planStatus, setPlanStatus] = useState(null);
  const [previewRoute, setPreviewRoute] = useState(null);

  // Planner controls state
  const [days, setDays] = useState(7);
  const [orderMode, setOrderMode] = useState('syllabus');
  const [scopeChapterId, setScopeChapterId] = useState('');
  const [viewMode, setViewMode] = useState('route'); // 'route' | 'list'
  const [isStartingPlan, setIsStartingPlan] = useState(false);
  const [animTrigger, setAnimTrigger] = useState(0);

  // Load subject overview & active plan
  const loadPlannerData = useCallback(async (subId = null) => {
    try {
      setIsLoading(true);
      const data = await getPlannerOverview(subId);
      setOverview(data);
      if (data?.subject) {
        setSelectedSubjectId(data.subject.id);
      }
      if (data?.active_plan) {
        setActivePlan(data.active_plan);
        setDays(data.active_plan.days || 7);
        setOrderMode(data.active_plan.order_mode || 'syllabus');
        setScopeChapterId(data.active_plan.scope_chapter_id || '');
      } else {
        setActivePlan(null);
      }
      if (data?.plan_status) {
        setPlanStatus(data.plan_status);
      }
      if (data?.route) {
        setPreviewRoute(data.route);
      }
    } catch (err) {
      console.warn('Failed to load planner overview:', err);
      onToast({
        type: 'error',
        message: err.message || 'Could not load study planner data'
      });
    } finally {
      setIsLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    loadPlannerData();
  }, [loadPlannerData]);

  // Re-generate preview route when days, orderMode, or scope changes (if no active plan or user tweaks parameters)
  useEffect(() => {
    let isCancelled = false;
    const fetchPreview = async () => {
      if (!selectedSubjectId) return;
      try {
        const preview = await previewStudyPlan({
          subject_id: selectedSubjectId,
          days,
          order_mode: orderMode,
          scope_chapter_id: scopeChapterId || null
        });
        if (!isCancelled && preview?.route) {
          setPreviewRoute(preview.route);
          setAnimTrigger((prev) => prev + 1);
        }
      } catch (err) {
        console.warn('Could not generate plan preview:', err);
      }
    };

    fetchPreview();
    return () => {
      isCancelled = true;
    };
  }, [selectedSubjectId, days, orderMode, scopeChapterId]);

  // All chapters from overview books
  const allChapters = useMemo(() => {
    if (!overview?.books) return [];
    return overview.books.flatMap((b) => b.chapters || []);
  }, [overview]);

  const displayRoute = activePlan?.route || previewRoute || [];

  // Start or update plan
  const handleStartPlan = async () => {
    if (!isAuthenticated) {
      openAuthModal('signin', 'Sign in to save and track your custom study plan across all devices.');
      return;
    }
    if (!selectedSubjectId) return;
    try {
      setIsStartingPlan(true);
      const res = await createStudyPlan({
        subject_id: selectedSubjectId,
        days,
        order_mode: orderMode,
        scope_chapter_id: scopeChapterId || null
      });
      if (res?.plan) {
        setActivePlan(res.plan);
        setPlanStatus(res.plan_status);
        onToast({
          type: 'success',
          message: `Active study plan started! Target: ${days} days.`
        });
      }
    } catch (err) {
      onToast({
        type: 'error',
        message: err.message || 'Failed to start study plan'
      });
    } finally {
      setIsStartingPlan(false);
    }
  };

  // Reset active plan
  const handleResetPlan = async () => {
    const planId = activePlan?.id;
    if (!planId) return;
    try {
      await resetStudyPlan(planId);
      setActivePlan(null);
      setPlanStatus(null);
      onToast({
        type: 'info',
        message: 'Saved study plan reset'
      });
      loadPlannerData(selectedSubjectId);
    } catch (err) {
      onToast({
        type: 'error',
        message: err.message || 'Failed to reset plan'
      });
    }
  };

  // Toggle milestone / day done
  const handleToggleDayDone = async (dayIndex) => {
    const planId = activePlan?.id;
    if (!planId) {
      onToast({
        type: 'info',
        message: 'Click "Start this plan" above to track progress on this schedule!'
      });
      return;
    }
    try {
      const res = await togglePlanDay(planId, dayIndex);
      if (res?.plan) {
        setActivePlan(res.plan);
        setPlanStatus(res.plan_status);
        const isNowDone = res.plan.done_days?.includes(dayIndex);
        onToast({
          type: 'success',
          message: isNowDone ? `Day ${dayIndex} completed! Great job!` : `Day ${dayIndex} unmarked`
        });
      }
    } catch (err) {
      onToast({
        type: 'error',
        message: err.message || 'Failed to toggle day progress'
      });
    }
  };

  if (isLoading) {
    return (
      <div className="planner-page-container" style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto' }}>
        <NeutralSkeleton />
      </div>
    );
  }

  const completedDaysCount = activePlan?.done_days?.length || 0;
  const totalDaysCount = activePlan?.days || days;
  const progressPercent = Math.min(100, Math.round((completedDaysCount / Math.max(1, totalDaysCount)) * 100));

  return (
    <div className="planner-page-container" style={{ padding: '24px 28px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Top Header Bar */}
      <div 
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          marginBottom: 20
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--planner-card-bg)',
              border: '1px solid var(--planner-card-border)',
              borderRadius: 'var(--planner-radius-sm)',
              padding: '8px 14px',
              fontSize: '0.88rem',
              fontWeight: 600,
              color: 'var(--planner-text-main)',
              cursor: 'pointer',
              transition: 'all 0.18s ease'
            }}
            title="Return to main dashboard"
          >
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </button>

          <div>
            <h1 
              style={{ 
                margin: 0, 
                fontSize: '1.5rem', 
                fontFamily: 'var(--planner-font-title)', 
                color: 'var(--planner-greeting, var(--brand-text))',
                display: 'flex',
                alignItems: 'center',
                gap: 8
              }}
            >
              <MapPin size={24} color="var(--planner-mint)" />
              Study Route Planner
            </h1>
            <p style={{ margin: '2px 0 0 0', fontSize: '0.85rem', color: 'var(--planner-text-muted)' }}>
              Curriculum roadmap & daily milestones for {overview?.subject?.name || 'your courses'}
            </p>
          </div>
        </div>

        {/* Plan Status Badge */}
        {activePlan ? (
          <div 
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: 'var(--planner-card-bg)',
              border: '1px solid var(--planner-mint-border)',
              borderRadius: '999px',
              padding: '6px 16px',
              boxShadow: 'var(--planner-shadow-sm)'
            }}
          >
            <span 
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--planner-mint)',
                boxShadow: '0 0 8px var(--planner-mint)'
              }}
            />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--planner-text-main)' }}>
              Active Plan: {completedDaysCount} of {totalDaysCount} days completed ({progressPercent}%)
            </span>
            <button
              type="button"
              onClick={handleResetPlan}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--planner-orange)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.8rem',
                fontWeight: 600
              }}
              title="Reset current study plan"
            >
              <RotateCcw size={12} />
              Reset
            </button>
          </div>
        ) : (
          <div 
            style={{
              fontSize: '0.85rem',
              color: 'var(--planner-text-muted)',
              background: 'var(--planner-card-bg)',
              border: '1px solid var(--planner-card-border)',
              borderRadius: '999px',
              padding: '6px 14px'
            }}
          >
            Configuring new study schedule
          </div>
        )}
      </div>

      {/* Main Route Card */}
      <section 
        className="planner-section-card" 
        style={{ 
          background: 'var(--planner-card-bg)', 
          border: '1px solid var(--planner-card-border)',
          borderRadius: 'var(--planner-radius-md)',
          padding: '20px 24px'
        }}
      >
        {/* Controls Bar */}
        <div className="planner-controls-bar" style={{ marginBottom: 18 }}>
          {/* Target Deadline Chips */}
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

          {/* Scope & Ordering Dropdowns */}
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

            {/* View Mode Toggle */}
            <button
              type="button"
              className="view-toggle-btn"
              onClick={() => setViewMode(viewMode === 'route' ? 'list' : 'route')}
              title="Switch between Timeline and List view"
            >
              <ListFilter size={15} />
              <span>{viewMode === 'route' ? 'List View' : 'Timeline View'}</span>
            </button>

            {/* Start / Update Button */}
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

        {/* Main Content: Timeline View or List View */}
        {displayRoute.length === 0 ? (
          <div 
            style={{ 
              textAlign: 'center', 
              padding: '48px 16px', 
              color: 'var(--planner-text-muted)' 
            }}
          >
            <BookOpen size={36} color="var(--planner-mint)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ margin: '0 0 6px 0', color: 'var(--planner-text-main)' }}>No Chapters Available Yet</h3>
            <p style={{ margin: 0, fontSize: '0.9rem' }}>
              Upload your lecture notes or textbook chapters from the Dashboard to generate your automated study route.
            </p>
          </div>
        ) : viewMode === 'route' ? (
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {displayRoute.map((day) => {
              const isDone = activePlan?.done_days?.includes(day.day_index);
              const isToday = day.day_index === (planStatus?.today_index || 1);

              return (
                <div
                  key={day.day_index}
                  style={{
                    padding: '14px 18px',
                    borderRadius: 'var(--planner-radius-sm)',
                    border: '1px solid var(--planner-card-border)',
                    background: isDone
                      ? 'var(--planner-mint-light)'
                      : isToday
                      ? 'var(--planner-orange-light)'
                      : 'var(--planner-card-bg)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong style={{ fontFamily: 'var(--planner-font-title)', fontSize: '1.02rem' }}>
                        Day {day.day_index}
                      </strong>
                      <span style={{ fontSize: '0.85rem', color: 'var(--planner-text-muted)' }}>
                        ({day.date} • {day.hours}h study time)
                      </span>
                      {isToday && (
                        <span 
                          style={{
                            background: 'var(--planner-orange)',
                            color: '#ffffff',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '999px',
                            textTransform: 'uppercase'
                          }}
                        >
                          Today
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.88rem', marginTop: 6, color: 'var(--planner-text-main)' }}>
                      {day.items?.map((it) => `${it.chapter}: ${it.topics.join(', ')}`).join(' | ')}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleDayDone(day.day_index)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '999px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: isDone ? 'var(--planner-mint)' : 'var(--planner-card-border)',
                      color: isDone ? '#ffffff' : 'var(--planner-text-muted)',
                      transition: 'all 0.18s ease'
                    }}
                  >
                    <CheckCircle2 size={14} />
                    <span>{isDone ? 'Completed' : 'Mark Done'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
