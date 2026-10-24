import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  Eye, 
  EyeOff, 
  Check, 
  AlertCircle, 
  Info
} from 'lucide-react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { getAuthConfig } from '../api/client';
import { Logo, BookshelfLoader } from './ui';
import { OverlayPortal, lockBodyScroll, unlockBodyScroll } from './ui/Overlay';

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || '';

const COMMON_PASSWORDS = new Set([
  'password', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'admin123', 'welcome123', 'letmein123', 'iloveyou', 'abc12345'
]);

function evaluatePasswordStrength(password) {
  if (!password) return { score: 0, label: '', helper: '' };
  if (password.length < 8) {
    return { score: 1, label: 'Too short', helper: 'Must be at least 8 characters' };
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { score: 1, label: 'Too common', helper: 'Avoid easily guessed words' };
  }
  let score = 1;
  if (password.length >= 10) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;

  if (score === 1) return { score: 1, label: 'Weak', helper: 'Add numbers or uppercase letters' };
  if (score === 2) return { score: 2, label: 'Fair', helper: 'Mix letters, numbers, and symbols' };
  if (score === 3) return { score: 3, label: 'Good', helper: 'Strong password' };
  return { score: 4, label: 'Strong', helper: 'Excellent password' };
}

function getStrengthSegmentColor(index, score, isDark) {
  const defaultGrey = isDark ? '#3A3A3E' : '#E6E6E8';
  if (!score || score <= 0) return defaultGrey;
  if (score === 1) {
    return index === 0 ? '#EF4444' : defaultGrey;
  }
  if (score === 2) {
    return index <= 1 ? '#F5C46B' : defaultGrey;
  }
  if (score === 3) {
    if (index <= 1) return '#D7F25C';
    if (index === 2) return '#F5C46B';
    return defaultGrey;
  }
  if (score >= 4) {
    return '#D7F25C';
  }
  return defaultGrey;
}

/**
 * Centered Split AuthModal Component — Flux Visual System
 * Left: #1B1B1D dark half with logo, headline, subtitle, and overlapping lime/lavender circles.
 * Right: White/dark card with pill switcher, pill inputs, 4-bar strength meter, lime submit button.
 * Mobile: Bottom sheet with drag handle & swipe-down dismiss.
 */
