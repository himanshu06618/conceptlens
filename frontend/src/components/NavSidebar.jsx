import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  X,
  LayoutDashboard,
  FileText,
  Bell,
  Clock,
  Plus,
  Trash2,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Volume2,
  Sparkles,
  ArrowRight,
  LogIn,
  User,
  Compass,
  AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  getReminders,
  createReminder,
  updateReminder,
  deleteReminder
} from '../api/client';
import { getDisplayName } from '../utils/userUtils';
import { OverlayPortal, lockBodyScroll, unlockBodyScroll } from './ui/Overlay';
import '../styles/nav-sidebar.css';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const GUEST_REMINDERS_KEY = 'conceptlens_guest_reminders';

// Web Audio API chime (zero external dependencies)
function playGentleChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14); // A5
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch (_) {}
}

export default function NavSidebar({ isOpen, onClose, onToast = () => {} }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated, openAuthModal, signOut } = useAuth();

  // Active drawer view/tab: 'nav' or 'reminders'
  const [remindersExpanded, setRemindersExpanded] = useState(true);

  // Reminders state
  const [reminders, setReminders] = useState([]);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [reminderTime, setReminderTime] = useState('19:00');
  const [reminderLabel, setReminderLabel] = useState('Study Session');
  const [selectedWeekdays, setSelectedWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default'
  );

  const containerRef = useRef(null);

  // Scroll lock when drawer is open
  useEffect(() => {
    if (isOpen) {
      lockBodyScroll();
    } else {
      unlockBodyScroll();
    }
    return () => {
      unlockBodyScroll();
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load reminders on mount or auth change
  const loadRemindersList = useCallback(async () => {
    if (isAuthenticated) {
      setLoadingReminders(true);
      try {
        const data = await getReminders();
        setReminders(data?.reminders || []);
      } catch (err) {
        console.warn('Could not fetch cloud reminders:', err);
      } finally {
        setLoadingReminders(false);
      }
    } else {
      // Guest local storage fallback
      try {
        const raw = localStorage.getItem(GUEST_REMINDERS_KEY);
        if (raw) {
          setReminders(JSON.parse(raw));
        } else {
          setReminders([]);
        }
      } catch (_) {
        setReminders([]);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isOpen) {
      loadRemindersList();
    }
  }, [isOpen, loadRemindersList]);

  // Compute closest upcoming reminder
  const closestUpcoming = useMemo(() => {
    const enabledList = reminders.filter((r) => r.enabled);
    if (enabledList.length === 0) return null;

    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7; // Monday = 0
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let minDiff = Infinity;
    let closest = null;

    enabledList.forEach((r) => {
      const parts = (r.time || '19:00').split(':');
      const h = parseInt(parts[0], 10) || 0;
      const m = parseInt(parts[1], 10) || 0;
      const reminderMinutes = h * 60 + m;

      (r.weekdays || [0, 1, 2, 3, 4, 5, 6]).forEach((day) => {
        let dayDiff = day - currentDay;
        let minuteDiff = reminderMinutes - currentMinutes;
        if (dayDiff < 0 || (dayDiff === 0 && minuteDiff <= 0)) {
          dayDiff += 7;
        }
        const totalMinutes = dayDiff * 24 * 60 + minuteDiff;
        if (totalMinutes < minDiff) {
          minDiff = totalMinutes;
          const dayName = dayDiff === 0 ? 'Today' : dayDiff === 1 ? 'Tomorrow' : WEEKDAY_NAMES[day];
          closest = {
            dayName,
            time: r.time,
            label: r.label || 'Study Session'
          };
        }
      });
    });

    if (!closest) return null;
    return `${closest.dayName} at ${closest.time} (${closest.label})`;
  }, [reminders]);

  // Toggle day selection
  const handleToggleDay = (dayIdx) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(dayIdx)) {
        if (prev.length === 1) return prev; // keep at least 1 day
        return prev.filter((d) => d !== dayIdx);
      }
      return [...prev, dayIdx].sort((a, b) => a - b);
    });
  };

  // Add reminder
  const handleAddReminder = async (e) => {
    e.preventDefault();
    if (!reminderTime) return;

    if (isAuthenticated) {
      try {
        const res = await createReminder({
          time: reminderTime,
          weekdays: selectedWeekdays,
          label: reminderLabel,
          enabled: true
        });
        if (res?.reminder) {
          setReminders((prev) => [...prev, res.reminder]);
          playGentleChime();
          onToast({
            type: 'success',
            message: `Study reminder set for ${reminderTime} (${reminderLabel})`
          });
        }
      } catch (err) {
        onToast({
          type: 'error',
          message: err.message || 'Failed to add reminder'
        });
      }
    } else {
      // Guest local reminder
      const newRem = {
        id: `guest_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        time: reminderTime,
        weekdays: selectedWeekdays,
        label: reminderLabel,
        enabled: true,
        created_at: new Date().toISOString()
      };
      const updated = [...reminders, newRem];
      setReminders(updated);
      try {
        localStorage.setItem(GUEST_REMINDERS_KEY, JSON.stringify(updated));
      } catch (_) {}
      playGentleChime();
      onToast({
        type: 'success',
        message: `Local study reminder set for ${reminderTime} (${reminderLabel})`
      });
    }
  };

  // Toggle enabled
  const handleToggleEnabled = async (rem) => {
    const nextEnabled = !rem.enabled;
    if (isAuthenticated) {
      try {
        const updated = await updateReminder(rem.id, { enabled: nextEnabled });
        if (updated?.reminder) {
          setReminders((prev) =>
            prev.map((r) => (r.id === rem.id ? updated.reminder : r))
          );
        }
      } catch (err) {
        onToast({
          type: 'error',
          message: 'Could not update reminder status'
        });
      }
    } else {
      const updated = reminders.map((r) =>
        r.id === rem.id ? { ...r, enabled: nextEnabled } : r
      );
      setReminders(updated);
      try {
        localStorage.setItem(GUEST_REMINDERS_KEY, JSON.stringify(updated));
      } catch (_) {}
    }
  };

  // Delete reminder
  const handleDeleteReminder = async (id) => {
    if (isAuthenticated) {
      try {
        await deleteReminder(id);
        setReminders((prev) => prev.filter((r) => r.id !== id));
        onToast({
          type: 'info',
          message: 'Study reminder deleted'
        });
      } catch (err) {
        onToast({
          type: 'error',
          message: 'Could not delete reminder'
        });
      }
    } else {
      const updated = reminders.filter((r) => r.id !== id);
      setReminders(updated);
      try {
        localStorage.setItem(GUEST_REMINDERS_KEY, JSON.stringify(updated));
      } catch (_) {}
      onToast({
        type: 'info',
        message: 'Study reminder deleted'
      });
    }
  };

  // Test notification & chime
  const handleTestAlert = () => {
    playGentleChime();
    const msg = `ConceptLens Study Alert: Time to study! (${reminderLabel})`;
    onToast({
      type: 'info',
      message: msg
    });

    if (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification('ConceptLens Study Alert', {
        body: msg,
        icon: '/favicon.ico'
      });
    }
  };

  // Request browser permission
  const requestBrowserPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setNotificationPermission(perm);
        if (perm === 'granted') {
          playGentleChime();
          onToast({
            type: 'success',
            message: 'Browser alerts enabled!'
          });
          new Notification('ConceptLens Reminders Active', {
            body: 'You will receive study alerts directly in this browser.',
            icon: '/favicon.ico'
          });
        }
      } catch (err) {
        console.warn('Notification permission error:', err);
      }
    }
  };

  const isDashboardActive = location.pathname === '/' || location.pathname === '/dashboard';
  const isNotesActive = location.pathname.startsWith('/notes');

  const displayName = getDisplayName(user, 'Scholar');

  return (
    <OverlayPortal>
      {/* Backdrop */}
      <div
        className={`nav-sidebar-backdrop ${isOpen ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out Panel */}
      <aside
        ref={containerRef}
        className={`nav-sidebar-panel ${isOpen ? 'is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation and Study Space"
      >
        {/* Header */}
        <div className="nav-sidebar-header">
          <div className="nav-sidebar-header-title-wrap">
            <div className="nav-sidebar-icon-badge">
              <Compass size={20} strokeWidth={2.2} />
            </div>
            <div>
              <h2 className="nav-sidebar-title">Study Space</h2>
              <p className="nav-sidebar-subtitle">Quick Navigation & Reminders</p>
            </div>
          </div>

          <button
            type="button"
            className="nav-sidebar-close-btn"
            onClick={onClose}
            aria-label="Close navigation sidebar"
            title="Close (Esc)"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="nav-sidebar-body">
          {/* Section 1: Navigation Destinations */}
          <div className="nav-section-label">Navigation</div>
          <div className="nav-items-stack">
            {/* 1. Dashboard */}
            <button
              type="button"
              className={`nav-card-item ${isDashboardActive ? 'is-active' : ''}`}
              onClick={() => {
                navigate('/');
                onClose();
              }}
              aria-label="Go to Dashboard"
            >
              <div className="nav-card-icon-slot icon-dashboard">
                <LayoutDashboard size={20} strokeWidth={2} />
              </div>
              <div className="nav-card-content">
                <div className="nav-card-title-row">
                  <span className="nav-card-title">Dashboard</span>
                  {isDashboardActive && (
                    <span className="nav-card-badge">Current</span>
                  )}
                </div>
                <p className="nav-card-description">
                  Curriculum roadmap, concept trees & mastery tracking
                </p>
              </div>
              <ArrowRight size={16} className="nav-card-arrow" />
            </button>

            {/* 2. Personal Notes */}
            <button
              type="button"
              className={`nav-card-item ${isNotesActive ? 'is-active' : ''}`}
              onClick={() => {
                navigate('/notes');
                onClose();
              }}
              aria-label="Go to Personal Notes"
            >
              <div className="nav-card-icon-slot icon-notes">
                <FileText size={20} strokeWidth={2} />
              </div>
              <div className="nav-card-content">
                <div className="nav-card-title-row">
                  <span className="nav-card-title">Personal Notes</span>
                  {isNotesActive && (
                    <span className="nav-card-badge">Current</span>
                  )}
                </div>
                <p className="nav-card-description">
                  Write, search, and review your personal lecture notes
                </p>
              </div>
              <ArrowRight size={16} className="nav-card-arrow" />
            </button>
          </div>

          {/* Section 2: Study Reminder (Study Remainder) */}
          <div className="nav-section-label" style={{ marginTop: '6px' }}>
            Study Routine
          </div>

          <div className="reminders-section-card">
            <div
              className="reminders-section-header"
              onClick={() => setRemindersExpanded((prev) => !prev)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setRemindersExpanded((prev) => !prev);
                }
              }}
              style={{ cursor: 'pointer' }}
            >
              <div className="reminders-header-left">
                <Bell size={18} strokeWidth={2.2} className="reminders-bell-icon" />
                <span className="reminders-header-title">Study Reminder</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="reminders-active-count">
                  {reminders.filter((r) => r.enabled).length} Active
                </span>
                {remindersExpanded ? (
                  <ChevronUp size={16} color="var(--ink)" />
                ) : (
                  <ChevronDown size={16} color="var(--ink)" />
                )}
              </div>
            </div>

            {remindersExpanded && (
              <>
                {/* Upcoming alert banner */}
                {closestUpcoming && (
                  <div className="reminders-upcoming-banner">
                    <span className="reminders-pulse-dot" />
                    <span>Next: {closestUpcoming}</span>
                  </div>
                )}

                {/* Quick Add Form */}
                <form onSubmit={handleAddReminder} className="reminders-quick-form">
                  <div className="reminders-form-row">
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={(e) => setReminderTime(e.target.value)}
                      className="reminder-drawer-time-input"
                      required
                      aria-label="Reminder Time"
                    />
                    <select
                      value={reminderLabel}
                      onChange={(e) => setReminderLabel(e.target.value)}
                      className="reminder-drawer-select"
                      aria-label="Reminder Label"
                    >
                      <option value="Study Session">Study Session</option>
                      <option value="Concept Review">Concept Review</option>
                      <option value="Exam Prep">Exam Prep</option>
                      <option value="Quick Quiz">Quick Quiz</option>
                      <option value="Problem Solving">Problem Solving</option>
                    </select>
                  </div>

                  {/* Days Selector */}
                  <div className="reminder-drawer-weekdays">
                    {WEEKDAY_LABELS.map((dayLabel, idx) => {
                      const isSelected = selectedWeekdays.includes(idx);
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`reminder-drawer-day-pill ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => handleToggleDay(idx)}
                          title={WEEKDAY_NAMES[idx]}
                          aria-label={`Toggle ${WEEKDAY_NAMES[idx]}`}
                        >
                          {dayLabel}
                        </button>
                      );
                    })}
                  </div>

                  <button type="submit" className="reminder-drawer-add-btn">
                    <Plus size={16} strokeWidth={2.4} />
                    <span>Set Study Reminder</span>
                  </button>
                </form>

                {/* Saved Reminders List */}
                <div className="reminders-drawer-list">
                  {loadingReminders ? (
                    <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Loading reminders...
                    </div>
                  ) : reminders.length === 0 ? (
                    <div style={{ padding: '10px 8px', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      No study reminders scheduled yet. Set one above to build your daily study streak!
                    </div>
                  ) : (
                    reminders.map((rem) => {
                      const daysText =
                        rem.weekdays?.length === 7
                          ? 'Every day'
                          : (rem.weekdays || [])
                              .map((d) => WEEKDAY_NAMES[d])
                              .join(', ');

                      return (
                        <div key={rem.id} className="reminder-drawer-item">
                          <div className="reminder-drawer-item-left">
                            <div
                              className="reminder-switch-wrap"
                              onClick={() => handleToggleEnabled(rem)}
                              role="button"
                              tabIndex={0}
                              aria-label={rem.enabled ? 'Disable reminder' : 'Enable reminder'}
                            >
                              <div className={`reminder-switch ${rem.enabled ? 'is-on' : ''}`}>
                                <div className="reminder-switch-handle" />
                              </div>
                            </div>

                            <div className="reminder-drawer-details">
                              <div className="reminder-drawer-time-label">
                                <span className="reminder-drawer-time">{rem.time}</span>
                                <span className="reminder-drawer-label">{rem.label}</span>
                              </div>
                              <span className="reminder-drawer-days">{daysText}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="reminder-drawer-delete-btn"
                            onClick={() => handleDeleteReminder(rem.id)}
                            title="Delete reminder"
                            aria-label={`Delete reminder for ${rem.time}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Secondary Actions */}
                <div className="reminders-drawer-actions">
                  <button
                    type="button"
                    className="reminders-drawer-action-btn"
                    onClick={handleTestAlert}
                    title="Play test audio chime and alert"
                  >
                    <Volume2 size={13} />
                    <span>Test Chime</span>
                  </button>

                  {notificationPermission !== 'granted' && (
                    <button
                      type="button"
                      className="reminders-drawer-action-btn"
                      onClick={requestBrowserPermission}
                      title="Enable Desktop Browser Notifications"
                    >
                      <Bell size={13} />
                      <span>Enable Alerts</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer: User profile info */}
        <div className="nav-sidebar-footer">
          {isAuthenticated ? (
            <div className="nav-sidebar-user-card">
              <div className="nav-sidebar-user-left">
                <div className="nav-sidebar-user-avatar">
                  {displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="nav-sidebar-user-name">{displayName}</div>
                  <div className="nav-sidebar-user-role">
                    {user?.role === 'teacher' ? 'Teacher Scholar' : 'Student Scholar'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="nav-sidebar-auth-btn"
                style={{ background: 'transparent', color: 'var(--ink)' }}
                onClick={() => {
                  signOut();
                  onClose();
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <div className="nav-sidebar-user-card">
              <div className="nav-sidebar-user-left">
                <div className="nav-sidebar-user-avatar" style={{ background: 'rgba(16, 20, 12, 0.08)' }}>
                  <User size={18} />
                </div>
                <div>
                  <div className="nav-sidebar-user-name">Guest Scholar</div>
                  <div className="nav-sidebar-user-role">Sign in to sync your reminders</div>
                </div>
              </div>

              <button
                type="button"
                className="nav-sidebar-auth-btn"
                onClick={() => {
                  openAuthModal('signin');
                  onClose();
                }}
              >
                Sign In
              </button>
            </div>
          )}
        </div>
      </aside>
    </OverlayPortal>
  );
}
