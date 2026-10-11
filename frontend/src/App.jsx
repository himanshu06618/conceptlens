import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Routes, Route, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { 
  LogIn,
  PanelLeftOpen,
  PanelLeftClose,
  LayoutDashboard,
  BookOpen
} from 'lucide-react';
import StudentDashboard from './pages/StudentDashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import NotesView from './pages/NotesView';
import Sidebar from './components/Sidebar';
import UploadView from './components/UploadView';
import ResultsView from './components/ResultsView';
import LandingPage from './components/LandingPage';
import ToastContainer from './components/Toast';
import AuthModal from './components/AuthModal';
import UserMenu from './components/UserMenu';
import { useAuth } from './context/AuthContext';
import { 
  uploadDocument, 
  listDocuments, 
  getDocument, 
  getDocumentStatus,
  getDocumentConcepts, 
  deleteDocument,
  getGuestStatus
} from './api/client';
import LoaderShowcase from './components/dev/LoaderShowcase';

import { 
  AmbientBackground,
  BookshelfLoader,
  Logo, 
  ThemeToggle, 
  Button 
} from './components/ui';

import './styles/tokens.css';
import './styles/index.css';

export default function App() {
  const { 
    user, 
    loading: authLoading, 
    isAuthenticated, 
    openAuthModal 
  } = useAuth();

  const navigate = useNavigate();
  const location = useLocation();
  const appRootRef = useRef(null);
  const brandUnitRef = useRef(null);
  const scrollPositionRef = useRef(0);
  const authRedirectTargetRef = useRef(null);

  const syncScrollProgress = useCallback((scrollTop = 0) => {
    const root = appRootRef.current;
    if (!root) return;

    const progress = Math.min(1, Math.max(0, scrollTop / 220));
    const isMobile = window.matchMedia('(max-width: 640px)').matches;
    const targetLeft = isMobile ? 12 : 24;
    const logoProgress = isMobile ? 0 : progress;
    const logoShift = -(window.innerWidth / 2 - targetLeft) * logoProgress;
    scrollPositionRef.current = scrollTop;
    root.style.setProperty('--scroll-progress', String(progress));
    root.style.setProperty('--logo-shift', `${logoShift}px`);
    root.style.setProperty('--logo-center-shift', `${-50 * (1 - logoProgress)}%`);
    root.style.setProperty('--logo-leading-slot', `${isMobile ? 40 : 60 * (1 - logoProgress)}px`);
    root.style.setProperty('--logo-inline-slot', `${43 * logoProgress}px`);
    root.style.setProperty('--logo-mark-size', `${isMobile ? 38 : 56 - 14 * logoProgress}px`);
    const mobileWordmarkSize = window.innerWidth <= 360 ? 17 : window.innerWidth <= 400 ? 18 : 20;
    root.style.setProperty('--logo-wordmark-size', `${isMobile ? mobileWordmarkSize : 31.5 - 4.5 * logoProgress}px`);
    root.style.setProperty('--logo-title-weight', '400');
    root.style.setProperty('--logo-title-tracking', `${-0.025 - progress * 0.006}em`);
    root.style.setProperty('--logo-lens-glow', String(0.12 + progress * 0.12));
    root.style.setProperty('--logo-lens-reflection', String(0.72 + progress * 0.2));
    root.style.setProperty('--logo-ring-width', `${2.7 - progress * 0.35}`);
    root.style.setProperty('--logo-chip-padding-x', `${isMobile ? 0 : 16 - 6 * logoProgress}px`);
    root.style.setProperty('--logo-chip-padding-y', `${isMobile ? 0 : 7 - logoProgress}px`);
    root.style.setProperty('--logo-mark-rotation', `${isMobile ? progress * 7 : logoProgress * 18}deg`);
    const conceptWidth = brandUnitRef.current
      ?.querySelector('.brand-word-concept')
      ?.getBoundingClientRect().width || 0;
    const markX = isMobile ? 0 : (conceptWidth + 3.5) * logoProgress;
    const markSize = isMobile ? 38 : 56 - 14 * logoProgress;
    const leadingSlot = isMobile ? 40 : 60 * (1 - logoProgress);
    const lensCenter = markX + markSize * (20 / 48);
    root.style.setProperty('--logo-mark-x', `${markX}px`);
    root.style.setProperty('--logo-magnifier-x', `${lensCenter - leadingSlot}px`);
    root.style.setProperty('--logo-magnifier-radius', `${markSize * (14 / 48)}px`);
  }, []);

  // Guest Quota State (free 5 uploads before login is required)
  const [guestStatus, setGuestStatus] = useState({
    is_authenticated: false,
    uploads_count: 0,
    upload_limit: 5,
    remaining: 5,
  });

  // Theme state: light or dark
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('conceptlens_theme');
    if (saved) return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('conceptlens_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Documents and Navigation State
  const [documents, setDocuments] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [activeDocData, setActiveDocData] = useState(null);
  const [activeConcepts, setActiveConcepts] = useState([]);
  const [activeTopics, setActiveTopics] = useState([]);
  const [isConceptsLoading, setIsConceptsLoading] = useState(false);
  const [lastUploadedFile, setLastUploadedFile] = useState(null);

  // Sidebar Navigation State (Mobile drawer + Desktop collapse)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('conceptlens_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleSidebarCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('conceptlens_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  const handleHeaderSidebarToggle = useCallback(() => {
    if (window.matchMedia('(max-width: 768px)').matches) {
      setIsSidebarOpen((prev) => !prev);
      return;
    }
    handleToggleSidebarCollapse();
  }, [handleToggleSidebarCollapse]);

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        e.preventDefault();
        handleToggleSidebarCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebarCollapse]);

  // Upload & Background Processing State
  const [isUploading, setIsUploading] = useState(false);
  const [processingDoc, setProcessingDoc] = useState(null);
  const [processingStage, setProcessingStage] = useState('reading');
  const [processingProgress, setProcessingProgress] = useState(5);
  const [processingMessage, setProcessingMessage] = useState('Initializing note analysis...');
  const [ocrPageInfo, setOcrPageInfo] = useState({ current: 0, total: 0 });
  const [processingError, setProcessingError] = useState(null);
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const pollingRef = useRef(null);
  const progressTimerRef = useRef(null);

  // Toast Notifications
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((messageOrObj, fallbackType = 'info') => {
    let message = messageOrObj;
    let type = fallbackType;
    if (typeof messageOrObj === 'object' && messageOrObj !== null) {
      message = messageOrObj.message || '';
      type = messageOrObj.type || fallbackType;
    }
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Support opening auth popup from URL hash (#signin or #signup) without creating a route
  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === '#signin') {
        openAuthModal('signin');
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } else if (hash === '#signup') {
        openAuthModal('signup');
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [openAuthModal]);

  // Listen for unauthorized session expiration
  useEffect(() => {
    const handleUnauthorizedEvent = () => {
      addToast('Your session expired, please sign in again.', 'info');
    };
    window.addEventListener('conceptlens:unauthorized', handleUnauthorizedEvent);
    return () => window.removeEventListener('conceptlens:unauthorized', handleUnauthorizedEvent);
  }, [addToast]);

  // Fetch guest quota status
  const refreshGuestStatus = useCallback(async () => {
    try {
      const status = await getGuestStatus();
      setGuestStatus(status);
      return status;
    } catch {
      return null;
    }
  }, []);

  // Load document list from backend
  const refreshDocumentsList = useCallback(async () => {
    try {
      const docs = await listDocuments();
      setDocuments(docs);
      return docs;
    } catch (err) {
      console.error('Failed to load documents:', err);
      return [];
    }
  }, []);

  // Load active document details and concepts
  const loadDocConcepts = useCallback(async (docId) => {
    setIsConceptsLoading(true);
    try {
      const [docDetail, conceptsResp] = await Promise.all([
        getDocument(docId),
        getDocumentConcepts(docId)
      ]);
      setActiveDocData(docDetail);
      setActiveConcepts(conceptsResp.concepts || []);
      setActiveTopics(conceptsResp.topics || []);
    } catch (err) {
      addToast(err.message || 'Failed to load concepts', 'error');
    } finally {
      setIsConceptsLoading(false);
    }
  }, [addToast]);

  const handleSelectDoc = (docId) => {
    setActiveDocId(docId);
    loadDocConcepts(docId);
    navigate('/app');
  };

  const handleNewUpload = () => {
    setActiveDocId(null);
    setActiveDocData(null);
    setActiveConcepts([]);
    setActiveTopics([]);
    setProcessingDoc(null);
    setProcessingError(null);
    navigate('/app');
  };

  const isLandingRoute = location.pathname.startsWith('/landing');
  const isPlannerRoute = location.pathname.startsWith('/student/dashboard') || location.pathname.startsWith('/teacher/dashboard');
  const isNotesRoute = location.pathname.startsWith('/notes');
  const isWorkspaceRoute = location.pathname === '/' || location.pathname.startsWith('/app');
  const isAppRoute = !isLandingRoute;

  const handleGoToDashboard = useCallback(() => {
    if (isNotesRoute) {
      // From Notes view, return to student or teacher dashboard
      const role = (user?.role || '').toLowerCase();
      if (role === 'teacher') {
        navigate('/teacher/dashboard');
      } else {
        navigate('/student/dashboard');
      }
      return;
    }

    if (isPlannerRoute) {
      // From dashboard, clicking Notes button opens personal Notes view!
      if (!isAuthenticated) {
        authRedirectTargetRef.current = '/notes';
        openAuthModal('signin', 'Sign in to access your personal study notes.');
        return;
      }
      navigate('/notes');
      return;
    }

    if (!isAuthenticated) {
      openAuthModal('signin', 'Sign in to access your student study planner dashboard.');
      return;
    }

    if (user?.role === 'teacher') {
      navigate('/teacher/dashboard');
    } else {
      navigate('/student/dashboard');
    }
  }, [isNotesRoute, isPlannerRoute, isAuthenticated, user, navigate, openAuthModal]);

  const handleDeleteDoc = async (docId) => {
    try {
      await deleteDocument(docId);
      addToast('Document removed', 'info');
      if (activeDocId === docId) {
        handleNewUpload();
      }
      refreshDocumentsList();
    } catch (err) {
      addToast(err.message || 'Failed to delete document', 'error');
    }
  };

  // Poll processing status (1.5s lightweight status endpoint)
  const startPolling = useCallback((docId) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    let pollInFlight = false;

    // Smooth client-side progress tick between polls (caps at 94% until complete)
    progressTimerRef.current = setInterval(() => {
      setProcessingProgress((prev) => {
        if (prev < 92) {
          return prev + 1;
        }
        return prev;
      });
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
        if (doc.ocr_current_page || doc.ocr_total_pages) {
          setOcrPageInfo({
            current: doc.ocr_current_page || 0,
            total: doc.ocr_total_pages || 0,
          });
        }

        if (doc.status === 'completed') {
          clearInterval(pollingRef.current);
          if (progressTimerRef.current) clearInterval(progressTimerRef.current);
          setProcessingProgress(100);
          setProcessingMessage('Extraction completed successfully!');

          setTimeout(async () => {
            setIsUploading(false);
            await refreshDocumentsList();
            await refreshGuestStatus();
            try {
              const [docDetail, conceptsResp] = await Promise.all([
                getDocument(docId),
                getDocumentConcepts(docId),
              ]);
              setActiveDocData(docDetail);
              setActiveConcepts(conceptsResp.concepts || []);
              setActiveTopics(conceptsResp.topics || []);
              setActiveDocId(docId);
              setProcessingDoc(null);
              setProcessingError(null);
              navigate('/app');
              addToast('Concepts successfully extracted!', 'success');
            } catch (err) {
              setProcessingError(`Processing completed, but the results could not be loaded: ${err.message || 'Please try again.'}`);
            }
          }, 400);
        } else if (doc.status === 'failed') {
          clearInterval(pollingRef.current);
          if (progressTimerRef.current) clearInterval(progressTimerRef.current);
          setIsUploading(false);
          setProcessingError(doc.error || 'Failed to extract concepts from document.');
          await refreshDocumentsList();
        }
      } catch (err) {
        console.error('Polling error:', err);
      } finally {
        pollInFlight = false;
      }
    }, 1500);
  }, [addToast, navigate, refreshDocumentsList, refreshGuestStatus]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  const handleUpload = async (file, options = {}) => {
    if (!isAuthenticated && guestStatus && guestStatus.uploads_count >= (guestStatus.upload_limit || 5)) {
      setPendingUploadFile(file);
      openAuthModal(
        'signup',
        `You've reached your free guest limit (${guestStatus.upload_limit || 5} uploads). Create an account to save your notes.`
      );
      return;
    }

    setLastUploadedFile(file);
    setIsUploading(true);
    setProcessingError(null);
    setProcessingStage('reading');
    setProcessingProgress(8);
    setProcessingMessage(`Uploading ${file.name}...`);
    setOcrPageInfo({ current: 0, total: 0 });
    setProcessingDoc({ filename: file.name });
    navigate('/app');

    try {
      const resp = await uploadDocument(file, options);
      setProcessingDoc({ id: resp.id, filename: resp.filename });
      startPolling(resp.id);
    } catch (err) {
      setIsUploading(false);
      const is403 = err.status === 403 || (err.message && err.message.includes('Guest upload limit'));
      if (is403 && !isAuthenticated) {
        setProcessingDoc(null);
        setProcessingError(null);
        setPendingUploadFile(file);
        openAuthModal(
          'signup',
          `You've reached your free guest limit (${guestStatus?.upload_limit || 5} uploads). Please sign in or create an account.`
        );
      } else {
        setProcessingError(err.message || 'Upload failed. Please try again.');
      }
    }
  };

  const handleRetryUpload = (options = {}) => {
    if (lastUploadedFile) {
      handleUpload(lastUploadedFile, options);
    }
  };

  useEffect(() => {
    refreshGuestStatus();
    refreshDocumentsList();
  }, [user, refreshGuestStatus, refreshDocumentsList]);

  const handleAuthSuccess = async (userData) => {
    await refreshGuestStatus();
    await refreshDocumentsList();
    const name = userData?.name || userData?.display_name || userData?.username || 'scholar';
    addToast(`Welcome back, ${name}!`, 'success');

    // Resume pending upload after sign-in if triggered by guest limit
    if (pendingUploadFile) {
      const fileToResume = pendingUploadFile;
      setPendingUploadFile(null);
      setTimeout(() => {
        handleUpload(fileToResume);
      }, 350);
      return;
    }

    // Redirect to intended route (such as /notes) if triggered by notes action
    if (authRedirectTargetRef.current) {
      const target = authRedirectTargetRef.current;
      authRedirectTargetRef.current = null;
      navigate(target);
      return;
    }

    if (location.pathname.startsWith('/notes')) {
      return;
    }

    // Requirement 7: Send students to Student Dashboard and teachers to Teacher Dashboard
    const userRole = (userData?.role || user?.role || '').toLowerCase();
    if (userRole === 'teacher') {
      navigate('/teacher/dashboard');
    } else {
      navigate('/student/dashboard');
    }
  };

  // Fixed sidebar / lock body scrolling on workspace route
  useEffect(() => {
    if (isWorkspaceRoute) {
      document.body.classList.add('app-route-body');
    } else {
      document.body.classList.remove('app-route-body');
    }
    return () => {
      document.body.classList.remove('app-route-body');
    };
  }, [isWorkspaceRoute]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.classList.add('drawer-open-lock');
    } else {
      document.body.classList.remove('drawer-open-lock');
    }
    return () => {
      document.body.classList.remove('drawer-open-lock');
    };
  }, [isSidebarOpen]);

  const workspaceDashboard = (
    <div className="app-body">
      {/* Sidebar (288px) */}
      <Sidebar
        documents={documents}
        activeDocId={activeDocId}
        onSelectDoc={handleSelectDoc}
        onNewUpload={handleNewUpload}
        onDeleteDoc={handleDeleteDoc}
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        isCollapsed={isSidebarCollapsed}
        guestStatus={guestStatus}
        user={user}
        onOpenAuth={openAuthModal}
      />

      {/* Main Content Area */}
      <main
        className={`main-viewport ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}
        onScroll={(event) => syncScrollProgress(event.currentTarget.scrollTop)}
      >
        {authLoading ? (
          <div className="loading-state-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh', gap: 12 }}>
            <BookshelfLoader size="lg" label="Loading workspace..." />
          </div>
        ) : activeDocId && activeDocData ? (
          <ResultsView
            documentData={activeDocData}
            concepts={activeConcepts}
            topics={activeTopics}
            isLoading={isConceptsLoading}
            onRefresh={() => loadDocConcepts(activeDocId)}
            onNewUpload={handleNewUpload}
            onDeleteDoc={handleDeleteDoc}
          />
        ) : (
          <UploadView
            onUpload={handleUpload}
            isUploading={isUploading}
            processingDoc={processingDoc}
            processingStage={processingStage}
            processingProgress={processingProgress}
            processingMessage={processingMessage}
            ocrPageInfo={ocrPageInfo}
            processingError={processingError}
            onCancelProcessing={() => {
              if (pollingRef.current) clearInterval(pollingRef.current);
              if (progressTimerRef.current) clearInterval(progressTimerRef.current);
              setProcessingDoc(null);
              setProcessingError(null);
              setProcessingProgress(0);
            }}
            onRetryUpload={handleRetryUpload}
            guestStatus={guestStatus}
            user={user}
            onOpenAuth={(tab) => openAuthModal(
              tab || 'signup',
              `You've reached your free guest limit (${guestStatus?.upload_limit || 5} uploads). Sign in or create an account to save notes and unlock unlimited uploads.`
            )}
            documents={documents}
            onSelectDoc={handleSelectDoc}
          />
        )}
      </main>
    </div>
  );

  return (
    <div className="app-root" ref={appRootRef}>
      {/* Background Atmosphere */}
      <AmbientBackground variant={isAppRoute ? 'app' : 'landing'} />

      {/* 3-Column Glass Header (1fr auto 1fr, perfectly centered Logo & title) */}
      <header className="app-header">
        <div className="header-col-left" />

        <div className="header-col-center">
          <div 
            className="brand-clickable-unit"
            ref={brandUnitRef}
            onClick={() => {
              handleNewUpload();
              navigate('/');
            }}
            role="button"
            tabIndex={0}
            aria-label="ConceptLens Home"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleNewUpload();
                navigate('/');
              }
            }}
          >
            <Logo size={42} wordmarkSize="1.78rem" scrollMorph />
          </div>
        </div>

        <div className="header-col-right">
          <button
            type="button"
            id="header-dashboard-btn"
            className={`header-dashboard-btn ${activeDocId ? 'in-project' : ''} ${isPlannerRoute || isNotesRoute ? 'is-active' : ''}`}
            onClick={handleGoToDashboard}
            aria-label={isPlannerRoute ? 'Notes' : 'Dashboard'}
            title={
              isPlannerRoute
                ? 'Personal Study Notes'
                : isNotesRoute
                ? 'Back to Study Planner Dashboard'
                : activeDocId
                ? 'Go to Study Planner Dashboard'
                : 'Study Planner Dashboard'
            }
            aria-current={isPlannerRoute || isNotesRoute ? 'page' : undefined}
          >
            {isPlannerRoute ? (
              <>
                <BookOpen size={18} strokeWidth={1.8} className="header-dashboard-icon" />
                <span className="header-dashboard-label">Notes</span>
              </>
            ) : (
              <>
                <LayoutDashboard size={18} strokeWidth={1.8} className="header-dashboard-icon" />
                <span className="header-dashboard-label">Dashboard</span>
              </>
            )}
          </button>

          <ThemeToggle 
            theme={theme}
            onToggle={toggleTheme}
          />

          {isAuthenticated ? (
            <UserMenu onToast={addToast} />
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={LogIn}
              onClick={() => openAuthModal('signin')}
              className="header-signin-btn"
              aria-haspopup="dialog"
            >
              Sign in
            </Button>
          )}

          {isWorkspaceRoute && (
            <button
              type="button"
              className="header-sidebar-toggle"
              onClick={handleHeaderSidebarToggle}
              aria-label={`${
                window.matchMedia('(max-width: 768px)').matches
                  ? (isSidebarOpen ? 'Close' : 'Open')
                  : (isSidebarCollapsed ? 'Expand' : 'Collapse')
              } notes sidebar`}
              aria-expanded={
                window.matchMedia('(max-width: 768px)').matches
                  ? isSidebarOpen
                  : !isSidebarCollapsed
              }
              title={`${
                window.matchMedia('(max-width: 768px)').matches
                  ? (isSidebarOpen ? 'Close' : 'Open')
                  : (isSidebarCollapsed ? 'Expand' : 'Collapse')
              } notes sidebar`}
            >
              {window.matchMedia('(max-width: 768px)').matches
                ? (isSidebarOpen ? (
                  <PanelLeftClose size={19} strokeWidth={1.8} />
                ) : (
                  <PanelLeftOpen size={19} strokeWidth={1.8} />
                ))
                : isSidebarCollapsed ? (
                <PanelLeftOpen size={19} strokeWidth={1.8} />
              ) : (
                <PanelLeftClose size={19} strokeWidth={1.8} />
              )}
            </button>
          )}
        </div>
      </header>

      {/* Routes: Workspace Dashboard as Default */}
      <Routes>
        <Route 
          path="/" 
          element={workspaceDashboard} 
        />

        <Route 
          path="/app" 
          element={workspaceDashboard} 
        />

        <Route 
          path="/student/dashboard" 
          element={<StudentDashboard onToast={addToast} />} 
        />

        <Route 
          path="/teacher/dashboard" 
          element={<TeacherDashboard />} 
        />

        <Route 
          path="/notes" 
          element={<NotesView onToast={addToast} />} 
        />

        <Route 
          path="/dashboard" 
          element={
            isAuthenticated ? (
              user?.role === 'teacher' ? <Navigate to="/teacher/dashboard" replace /> : <Navigate to="/student/dashboard" replace />
            ) : (
              <Navigate to="/app" replace />
            )
          } 
        />

        <Route 
          path="/landing" 
          element={<LandingPage onOpenAuth={openAuthModal} />} 
        />

        <Route path="/_dev/loader" element={<LoaderShowcase />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Global In-Dashboard Auth Modal */}
      <AuthModal onSuccess={handleAuthSuccess} guestStatus={guestStatus} />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
