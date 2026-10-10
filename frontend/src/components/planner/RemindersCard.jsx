import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Bell, Plus, Trash2, Clock, Check, BellRing, Volume2 } from 'lucide-react';
import {
  getReminders,
  createReminder,
  updateReminder,
  deleteReminder
} from '../../api/client';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function RemindersCard({ onToast = () => {} }) {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState('19:00');
  const [label, setLabel] = useState('Study Session');
  const [selectedWeekdays, setSelectedWeekdays] = useState([0, 1, 2, 3, 4, 5, 6]);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'default'
  );

  const lastFiredMinuteRef = useRef('');

  // Load reminders from server on mount
  useEffect(() => {
    loadReminders();
  }, []);

  const loadReminders = async () => {
    setLoading(true);
    try {
      const data = await getReminders();
      setReminders(data?.reminders || []);
    } catch (err) {
      console.error('Failed to load reminders:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleWeekday = (dayIdx) => {
    setSelectedWeekdays((prev) => {
      if (prev.includes(dayIdx)) {
        if (prev.length === 1) return prev; // Keep at least one
        return prev.filter((d) => d !== dayIdx);
      }
      return [...prev, dayIdx].sort((a, b) => a - b);
    });
  };

  const handleAddReminder = async (e) => {
    e.preventDefault();
    if (!time) return;

    try {
      const res = await createReminder({
        time,
        weekdays: selectedWeekdays,
        label,
        enabled: true
      });
      if (res?.reminder) {
        setReminders((prev) => [...prev, res.reminder]);
        onToast({
          type: 'success',
          message: `Reminder set for ${time} (${label})`
        });
      }
    } catch (err) {
      onToast({
        type: 'error',
        message: err.message || 'Failed to add reminder'
      });
    }
  };

  const handleToggleEnabled = async (rem) => {
    try {
      const updated = await updateReminder(rem.id, { enabled: !rem.enabled });
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
  };

  const handleDelete = async (id) => {
    try {
      await deleteReminder(id);
      setReminders((prev) => prev.filter((r) => r.id !== id));
      onToast({
        type: 'info',
        message: 'Reminder deleted'
      });
    } catch (err) {
      onToast({
        type: 'error',
        message: 'Could not delete reminder'
      });
    }
  };

  const requestBrowserPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setNotificationPermission(perm);
        if (perm === 'granted') {
          onToast({
            type: 'success',
            message: 'Browser notifications enabled!'
          });
          new Notification('ConceptLens Reminders', {
            body: 'Study alerts are now active for this browser.',
            icon: '/favicon.ico'
          });
        }
      } catch (err) {
        console.error('Notification permission error:', err);
      }
    }
  };

  const handleTestAlert = () => {
    const msg = `Time to study! Test alert for ${label}.`;
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

  // 20-second background checker for active reminders
  useEffect(() => {
    const checkInterval = setInterval(() => {
      const now = new Date();
      // Monday = 0, ..., Sunday = 6
      const currentDay = (now.getDay() + 6) % 7;
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      const minuteKey = `${now.toDateString()}-${timeStr}`;

      if (lastFiredMinuteRef.current === minuteKey) {
        return; // Already triggered this minute
      }

      reminders.forEach((r) => {
        if (r.enabled && r.time === timeStr && r.weekdays?.includes(currentDay)) {
          lastFiredMinuteRef.current = minuteKey;
          const msg = `Study Time: ${r.label} scheduled for ${r.time}!`;
          onToast({
            type: 'info',
            message: msg
          });
          if (
            typeof window !== 'undefined' &&
            'Notification' in window &&
            Notification.permission === 'granted'
          ) {
            new Notification('ConceptLens Reminder', {
              body: msg,
              icon: '/favicon.ico'
            });
          }
        }
      });
    }, 20000);

    return () => clearInterval(checkInterval);
  }, [reminders, onToast]);

  // Compute Next Upcoming Reminder
  const nextReminderText = useMemo(() => {
    const enabledReminders = reminders.filter((r) => r.enabled);
    if (enabledReminders.length === 0) return null;

    const now = new Date();
    const currentDay = (now.getDay() + 6) % 7;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    let closest = null;
    let minDiff = Infinity;

    enabledReminders.forEach((r) => {
      const [rHour, rMin] = r.time.split(':').map(Number);
      const rMinutes = rHour * 60 + rMin;

      // Check upcoming instances across 7 days
      for (let offset = 0; offset < 7; offset++) {
        const targetDay = (currentDay + offset) % 7;
        if (r.weekdays?.includes(targetDay)) {
          const diffMinutes = offset * 24 * 60 + (rMinutes - currentMinutes);
          if (diffMinutes > 0 && diffMinutes < minDiff) {
            minDiff = diffMinutes;
            closest = {
              reminder: r,
              offset,
              time: r.time,
              dayName: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : WEEKDAY_NAMES[targetDay]
            };
          }
        }
      }
    });

    if (!closest) return null;
    return `${closest.dayName} at ${closest.time} (${closest.reminder.label})`;
  }, [reminders]);

  return (
    <div className="planner-section-card">
      <div className="planner-section-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={20} color="var(--planner-orange)" />
          Study Reminders
        </span>
      </div>

      <form onSubmit={handleAddReminder} className="reminders-input-grid">
        <div className="reminders-inputs-row">
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="reminder-time-input"
            aria-label="Reminder Time"
            required
          />

          <select
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="reminder-label-select"
            aria-label="Reminder Focus Type"
          >
            <option value="Study Session">Study Session</option>
            <option value="Daily Review">Daily Review</option>
            <option value="Practice Quiz">Practice Quiz</option>
            <option value="Deep Focus">Deep Focus</option>
            <option value="Chapter Catchup">Chapter Catchup</option>
          </select>
        </div>

        {/* Weekday Toggles: M T W T F S S */}
        <div>
          <div style={{ fontSize: '0.82rem', color: 'var(--planner-text-muted)', marginBottom: 6 }}>
            Active Days:
          </div>
          <div className="weekdays-pill-group" role="group" aria-label="Select weekdays">
            {WEEKDAY_LABELS.map((wLabel, idx) => {
              const active = selectedWeekdays.includes(idx);
              return (
                <button
                  key={idx}
                  type="button"
                  className={`weekday-toggle-btn ${active ? 'active' : ''}`}
                  onClick={() => handleToggleWeekday(idx)}
                  aria-pressed={active}
                  aria-label={`${WEEKDAY_NAMES[idx]}`}
                  title={`${WEEKDAY_NAMES[idx]}`}
                >
                  {wLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div className="reminders-actions-row">
          <button type="submit" className="reminder-btn-add">
            <Plus size={15} style={{ display: 'inline', marginRight: 4 }} />
            Add Reminder
          </button>

          <button
            type="button"
            className="reminder-btn-secondary"
            onClick={handleTestAlert}
          >
            <Volume2 size={14} style={{ display: 'inline', marginRight: 4 }} />
            Test Alert
          </button>

          {notificationPermission !== 'granted' && (
            <button
              type="button"
              className="reminder-btn-secondary"
              onClick={requestBrowserPermission}
            >
              <BellRing size={14} style={{ display: 'inline', marginRight: 4 }} />
              Allow Browser Alerts
            </button>
          )}
        </div>
      </form>

      {/* Reminders List */}
      <div className="reminders-list">
        {loading && reminders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--planner-text-muted)' }}>
            Loading alerts...
          </div>
        ) : reminders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px', color: 'var(--planner-text-muted)', fontSize: '0.9rem' }}>
            No reminders scheduled yet. Add one above to build your daily study routine!
          </div>
        ) : (
          reminders.map((r) => {
            const daysDisplay =
              r.weekdays?.length === 7
                ? 'Every day'
                : r.weekdays?.map((d) => WEEKDAY_NAMES[d]).join(', ');

            return (
              <div key={r.id} className="reminder-item">
                <div className="reminder-item-left">
                  <Clock size={18} color="var(--planner-mint)" />
                  <div>
                    <div className="reminder-item-time">{r.time}</div>
                    <div className="reminder-item-label">{r.label}</div>
                  </div>
                </div>

                <div className="reminder-item-right">
                  <span className="reminder-item-days">{daysDisplay}</span>

                  {/* Toggle button */}
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(r)}
                    style={{
                      background: r.enabled ? 'var(--planner-mint)' : 'var(--planner-card-border)',
                      color: r.enabled ? '#ffffff' : 'var(--planner-text-muted)',
                      border: 'none',
                      borderRadius: '999px',
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                    aria-label={`Toggle reminder for ${r.time}`}
                  >
                    {r.enabled ? 'ON' : 'OFF'}
                  </button>

                  {/* Delete button */}
                  <button
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--planner-text-muted)',
                      cursor: 'pointer',
                      padding: '4px'
                    }}
                    aria-label={`Delete reminder for ${r.time}`}
                    title="Delete reminder"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {nextReminderText && (
        <div className="next-reminder-banner">
          <BellRing size={16} />
          <span>
            Next reminder: <strong>{nextReminderText}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
