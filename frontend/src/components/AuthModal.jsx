import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  Eye, 
  EyeOff, 
  Check, 
  Sparkles, 
  AlertCircle, 
  ShieldCheck, 
  Cloud, 
  Zap,
  Info
} from 'lucide-react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { useAuth } from '../context/AuthContext';
import { checkUsernameAvailability, getAuthConfig } from '../api/client';
import { LogoMark, BookshelfLoader, SegmentedTabs } from './ui';
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

/**
 * Animated Mini Concept Tree Illustration for Left Panel
 */
function MiniConceptTreeIllustration() {
  return (
    <div className="mini-concept-tree-wrap" aria-hidden="true">
      <svg
        width="220"
        height="84"
        viewBox="0 0 220 84"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="mini-tree-svg"
      >
        <defs>
          <linearGradient id="mTreeGold" x1="0" y1="0" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#C4F560" />
            <stop offset="100%" stopColor="#3E7806" />
          </linearGradient>
          <linearGradient id="mTreeSage" x1="0" y1="0" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#3E7806" />
          </linearGradient>
          <radialGradient id="mTreeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#C4F560" stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle cx="110" cy="18" r="30" fill="url(#mTreeGlow)" />

        {/* Tree branch lines */}
        <path
          d="M110 18 C 85 32, 45 42, 45 64"
          stroke="url(#mTreeGold)"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="mini-tree-branch branch-1"
        />
        <path
          d="M110 18 C 110 36, 110 46, 110 64"
          stroke="url(#mTreeSage)"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="mini-tree-branch branch-2"
        />
        <path
          d="M110 18 C 135 32, 175 42, 175 64"
          stroke="url(#mTreeGold)"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="mini-tree-branch branch-3"
        />

        {/* Outer sub-branches */}
        <path
          d="M45 64 C 32 70, 26 74, 20 78"
          stroke="rgba(57, 127, 105, 0.45)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <path
          d="M175 64 C 188 70, 194 74, 200 78"
          stroke="rgba(168, 213, 194, 0.45)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Nodes */}
        <g className="mini-tree-node node-root">
          <circle cx="110" cy="18" r="7" fill="#252D2A" stroke="url(#mTreeGold)" strokeWidth="1.8" />
          <circle cx="110" cy="18" r="2.8" fill="#397F69" />
        </g>
        <g className="mini-tree-node node-left">
          <circle cx="45" cy="64" r="5" fill="#252D2A" stroke="url(#mTreeGold)" strokeWidth="1.4" />
          <circle cx="45" cy="64" r="2" fill="#397F69" />
        </g>
        <g className="mini-tree-node node-center">
          <circle cx="110" cy="64" r="5" fill="#252D2A" stroke="url(#mTreeSage)" strokeWidth="1.4" />
          <circle cx="110" cy="64" r="2" fill="#397F69" />
        </g>
        <g className="mini-tree-node node-right">
          <circle cx="175" cy="64" r="5" fill="#252D2A" stroke="url(#mTreeGold)" strokeWidth="1.4" />
          <circle cx="175" cy="64" r="2" fill="#397F69" />
        </g>

        {/* Subtle leaf dots */}
        <circle cx="20" cy="78" r="2.5" fill="#397F69" opacity="0.8" />
        <circle cx="200" cy="78" r="2.5" fill="#397F69" opacity="0.8" />
      </svg>
    </div>
  );
}

/**
 * Centered Split AuthModal Component
 * Single shared dialog for all entry points across the app.
 */