export default function AuthModal({ onSuccess }) {
  const { 
    authModalOpen, 
    authModalTab, 
    authModalPrompt, 
    closeAuthModal,
    signIn,
    signUp,
    signInWithGoogle,
    setRole
  } = useAuth();

  const [tab, setTab] = useState(authModalTab || 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRoleState] = useState('student');

  // First-time Google sign in role step
  const [googleNeedsRole, setGoogleNeedsRole] = useState(false);
  const [googlePendingUser, setGooglePendingUser] = useState(null);
  const [chosenGoogleRole, setChosenGoogleRole] = useState('student');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [isShaking, setIsShaking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const [activeGoogleClientId, setActiveGoogleClientId] = useState(
    () => googleClientId
  );

  useEffect(() => {
    if (!activeGoogleClientId) {
      getAuthConfig().then((cfg) => {
        if (cfg?.google_client_id) {
          setActiveGoogleClientId(cfg.google_client_id.trim());
        }
      }).catch(() => {});
    }
  }, [activeGoogleClientId]);

  // Dynamic theme detection
  const [currentTheme, setCurrentTheme] = useState(() => {
    return document.documentElement.getAttribute('data-theme') || 'light';
  });

  useEffect(() => {
    const updateTheme = () => {
      const activeTheme = document.documentElement.getAttribute('data-theme') || 'light';
      setCurrentTheme(activeTheme);
    };
    updateTheme();
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const isDark = currentTheme === 'dark';

  // Responsive Google button width
  const [googleBtnWidth, setGoogleBtnWidth] = useState(380);
  const googleBtnRef = useRef(null);

  useEffect(() => {
    if (!googleBtnRef.current) return;
    const calculateWidth = () => {
      if (googleBtnRef.current) {
        const measured = googleBtnRef.current.offsetWidth || 380;
        const clamped = Math.max(220, Math.min(400, Math.floor(measured)));
        setGoogleBtnWidth(clamped);
      }
    };
    calculateWidth();
    window.addEventListener('resize', calculateWidth);
    return () => window.removeEventListener('resize', calculateWidth);
  }, [activeGoogleClientId, tab]);



  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Mobile swipe down gesture tracking
  const touchStartYRef = useRef(null);
  const handleTouchStart = (e) => {
    touchStartYRef.current = e.touches[0].clientY;
  };
  const handleTouchMove = (e) => {
    if (touchStartYRef.current === null) return;
    const currentY = e.touches[0].clientY;
    if (currentY - touchStartYRef.current > 75) {
      handleCloseRequest();
      touchStartYRef.current = null;
    }
  };
  const handleTouchEnd = () => {
    touchStartYRef.current = null;
  };

  // Sync tab with context when modal opens or tab changes externally
  useEffect(() => {
    if (authModalTab) {
      setTab(authModalTab);
      setGoogleNeedsRole(false);
      setGooglePendingUser(null);
    }
  }, [authModalTab]);

  // Record active element, focus first input, scroll lock
  useEffect(() => {
    if (authModalOpen) {
      previouslyFocusedRef.current = document.activeElement;
      setIsClosing(false);
      setIsSuccess(false);
      setServerError('');
      setFieldErrors({});

      lockBodyScroll();

      const timer = setTimeout(() => {
        if (firstInputRef.current) {
          firstInputRef.current.focus();
        }
      }, 120);

      return () => {
        clearTimeout(timer);
        unlockBodyScroll();
        if (previouslyFocusedRef.current && previouslyFocusedRef.current.focus) {
          previouslyFocusedRef.current.focus();
        }
      };
    }
  }, [authModalOpen]);

  // Trigger error shake animation
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    const timer = setTimeout(() => setIsShaking(false), 340);
    return () => clearTimeout(timer);
  }, []);

  // Safe close request
  const handleCloseRequest = useCallback(() => {
    if (tab === 'signup' && (email || password || confirmPassword || displayName)) {
      if (!window.confirm('Discard unsaved registration details?')) {
        return;
      }
    }
    setIsClosing(true);
    setTimeout(() => {
      closeAuthModal();
      setIsClosing(false);
      setEmail('');
      setPassword('');
      setConfirmPassword('');
      setDisplayName('');
      setServerError('');
      setFieldErrors({});
      setGoogleNeedsRole(false);
      setGooglePendingUser(null);
    }, 160);
  }, [tab, email, password, confirmPassword, displayName, closeAuthModal]);

  // Focus trap and Escape key listener
  useEffect(() => {
    if (!authModalOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseRequest();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authModalOpen, handleCloseRequest]);

  // Live password strength calculation
  const strength = evaluatePasswordStrength(password);

  // Switch tabs
  const handleTabChange = (newTab) => {
    setTab(newTab);
    setServerError('');
    setFieldErrors({});
    setGoogleNeedsRole(false);
    setGooglePendingUser(null);
    setTimeout(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      }
    }, 60);
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const errors = {};

    if (tab === 'signup') {
      const cleanName = displayName.trim();
      const cleanEmail = email.trim().toLowerCase();

      if (!cleanName) {
        errors.displayName = 'Please enter your name.';
      }

      if (!cleanEmail) {
        errors.email = 'Please enter your email address.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        errors.email = 'Please enter a valid email address.';
      }

      if (!password) {
        errors.password = 'Please enter a password.';
      } else if (password.length < 8) {
        errors.password = 'Password must be at least 8 characters long.';
      }

      if (!confirmPassword) {
        errors.confirmPassword = 'Please confirm your password.';
      } else if (password !== confirmPassword) {
        errors.confirmPassword = 'Passwords do not match.';
      }
    } else {
      const cleanInput = email.trim();
      if (!cleanInput) {
        errors.email = 'Please enter your email.';
      }
      if (!password) {
        errors.password = 'Please enter a password.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      triggerShake();
      return;
    }

    setLoading(true);

    try {
      let userData;
      if (tab === 'signup') {
        userData = await signUp({
          name: displayName.trim(),
          displayName: displayName.trim(),
          email: email.trim().toLowerCase(),
          password,
          confirmPassword,
          role: role || 'student',
        });
      } else {
        userData = await signIn(email.trim(), password);
      }

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        closeAuthModal();
        if (onSuccess) onSuccess(userData.user || userData, tab);
      }, 500);
    } catch (err) {
      let message = err.message || 'Authentication failed.';
      if (err.status === 429 || message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('too many')) {
        message = 'Too many requests. Please wait a minute and try again.';
      } else if (tab === 'signin' && (err.status === 400 || message.toLowerCase().includes('incorrect') || message.toLowerCase().includes('invalid'))) {
        message = 'Invalid email or password.';
      }
      setServerError(message);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  // Google Login Error Handler
  const handleGoogleError = (err) => {
    setLoading(false);
    let friendly = 'Google sign-in was canceled or closed. Please try again.';
    if (err?.type === 'popup_closed') {
      friendly = 'The Google sign-in window was closed before completing.';
    } else if (err?.type === 'popup_blocked_by_browser') {
      friendly = 'The Google sign-in window was blocked by your browser.';
    }
    setServerError(friendly);
    triggerShake();
  };

  // Google Login Success Handler
  const handleGoogleSuccess = async (credentialResponse) => {
    if (!credentialResponse?.credential) {
      setServerError('Google sign-in did not return a valid credential. Please try again.');
      triggerShake();
      return;
    }

    setLoading(true);
    setServerError('');
    try {
      const resp = await signInWithGoogle(credentialResponse.credential);
      const userObj = resp?.user || resp;

      if (resp?.needs_role || resp?.requires_role || !userObj?.role) {
        setGooglePendingUser(resp);
        setGoogleNeedsRole(true);
        setLoading(false);
        return;
      }

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        closeAuthModal();
        if (onSuccess) onSuccess(userObj, 'google');
      }, 500);
    } catch (err) {
      let friendlyMessage = 'We could not sign you in with Google right now. Please try again.';
      const raw = (err?.message || '').toLowerCase();
      if (raw.includes('network') || raw.includes('failed to fetch')) {
        friendlyMessage = 'Network connection problem. Please try again.';
      } else if (raw.includes('popup')) {
        friendlyMessage = 'Google sign-in popup was closed or blocked.';
      }
      setServerError(friendlyMessage);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  // First-time Google role completion handler
  const handleCompleteGoogleRole = async (e) => {
    e.preventDefault();
    setLoading(true);
    setServerError('');
    try {
      await setRole(chosenGoogleRole);
      const finalUser = {
        ...(googlePendingUser?.user || googlePendingUser),
        role: chosenGoogleRole,
      };
      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setGoogleNeedsRole(false);
        setGooglePendingUser(null);
        closeAuthModal();
        if (onSuccess) onSuccess(finalUser, 'google');
      }, 500);
    } catch (err) {
      setServerError(err?.message || 'Failed to set account role.');
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  if (!authModalOpen) return null;

  return (
    <OverlayPortal>
      <div 
        className={`auth-modal-backdrop ${isClosing ? 'closing' : ''}`}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            handleCloseRequest();
          }
        }}
        role="presentation"
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-dialog-title"
          aria-describedby="auth-dialog-desc"
          className={`auth-modal-dialog ${isClosing ? 'dialog-closing' : ''} ${isShaking ? 'auth-form-shake' : ''}`}
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Subtle Top-Right Close Button */}
          <button
            type="button"
            className="auth-modal-close-btn"
            onClick={handleCloseRequest}
            aria-label="Close dialog"
          >
            <X size={18} strokeWidth={2} />
          </button>

          {/* =================================================================
              LEFT PANEL (Desktop >= 768px): Solid Dark (#1B1B1D)
              ================================================================= */}
          <div className="auth-panel-left">
            <div className="auth-left-top">
              <div className="auth-left-brand">
                <Logo size={32} />
              </div>
            </div>

            <div className="auth-left-middle">
              <h2 id="auth-dialog-title" className="auth-left-headline">
                {tab === 'signin' ? 'Sign in to your' : 'Create your'}{' '}
                <span className="auth-headline-highlight">workspace</span>
              </h2>
              <p id="auth-dialog-desc" className="auth-left-subtitle">
                Your notes, concepts and study plan stay private to you.
              </p>
            </div>

            <div className="auth-left-bottom">
              <div className="auth-overlapping-circles" aria-hidden="true">
                <div className="auth-circle auth-circle--lime" />
                <div className="auth-circle auth-circle--lavender" />
              </div>
            </div>
          </div>

          {/* =================================================================
              RIGHT PANEL: White / var(--card)
              ================================================================= */}
          <div className="auth-panel-right">
            {/* Mobile Bottom Sheet Drag Handle (<768px) */}
            <div className="auth-mobile-handle" aria-hidden="true" />

            {/* Mobile Condensed Header (<768px) */}
            <div className="auth-mobile-header">
              <Logo size={28} />
            </div>

            {googleNeedsRole ? (
              /* First-time Google OAuth Role Selection Step */
              <form onSubmit={handleCompleteGoogleRole} className="auth-fields-form" noValidate>
                <div className="auth-heading-block">
                  <h3 className="auth-form-title">Choose your role</h3>
                  <p className="auth-form-subtitle">
                    Select your workspace mode to customize your dashboard.
                  </p>
                </div>

                {serverError && (
                  <div className="auth-error-pill" role="alert" aria-live="polite">
                    <AlertCircle size={14} />
                    <span>{serverError}</span>
                  </div>
                )}

                <div className="auth-role-cards-col">
                  <div
                    className={`auth-role-card ${chosenGoogleRole === 'student' ? 'selected' : ''}`}
                    onClick={() => setChosenGoogleRole('student')}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="auth-role-icon">🎓</span>
                    <div>
                      <div className="auth-role-title">Student</div>
                      <div className="auth-role-desc">
                        Personal study planner, chapters progress, and concept tree notes.
                      </div>
                    </div>
                  </div>

                  <div
                    className={`auth-role-card ${chosenGoogleRole === 'teacher' ? 'selected' : ''}`}
                    onClick={() => setChosenGoogleRole('teacher')}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="auth-role-icon">👨‍🏫</span>
                    <div>
                      <div className="auth-role-title">Teacher / Professor</div>
                      <div className="auth-role-desc">
                        Syllabus mapping, structured guides, and student learning analytics.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="auth-submit-wrap">
                  <button
                    type="submit"
                    disabled={loading || isSuccess}
                    className="auth-btn-lime"
                  >
                    {loading ? (
                      <span className="auth-btn-content">
                        <BookshelfLoader size="sm" label="Setting up..." />
                        <span>Setting up...</span>
                      </span>
                    ) : (
                      <span>Continue to Dashboard</span>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <>
                {/* Pill Tab Switcher: [ Sign in | Create account ] */}
                <div className="auth-pill-switcher" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'signin'}
                    className={`auth-switcher-pill ${tab === 'signin' ? 'active' : ''}`}
                    onClick={() => handleTabChange('signin')}
                  >
                    Sign in
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'signup'}
                    className={`auth-switcher-pill ${tab === 'signup' ? 'active' : ''}`}
                    onClick={() => handleTabChange('signup')}
                  >
                    Create account
                  </button>
                </div>

                {/* Prompt banner (if opened by limit, expiration, etc.) */}
                {authModalPrompt && (
                  <div className="auth-prompt-pill" role="status">
                    <Info size={14} />
                    <span>{authModalPrompt}</span>
                  </div>
                )}

                {/* Server Error Soft Red Pill */}
                {serverError && (
                  <div className="auth-error-pill" role="alert" aria-live="polite">
                    <AlertCircle size={14} />
                    <span>{serverError}</span>
                  </div>
                )}

                {/* Form */}
                <form onSubmit={handleSubmit} className="auth-fields-form" noValidate>
                  {/* Create Account: Role Selector */}
                  {tab === 'signup' && (
                    <div className="auth-field-group">
                      <label className="auth-field-label">I am a</label>
                      <div className="auth-role-pills">
                        <button
                          type="button"
                          className={`auth-role-pill-btn ${role === 'student' ? 'active' : ''}`}
                          onClick={() => setRoleState('student')}
                        >
                          <span>🎓</span>
                          <span>Student</span>
                        </button>
                        <button
                          type="button"
                          className={`auth-role-pill-btn ${role === 'teacher' ? 'active' : ''}`}
                          onClick={() => setRoleState('teacher')}
                        >
                          <span>👨‍🏫</span>
                          <span>Teacher</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Create Account: Full Name */}
                  {tab === 'signup' && (
                    <div className="auth-field-group">
                      <label htmlFor="auth-display-name" className="auth-field-label">
                        Full Name
                      </label>
                      <input
                        ref={tab === 'signup' ? firstInputRef : null}
                        id="auth-display-name"
                        type="text"
                        autoComplete="name"
                        placeholder="e.g. Himanshu"
                        value={displayName}
                        onChange={(e) => {
                          setDisplayName(e.target.value);
                          if (fieldErrors.displayName) {
                            setFieldErrors((prev) => ({ ...prev, displayName: null }));
                          }
                        }}
                        className={`auth-pill-input ${fieldErrors.displayName ? 'has-field-error' : ''}`}
                        aria-invalid={!!fieldErrors.displayName}
                        disabled={loading || isSuccess}
                      />
                      {fieldErrors.displayName && (
                        <span className="auth-field-error-pill" role="alert">
                          {fieldErrors.displayName}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Email Field (for both sign in and sign up) */}
                  <div className="auth-field-group">
                    <label htmlFor="auth-email-field" className="auth-field-label">
                      Email
                    </label>
                    <input
                      ref={tab === 'signin' ? firstInputRef : null}
                      id="auth-email-field"
                      type={tab === 'signup' ? 'email' : 'text'}
                      autoComplete="email"
                      placeholder={tab === 'signin' ? 'Enter your email' : 'e.g. himanshu06618@gmail.com'}
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldErrors.email) {
                          setFieldErrors((prev) => ({ ...prev, email: null }));
                        }
                      }}
                      className={`auth-pill-input ${fieldErrors.email ? 'has-field-error' : ''}`}
                      aria-invalid={!!fieldErrors.email}
                      disabled={loading || isSuccess}
                    />

                    {fieldErrors.email && (
                      <span className="auth-field-error-pill" role="alert">
                        {fieldErrors.email}
                      </span>
                    )}
                  </div>

                  {/* Password Field */}
                  <div className="auth-field-group">
                    <label htmlFor="auth-password-field" className="auth-field-label">
                      Password
                    </label>
                    <div className="auth-input-wrap">
                      <input
                        id="auth-password-field"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (fieldErrors.password) {
                            setFieldErrors((prev) => ({ ...prev, password: null }));
                          }
                        }}
                        className={`auth-pill-input ${fieldErrors.password ? 'has-field-error' : ''}`}
                        aria-invalid={!!fieldErrors.password}
                        disabled={loading || isSuccess}
                      />
                      <button
                        type="button"
                        className="auth-eye-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>

                    {fieldErrors.password && (
                      <span className="auth-field-error-pill" role="alert">
                        {fieldErrors.password}
                      </span>
                    )}

                    {/* 4-segment Password Strength Meter matching exact design */}
                    <div className="auth-strength-meter" aria-label="Password strength meter">
                      {[0, 1, 2, 3].map((idx) => (
                        <span
                          key={idx}
                          className="auth-strength-bar"
                          style={{
                            backgroundColor: getStrengthSegmentColor(idx, password ? (strength.score || 1) : 0, isDark)
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Create Account: Confirm Password */}
                  {tab === 'signup' && (
                    <div className="auth-field-group">
                      <label htmlFor="auth-confirm-password-field" className="auth-field-label">
                        Confirm password
                      </label>
                      <div className="auth-input-wrap">
                        <input
                          id="auth-confirm-password-field"
                          type={showConfirmPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          placeholder="Confirm password"
                          value={confirmPassword}
                          onChange={(e) => {
                            setConfirmPassword(e.target.value);
                            if (fieldErrors.confirmPassword) {
                              setFieldErrors((prev) => ({ ...prev, confirmPassword: null }));
                            }
                          }}
                          className={`auth-pill-input ${fieldErrors.confirmPassword ? 'has-field-error' : ''}`}
                          aria-invalid={!!fieldErrors.confirmPassword}
                          disabled={loading || isSuccess}
                        />
                        <button
                          type="button"
                          className="auth-eye-btn"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          aria-label={showConfirmPassword ? 'Hide password confirmation' : 'Show password confirmation'}
                          tabIndex={-1}
                        >
                          {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>

                      {fieldErrors.confirmPassword && (
                        <span className="auth-field-error-pill" role="alert">
                          {fieldErrors.confirmPassword}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Primary Lime Action Button */}
                  <div className="auth-submit-wrap">
                    <button
                      type="submit"
                      disabled={loading || isSuccess}
                      className="auth-btn-lime"
                    >
                      {isSuccess ? (
                        <span className="auth-btn-content">
                          <Check size={18} strokeWidth={2.4} />
                          <span>{tab === 'signin' ? 'Welcome back!' : 'Account created!'}</span>
                        </span>
                      ) : loading ? (
                        <span className="auth-btn-content">
                          <BookshelfLoader size="sm" label="Authenticating..." />
                          <span>{tab === 'signin' ? 'Signing in...' : 'Creating account...'}</span>
                        </span>
                      ) : (
                        <span>{tab === 'signin' ? 'Sign in' : 'Create account'}</span>
                      )}
                    </button>
                  </div>

                  {/* Continue with Google Button (Hidden when VITE_GOOGLE_CLIENT_ID is empty) */}
                  {activeGoogleClientId ? (
                    <div className="auth-google-section">
                      <div ref={googleBtnRef} className="google-btn-wrapper">
                        <GoogleOAuthProvider clientId={activeGoogleClientId}>
                          <GoogleLogin
                            onSuccess={handleGoogleSuccess}
                            onError={handleGoogleError}
                            theme={isDark ? 'filled_black' : 'outline'}
                            size="large"
                            text="continue_with"
                            shape="pill"
                            width={googleBtnWidth ? `${googleBtnWidth}` : '380'}
                          />
                        </GoogleOAuthProvider>
                      </div>
                    </div>
                  ) : null}
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
