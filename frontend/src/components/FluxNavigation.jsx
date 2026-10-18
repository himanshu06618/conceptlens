import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FileText,
  GitBranch,
  ArrowRight,
  List,
  Compass,
  Bell,
  Download,
  Plus,
  Trash2,
  Check,
  X,
  Clock,
  Sparkles,
  Volume2
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Logo, Button } from './ui';
import {
  getReminders,
  createReminder,
  updateReminder,
  deleteReminder
} from '../api/client';
import { OverlayPortal, lockBodyScroll, unlockBodyScroll } from './ui/Overlay';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const GUEST_REMINDERS_KEY = 'conceptlens_guest_reminders';

// Web Audio API gentle chime (zero external dependencies)
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

export default function FluxNavigation({
  conceptCount = 0,
  chapterCount = 0,
  isSidebarOpen = false,
  onCloseSidebar = () => {},
  isRemindersOpen = false,
  onToggleReminders = () => {},
  onToast = () => {}
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  // PWA install prompt support
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsAppInstalled(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallApp = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsAppInstalled(true);
        onToast({ type: 'success', message: 'ConceptLens installed successfully!' });
      }
      setDeferredPrompt(null);
    } else {
      navigate('/notes');
    }
  };

  // Reminders state
  const [reminders, setReminders] = useState([]);
  const [loadingReminders, setLoadingReminders] = useState(false);
  const [reminderTime, setReminderTime] = useState('19:00');
  const [reminderLabel, setReminderLabel] = useState('Study Session');
  const [selectedWeekdays, setSelectedWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);

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
      try {
        const raw = localStorage.getItem(GUEST_REMINDERS_KEY);
        setReminders(raw ? JSON.parse(raw) : []);
      } catch (_) {
        setReminders([]);
      }
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isRemindersOpen) {
      loadRemindersList();
      lockBodyScroll();
    } else {
      unlockBodyScroll();
    }
    return () => unlockBodyScroll();
  }, [isRemindersOpen, loadRemindersList]);

  const handleToggleDay = (dayIdx) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(dayIdx)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== dayIdx);
      }
      return [...prev, dayIdx].sort((a, b) => a - b);
    });
  };

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
        onToast({ type: 'error', message: err.message || 'Failed to add reminder' });
      }
    } else {
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
        onToast({ type: 'error', message: 'Failed to update reminder' });
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

  const handleDeleteReminder = async (remId) => {
    if (isAuthenticated) {
      try {
        await deleteReminder(remId);
        setReminders((prev) => prev.filter((r) => r.id !== remId));
        onToast({ type: 'info', message: 'Reminder deleted' });
      } catch (err) {
        onToast({ type: 'error', message: 'Failed to delete reminder' });
      }
    } else {
      const updated = reminders.filter((r) => r.id !== remId);
      setReminders(updated);
      try {
        localStorage.setItem(GUEST_REMINDERS_KEY, JSON.stringify(updated));
      } catch (_) {}
      onToast({ type: 'info', message: 'Reminder deleted' });
    }
  };

  // Determine current active navigation key
  const activeNavKey = useMemo(() => {
    const path = location.pathname;
    const search = location.search;
    if (path.startsWith('/notes')) return 'notes';
    if (path.startsWith('/planner')) return 'planner';
    if (search.includes('tab=tree') || search.includes('view=tree')) return 'tree';
    if (search.includes('tab=roadmap') || search.includes('view=roadmap')) return 'roadmap';
    if (search.includes('tab=concepts') || search.includes('view=concepts')) return 'concepts';
    return 'dashboard';
  }, [location.pathname, location.search]);

  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      badge: null,
      onClick: () => {
        navigate('/');
        onCloseSidebar();
      }
    },
    {
      id: 'notes',
      label: 'Notes & Upload',
      icon: FileText,
      badge: chapterCount > 0 ? chapterCount : null,
      onClick: () => {
        navigate('/notes');
        onCloseSidebar();
      }
    },
    {
      id: 'tree',
      label: 'Concept Tree',
      icon: GitBranch,
      badge: null,
      onClick: () => {
        navigate('/?tab=tree');
        onCloseSidebar();
      }
    },
    {
      id: 'roadmap',
      label: 'Roadmap',
      icon: ArrowRight,
      badge: null,
      onClick: () => {
        navigate('/?tab=roadmap');
        onCloseSidebar();
      }
    },
    {
      id: 'concepts',
      label: 'Concepts',
      icon: List,
      badge: conceptCount > 0 ? conceptCount : null,
      onClick: () => {
        navigate('/?tab=concepts');
        onCloseSidebar();
      }
    },
    {
      id: 'planner',
      label: 'Study Planner',
      icon: Compass,
      badge: null,
      onClick: () => {
        navigate('/planner');
        onCloseSidebar();
      }
    },
    {
      id: 'settings',
      label: 'Reminders',
      icon: Bell,
      badge: reminders.filter(r => r.enabled).length > 0 ? reminders.filter(r => r.enabled).length : null,
      onClick: () => {
        onToggleReminders();
        onCloseSidebar();
      }
    }
  ];

  return (
    <>
      {/* 1. Desktop Inset Rounded Dark Left Sidebar (>=1024px) */}
      <aside className={`flux-desktop-sidebar ${isSidebarOpen ? 'drawer-mobile-open' : ''}`} aria-label="Main Navigation">
        <div className="flux-sidebar-inner">
          {/* Logo Top */}
          <div className="flux-sidebar-brand" onClick={() => navigate('/')}>
            <Logo size={32} />
          </div>

          {/* Navigation Items */}
          <nav className="flux-sidebar-nav" aria-label="App Navigation">
            {navItems.map((item) => {
              const isActive = activeNavKey === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flux-nav-item ${isActive ? 'is-active' : ''}`}
                  onClick={item.onClick}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <span className="flux-nav-icon">
                    <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
                  </span>
                  <span className="flux-nav-label">{item.label}</span>
                  {item.badge !== null && (
                    <span className="flux-nav-badge">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Bottom Lime Promo / Upgrade Card */}
          <div className="flux-sidebar-promo-card">
            <div className="flux-promo-badge">
              <Sparkles size={14} />
              <span>Offline Ready</span>
            </div>
            <h4 className="flux-promo-title">
              {isAppInstalled ? 'Upload Notes' : 'Install Web App'}
            </h4>
            <p className="flux-promo-desc">
              {isAppInstalled
                ? 'Drop your course notes & start extracting.'
                : 'Fast local extraction with zero network latency.'}
            </p>
            <button
              type="button"
              className="flux-promo-btn"
              onClick={handleInstallApp}
            >
              <Download size={15} />
              <span>{isAppInstalled ? 'Open Notes' : 'Install App'}</span>
            </button>
          </div>
        </div>
      </aside>

      {/* 2. Mobile Bottom Navigation Bar (<640px) */}
      <nav className="flux-mobile-bottom-nav" aria-label="Mobile Navigation">
        <div className="flux-bottom-nav-inner">
          <button
            type="button"
            className={`flux-bottom-nav-btn ${activeNavKey === 'dashboard' ? 'active' : ''}`}
            onClick={() => navigate('/')}
            aria-label="Dashboard"
          >
            <LayoutDashboard size={20} />
            <span>Home</span>
          </button>
          <button
            type="button"
            className={`flux-bottom-nav-btn ${activeNavKey === 'notes' ? 'active' : ''}`}
            onClick={() => navigate('/notes')}
            aria-label="Notes"
          >
            <FileText size={20} />
            <span>Notes</span>
          </button>
          <button
            type="button"
            className={`flux-bottom-nav-btn ${['tree', 'roadmap', 'concepts'].includes(activeNavKey) ? 'active' : ''}`}
            onClick={() => navigate('/?tab=tree')}
            aria-label="Concepts"
          >
            <GitBranch size={20} />
            <span>Graph</span>
          </button>
          <button
            type="button"
            className={`flux-bottom-nav-btn ${activeNavKey === 'planner' ? 'active' : ''}`}
            onClick={() => navigate('/planner')}
            aria-label="Study Planner"
          >
            <Compass size={20} />
            <span>Route</span>
          </button>
          <button
            type="button"
            className={`flux-bottom-nav-btn ${isRemindersOpen ? 'active' : ''}`}
            onClick={onToggleReminders}
            aria-label="Reminders"
          >
            <Bell size={20} />
            <span>Remind</span>
          </button>
        </div>
      </nav>

      {/* 3. Study Reminders Slide-Out Drawer */}
      {isRemindersOpen && (
        <OverlayPortal>
          <div className="flux-reminders-backdrop" onClick={onToggleReminders}>
            <div
              className="flux-reminders-drawer"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Study Reminders"
            >
              <div className="flux-reminders-header">
                <div className="flux-reminders-title-group">
                  <div className="flux-reminders-icon-chip">
                    <Bell size={18} />
                  </div>
                  <div>
                    <h3 className="flux-reminders-title">Study Reminders</h3>
                    <span className="flux-reminders-subtitle">Gentle audio notifications</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="flux-reminders-close-btn"
                  onClick={onToggleReminders}
                  aria-label="Close Reminders"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Add New Reminder Form */}
              <form onSubmit={handleAddReminder} className="flux-reminders-form">
                <div className="flux-reminder-input-row">
                  <div className="flux-time-input-wrap">
                    <Clock size={16} className="flux-input-icon" />
                    <input
                      type="time"
                      value={reminderTime}
                      onChange={(e) => setReminderTime(e.target.value)}
                      className="flux-time-input"
                      required
                      aria-label="Reminder Time"
                    />
                  </div>
                  <input
                    type="text"
                    value={reminderLabel}
                    onChange={(e) => setReminderLabel(e.target.value)}
                    placeholder="Session label..."
                    className="flux-label-input"
                    maxLength={32}
                    aria-label="Session Label"
                  />
                </div>

                {/* Weekday Toggle Pills */}
                <div className="flux-weekday-pills">
                  {WEEKDAY_LABELS.map((day, idx) => {
                    const isSelected = selectedWeekdays.includes(idx);
                    return (
                      <button
                        key={idx}
                        type="button"
                        className={`flux-weekday-pill ${isSelected ? 'active' : ''}`}
                        onClick={() => handleToggleDay(idx)}
                        aria-pressed={isSelected}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>

                <div className="flux-reminders-form-actions">
                  <button
                    type="button"
                    className="flux-chime-test-btn"
                    onClick={playGentleChime}
                    title="Test gentle chime audio"
                  >
                    <Volume2 size={15} />
                    <span>Test sound</span>
                  </button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    icon={Plus}
                  >
                    Add Reminder
                  </Button>
                </div>
              </form>

              {/* Active Reminders List */}
              <div className="flux-reminders-list">
                <h4 className="flux-reminders-list-heading">Scheduled Sessions</h4>
                {loadingReminders ? (
                  <div className="flux-reminders-empty">Loading reminders...</div>
                ) : reminders.length === 0 ? (
                  <div className="flux-reminders-empty">
                    No study reminders scheduled yet. Add one above to keep your daily learning streak active!
                  </div>
                ) : (
                  reminders.map((rem) => (
                    <div key={rem.id} className="flux-reminder-row">
                      <div className="flux-reminder-time-col">
                        <span className="flux-reminder-time">{rem.time}</span>
                        <span className="flux-reminder-label">{rem.label || 'Study Session'}</span>
                      </div>
                      <div className="flux-reminder-actions">
                        <button
                          type="button"
                          className={`flux-reminder-toggle ${rem.enabled ? 'is-on' : 'is-off'}`}
                          onClick={() => handleToggleEnabled(rem)}
                          aria-label={rem.enabled ? 'Disable reminder' : 'Enable reminder'}
                        >
                          {rem.enabled ? <Check size={14} /> : null}
                        </button>
                        <button
                          type="button"
                          className="flux-reminder-del-btn"
                          onClick={() => handleDeleteReminder(rem.id)}
                          aria-label="Delete reminder"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </OverlayPortal>
      )}
    </>
  );
}