export default function AuthModal({ onSuccess, guestStatus }) {
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
  const [username, setUsername] = useState('');
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

  // Log clear developer notice if Google client ID is missing
  useEffect(() => {
    if (!activeGoogleClientId) {
      console.warn(
        '[ConceptLens] Google Sign-In is disabled: VITE_GOOGLE_CLIENT_ID environment variable is missing. ' +
        'Add VITE_GOOGLE_CLIENT_ID to your environment variables on Vercel to enable "Continue with Google".'
      );
    }
  }, [activeGoogleClientId]);

  // Detect current theme (light or dark) dynamically
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

  // Responsive Google button width matching popup form up to 400px (Google maximum)
  const [googleBtnWidth, setGoogleBtnWidth] = useState(380);
  const googleBtnRef = useRef(null);

  useEffect(() => {
    if (!googleBtnRef.current) return;
    const calculateWidth = () => {
      if (googleBtnRef.current) {
        const measured = googleBtnRef.current.offsetWidth || 380;
        const clamped = Math.max(200, Math.min(400, Math.floor(measured)));
        setGoogleBtnWidth(clamped);
      }
    };
    calculateWidth();
    window.addEventListener('resize', calculateWidth);
    return () => window.removeEventListener('resize', calculateWidth);
  }, [activeGoogleClientId, tab]);

  // Username live availability status
  const [usernameStatus, setUsernameStatus] = useState(null);

  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);
  const previouslyFocusedRef = useRef(null);

  // Sync tab with context when modal opens or tab changes externally
  useEffect(() => {
    if (authModalTab) {
      setTab(authModalTab);
      setGoogleNeedsRole(false);
      setGooglePendingUser(null);
    }
  }, [authModalTab]);

  // Record active element when opened, restore focus on close
  useEffect(() => {
    if (authModalOpen) {
      previouslyFocusedRef.current = document.activeElement;
      setIsClosing(false);
      setIsSuccess(false);
      setServerError('');
      setFieldErrors({});

      // Scroll lock with scrollbar width compensation to avoid layout shift
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      const originalOverflow = document.body.style.overflow;
      const originalPaddingRight = document.body.style.paddingRight;

      document.body.style.overflow = 'hidden';
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }

      // Focus first input
      const timer = setTimeout(() => {
        if (firstInputRef.current) {
          firstInputRef.current.focus();
        }
      }, 120);

      return () => {
        clearTimeout(timer);
        document.body.style.overflow = originalOverflow;
        document.body.style.paddingRight = originalPaddingRight;
        if (previouslyFocusedRef.current && previouslyFocusedRef.current.focus) {
          previouslyFocusedRef.current.focus();
        }
      };
    }
  }, [authModalOpen]);

  // Adjust max-height and scroll on mobile virtual keyboard changes
  useEffect(() => {
    if (!authModalOpen || !window.visualViewport) return;

    const handleVisualViewport = () => {
      if (!dialogRef.current) return;
      const vpHeight = window.visualViewport.height;
      dialogRef.current.style.maxHeight = `${Math.min(vpHeight * 0.92, 600)}px`;
      if (document.activeElement && dialogRef.current.contains(document.activeElement)) {
        document.activeElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    };

    window.visualViewport.addEventListener('resize', handleVisualViewport);
    window.visualViewport.addEventListener('scroll', handleVisualViewport);
    handleVisualViewport();

    return () => {
      window.visualViewport.removeEventListener('resize', handleVisualViewport);
      window.visualViewport.removeEventListener('scroll', handleVisualViewport);
    };
  }, [authModalOpen]);

  // Trigger error shake animation
  const triggerShake = useCallback(() => {
    setIsShaking(true);
    const timer = setTimeout(() => setIsShaking(false), 340);
    return () => clearTimeout(timer);
  }, []);

  // Safe close request with confirmation if user typed signup data
  const handleCloseRequest = useCallback(() => {
    if (tab === 'signup' && (username || password || confirmPassword || displayName)) {
      if (!window.confirm('Discard unsaved registration details?')) {
        return;
      }
    }
    setIsClosing(true);
    setTimeout(() => {
      closeAuthModal();
      setIsClosing(false);
      // Reset sensitive form fields
      setPassword('');
      setConfirmPassword('');
      setServerError('');
      setFieldErrors({});
      setGoogleNeedsRole(false);
      setGooglePendingUser(null);
    }, 160);
  }, [tab, username, password, confirmPassword, displayName, closeAuthModal]);

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

  // Lock body scroll when auth modal is open
  useEffect(() => {
    if (!authModalOpen) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [authModalOpen]);

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

  // Username blur check for registration
  const handleUsernameBlur = async () => {
    if (tab !== 'signup') return;
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameStatus(null);
      return;
    }
    if (clean.includes('@')) {
      // Email entered in username field
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
        setUsernameStatus({ available: true, message: 'Valid email' });
      } else {
        setUsernameStatus({ valid: false, message: 'Invalid email address' });
      }
      return;
    }
    if (clean.length < 3 || clean.length > 24) {
      setUsernameStatus({ valid: false, message: 'Must be 3 to 24 characters' });
      return;
    }
    if (!/^[a-zA-Z0-9_.]+$/.test(clean)) {
      setUsernameStatus({ valid: false, message: 'Letters, numbers, underscores, and dots only' });
      return;
    }

    setUsernameStatus({ checking: true });
    try {
      const res = await checkUsernameAvailability(clean);
      if (res.available) {
        setUsernameStatus({ available: true, message: 'Available' });
      } else {
        setUsernameStatus({ available: false, message: res.message || 'Already taken' });
      }
    } catch {
      setUsernameStatus({ available: false, message: 'Could not check availability' });
    }
  };

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    setServerError('');
    const errors = {};

    const cleanInput = username.trim();
    if (!cleanInput) {
      errors.username = tab === 'signin' ? 'Please enter your email or username.' : 'Please enter an email or username.';
    }

    if (!password) {
      errors.password = 'Please enter a password.';
    }

    if (tab === 'signup') {
      const isEmail = cleanInput.includes('@');
      if (cleanInput && !isEmail && (cleanInput.length < 3 || cleanInput.length > 24)) {
        errors.username = 'Username must be between 3 and 24 characters.';
      } else if (cleanInput && !isEmail && !/^[a-zA-Z0-9_.]+$/.test(cleanInput)) {
        errors.username = 'Username can only contain letters, numbers, underscores, and dots.';
      } else if (cleanInput && isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanInput)) {
        errors.username = 'Please enter a valid email address.';
      }

      if (password && password.length < 8) {
        errors.password = 'Password must be at least 8 characters long.';
      }

      if (password && confirmPassword && password !== confirmPassword) {
        errors.confirmPassword = 'Passwords do not match.';
      } else if (!confirmPassword) {
        errors.confirmPassword = 'Please confirm your password.';
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
        const isEmail = cleanInput.includes('@');
        userData = await signUp({
          email: isEmail ? cleanInput : undefined,
          username: !isEmail ? cleanInput : undefined,
          password,
          confirmPassword,
          displayName: displayName.trim() || undefined,
          role: role || 'student',
        });
      } else {
        userData = await signIn(cleanInput, password);
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
        message = 'Invalid email/username or password.';
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
      friendly = 'The Google sign-in window was blocked by your browser. Please allow popups for ConceptLens.';
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

      // New Google user with no role -> prompt role selection step
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
      if (raw.includes('network') || raw.includes('failed to fetch') || raw.includes('connection')) {
        friendlyMessage = 'Network connection problem. Please check your internet connection and try again.';
      } else if (raw.includes('popup') || raw.includes('closed') || raw.includes('blocked')) {
        friendlyMessage = 'The Google sign-in window was closed or blocked. Please allow popups and try again.';
      } else if (raw.includes('audience mismatch') || raw.includes('invalid') || raw.includes('expired')) {
        friendlyMessage = 'Google authentication session expired. Please try signing in again.';
      } else if (raw.includes('not verified')) {
        friendlyMessage = 'Your Google account email is not verified. Please verify your email with Google first.';
      } else if (raw.includes('rate limit') || raw.includes('too many attempts')) {
        friendlyMessage = 'Too many sign-in attempts. Please wait a minute before trying again.';
      } else if (raw.includes('not configured')) {
        friendlyMessage = 'Google sign-in is currently not configured on this server.';
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
        ...(googlePendingUser?.user || googlePendingUser || {}),
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
      let friendly = 'Failed to set account role. Please try again.';
      const raw = (err?.message || '').toLowerCase();
      if (raw.includes('network') || raw.includes('failed to fetch')) {
        friendly = 'Network connection issue. Please check your internet connection and try again.';
      }
      setServerError(friendly);
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  if (!authModalOpen) return null;

  const tabsData = [
    { id: 'signin', label: 'Sign in' },
    { id: 'signup', label: 'Create account' }
  ];

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
      >
        {/* Top-Right Close Button */}
        <button
          type="button"
          className="auth-modal-close-btn"
          onClick={handleCloseRequest}
          aria-label="Close dialog"
        >
          <X size={20} strokeWidth={1.8} />
        </button>

        {/* =================================================================
            LEFT PANEL (Desktop/Tablet >= 768px): Midnight Stage
            ================================================================= */}
        <div className="auth-panel-left">
          <div className="auth-left-ambient-glow" aria-hidden="true" />
          
          <div className="auth-left-top">
            <div className="auth-left-logo-wrap">
              <LogoMark size={36} idPrefix="auth-modal" />
            </div>

            <h2 className="auth-left-headline">
              Your notes, organized and saved.
            </h2>

            {/* Exactly 3 short benefits */}
            <ul className="auth-benefits-list">
              <li className="benefit-item">
                <span className="benefit-icon-badge">
                  <Cloud size={16} strokeWidth={2} />
                </span>
                <span className="benefit-text">Save notes across devices</span>
              </li>
              <li className="benefit-item">
                <span className="benefit-icon-badge">
                  <ShieldCheck size={16} strokeWidth={2} />
                </span>
                <span className="benefit-text">Keep your concept trees private</span>
              </li>
              <li className="benefit-item">
                <span className="benefit-icon-badge">
                  <Zap size={16} strokeWidth={2} />
                </span>
                <span className="benefit-text">Unlimited uploads</span>
              </li>
            </ul>
          </div>

          <div className="auth-left-bottom">
            {/* Animated mini concept tree illustration */}
            <MiniConceptTreeIllustration />

            {/* Quiet guest status line if guest */}
            {guestStatus && !guestStatus.is_authenticated && (
              <p className="auth-guest-usage-line">
                Guest: {guestStatus.uploads_count || 0} of {guestStatus.upload_limit || 5} uploads used
              </p>
            )}
          </div>
        </div>

        {/* =================================================================
            RIGHT PANEL: Form Area on Normal Surface
            ================================================================= */}
        <div className="auth-panel-right">
          {/* Mobile Header (Shown on < 768px when Left Panel is hidden) */}
          <div className="auth-mobile-header">
            <LogoMark size={30} idPrefix="auth-mobile" />
            <div>
              <h2 className="auth-mobile-title">ConceptLens</h2>
              <p className="auth-mobile-subtitle">Your notes, organized and saved.</p>
            </div>
          </div>

          {googleNeedsRole ? (
            /* First-time Google OAuth Role Selection Step */
            <form onSubmit={handleCompleteGoogleRole} className="auth-fields-form" noValidate>
              <div className="auth-heading-block">
                <h1 id="auth-dialog-title" className="auth-form-title">
                  Choose your role
                </h1>
                <p id="auth-dialog-desc" className="auth-form-subtitle">
                  Welcome to ConceptLens! Choose your role to customize your workspace dashboard.
                </p>
              </div>

              {serverError && (
                <div className="auth-error-banner" role="alert" aria-live="polite">
                  <AlertCircle size={16} strokeWidth={2} className="error-icon" />
                  <span>{serverError}</span>
                </div>
              )}

              <div className="google-role-picker-container">
                <div
                  className={`google-role-card ${chosenGoogleRole === 'student' ? 'selected' : ''}`}
                  onClick={() => setChosenGoogleRole('student')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="google-role-icon">🎓</span>
                  <div>
                    <div className="google-role-title">Student</div>
                    <div className="google-role-desc">
                      Personal study planner, chapter progress tracking, and concept tree notes.
                    </div>
                  </div>
                </div>

                <div
                  className={`google-role-card ${chosenGoogleRole === 'teacher' ? 'selected' : ''}`}
                  onClick={() => setChosenGoogleRole('teacher')}
                  role="button"
                  tabIndex={0}
                >
                  <span className="google-role-icon">👨‍🏫</span>
                  <div>
                    <div className="google-role-title">Teacher / Professor</div>
                    <div className="google-role-desc">
                      Class syllabus mapping, structured concept guides, and student learning insights.
                    </div>
                  </div>
                </div>
              </div>

              <div className="auth-submit-wrap">
                <button
                  type="submit"
                  disabled={loading || isSuccess}
                  className={`auth-submit-btn ${isSuccess ? 'auth-submit-success' : ''}`}
                >
                  {isSuccess ? (
                    <span className="auth-btn-content success-content">
                      <Check size={18} strokeWidth={2.4} />
                      <span>Role selected!</span>
                      <Sparkles size={16} className="sparkle-success" />
                    </span>
                  ) : loading ? (
                    <span className="auth-btn-content">
                      <BookshelfLoader size="sm" label="Setting up..." />
                      <span>Setting up dashboard...</span>
                    </span>
                  ) : (
                    <span className="auth-btn-content">
                      <span>Continue to Dashboard</span>
                    </span>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Segmented Sliding-Pill Tabs */}
              <div className="auth-tabs-wrap">
                <SegmentedTabs
                  tabs={tabsData}
                  activeTab={tab}
                  onChange={handleTabChange}
                  layoutId="authModalTabPill"
                  className="auth-segmented-pill"
                />
              </div>

              {/* Headings that change with tab */}
              <div className="auth-heading-block">
                <h1 id="auth-dialog-title" className="auth-form-title">
                  {tab === 'signin' ? 'Welcome back' : 'Create your workspace'}
                </h1>
                <p id="auth-dialog-desc" className="auth-form-subtitle">
                  {tab === 'signin' ? 'Sign in to open your workspace' : 'It takes less than a minute'}
                </p>
              </div>

              {/* Prompt banner (if opened by limit, session expiration, etc.) */}
              {authModalPrompt && (
                <div className="auth-prompt-banner" role="status">
                  <Info size={16} strokeWidth={2} className="prompt-icon" />
                  <span>{authModalPrompt}</span>
                </div>
              )}

              {/* Top-Level Server Error Banner */}
              {serverError && (
                <div className="auth-error-banner" role="alert" aria-live="polite">
                  <AlertCircle size={16} strokeWidth={2} className="error-icon" />
                  <span>{serverError}</span>
                </div>
              )}



              {/* Real Form with onSubmit */}
              <form onSubmit={handleSubmit} className="auth-fields-form" noValidate>
                {/* Create Account: Role Selector */}
                {tab === 'signup' && (
                  <div className="auth-role-group">
                    <label className="auth-label">I am a</label>
                    <div className="role-selector-pills">
                      <button
                        type="button"
                        className={`role-pill-btn ${role === 'student' ? 'selected' : ''}`}
                        onClick={() => setRoleState('student')}
                      >
                        <span>🎓</span>
                        <span>Student</span>
                      </button>
                      <button
                        type="button"
                        className={`role-pill-btn ${role === 'teacher' ? 'selected' : ''}`}
                        onClick={() => setRoleState('teacher')}
                      >
                        <span>👨‍🏫</span>
                        <span>Teacher / Professor</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Create Account: Optional Display Name */}
                {tab === 'signup' && (
                  <div className="auth-field-group">
                    <label htmlFor="auth-display-name" className="auth-label">
                      Display name <span className="auth-optional-tag">(optional)</span>
                    </label>
                    <input
                      id="auth-display-name"
                      type="text"
                      autoComplete="name"
                      placeholder="e.g. Ada Lovelace"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="auth-input-control"
                      disabled={loading || isSuccess}
                    />
                  </div>
                )}

                {/* Username or Email Field */}
                <div className="auth-field-group">
                  <label htmlFor="auth-username-field" className="auth-label">
                    {tab === 'signin' ? 'Email or Username' : 'Username or Email'}
                  </label>
                  <input
                    ref={firstInputRef}
                    id="auth-username-field"
                    type="text"
                    autoComplete={tab === 'signin' ? 'username email' : 'username'}
                    autoFocus
                    placeholder={tab === 'signin' ? 'name@example.com or username' : 'Choose a username or enter email'}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (fieldErrors.username) {
                        setFieldErrors((prev) => ({ ...prev, username: null }));
                      }
                    }}
                    onBlur={handleUsernameBlur}
                    className={`auth-input-control ${fieldErrors.username ? 'has-field-error' : ''}`}
                    aria-invalid={!!fieldErrors.username}
                    aria-describedby={
                      fieldErrors.username 
                        ? 'username-err' 
                        : tab === 'signup' 
                        ? 'username-rules' 
                        : undefined
                    }
                    disabled={loading || isSuccess}
                  />

                  {fieldErrors.username && (
                    <span id="username-err" className="auth-field-error-msg" role="alert">
                      {fieldErrors.username}
                    </span>
                  )}

                  {/* Helper rules and availability status for signup */}
                  {tab === 'signup' && (
                    <div id="username-rules" className="username-feedback-row">
                      <span className="username-helper-rules">
                        3–24 characters: letters, numbers, underscore, dot or valid email
                      </span>
                      {usernameStatus && (
                        <span 
                          className={`username-status-badge ${
                            usernameStatus.checking
                              ? 'checking'
                              : usernameStatus.available
                              ? 'available'
                              : 'taken'
                          }`}
                          aria-live="polite"
                        >
                          {usernameStatus.checking ? (
                            'Checking...'
                          ) : usernameStatus.available ? (
                            '✓ Available'
                          ) : (
                            `✕ ${usernameStatus.message}`
                          )}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Password Field with Show/Hide toggle */}
                <div className="auth-field-group">
                  <label htmlFor="auth-password-field" className="auth-label">
                    Password
                  </label>
                  <div className="auth-input-wrap">
                    <input
                      id="auth-password-field"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) {
                          setFieldErrors((prev) => ({ ...prev, password: null }));
                        }
                      }}
                      className={`auth-input-control ${fieldErrors.password ? 'has-field-error' : ''}`}
                      aria-invalid={!!fieldErrors.password}
                      aria-describedby={fieldErrors.password ? 'password-err' : undefined}
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
                    <span id="password-err" className="auth-field-error-msg" role="alert">
                      {fieldErrors.password}
                    </span>
                  )}

                  {/* Live Password Strength Meter for signup */}
                  {tab === 'signup' && password && (
                    <div className="password-strength-wrap" aria-live="polite">
                      <div className="strength-bars-row">
                        {[1, 2, 3, 4].map((level) => (
                          <span
                            key={level}
                            className={`strength-bar-seg ${level <= strength.score ? `active-score-${strength.score}` : ''}`}
                          />
                        ))}
                      </div>
                      <div className="strength-meta-row">
                        <span className={`strength-label strength-label-${strength.score}`}>
                          {strength.label}
                        </span>
                        <span className="strength-helper-text">{strength.helper}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Create Account: Confirm Password */}
                {tab === 'signup' && (
                  <div className="auth-field-group">
                    <label htmlFor="auth-confirm-password-field" className="auth-label">
                      Confirm password
                    </label>
                    <div className="auth-input-wrap">
                      <input
                        id="auth-confirm-password-field"
                        type={showConfirmPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (fieldErrors.confirmPassword) {
                            setFieldErrors((prev) => ({ ...prev, confirmPassword: null }));
                          }
                        }}
                        className={`auth-input-control ${fieldErrors.confirmPassword ? 'has-field-error' : ''}`}
                        aria-invalid={!!fieldErrors.confirmPassword}
                        aria-describedby={fieldErrors.confirmPassword ? 'confirm-password-err' : undefined}
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
                      <span id="confirm-password-err" className="auth-field-error-msg" role="alert">
                        {fieldErrors.confirmPassword}
                      </span>
                    )}
                  </div>
                )}

                {/* Full-Width Champagne Gold Submit Button */}
                <div className="auth-submit-wrap">
                  <button
                    type="submit"
                    disabled={loading || isSuccess}
                    className={`auth-submit-btn ${isSuccess ? 'auth-submit-success' : ''}`}
                  >
                    {isSuccess ? (
                      <span className="auth-btn-content success-content">
                        <Check size={18} strokeWidth={2.4} />
                        <span>Welcome!</span>
                        <Sparkles size={16} className="sparkle-success" />
                      </span>
                    ) : loading ? (
                      <span className="auth-btn-content">
                        <BookshelfLoader size="sm" label="Authenticating..." />
                        <span>{tab === 'signin' ? 'Signing in...' : 'Creating workspace...'}</span>
                      </span>
                    ) : (
                      <span className="auth-btn-content">
                        <span>{tab === 'signin' ? 'Sign in' : 'Create account'}</span>
                      </span>
                    )}
                  </button>
                </div>

                {/* Quiet Switch Line Below Button */}
                <div className="auth-switch-line">
                  {tab === 'signin' ? (
                    <span>
                      New here?{' '}
                      <button
                        type="button"
                        className="auth-switch-link"
                        onClick={() => handleTabChange('signup')}
                      >
                        Create an account
                      </button>
                    </span>
                  ) : (
                    <span>
                      Already have an account?{' '}
                      <button
                        type="button"
                        className="auth-switch-link"
                        onClick={() => handleTabChange('signin')}
                      >
                        Sign in
                      </button>
                    </span>
                  )}
                </div>

                {/* Continue with Google Section (Shown on BOTH tabs) */}
                {activeGoogleClientId ? (
                  <div className="auth-google-section">
                    <div className="auth-or-divider" aria-hidden="true">
                      <span className="divider-line" />
                      <span className="divider-text">or</span>
                      <span className="divider-line" />
                    </div>
                    <div ref={googleBtnRef} className="google-btn-wrapper">
                      <GoogleOAuthProvider clientId={activeGoogleClientId}>
                        <GoogleLogin
                          onSuccess={handleGoogleSuccess}
                          onError={handleGoogleError}
                          theme={isDark ? 'filled_black' : 'outline'}
                          size="large"
                          text="continue_with"
                          shape="rectangular"
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
