import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/index.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { wakeBackendServer } from './api/client';

// Fire early non-blocking backend warm-up request immediately on shell parse
wakeBackendServer();

const currentBuildId = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const currentBuiltAt = typeof __BUILT_AT__ !== 'undefined' ? __BUILT_AT__ : 'local';

// Log build version in console
console.info(
  `%c[ConceptLens] Version: ${currentBuildId} (Built: ${currentBuiltAt})`,
  'color: #6FC21A; font-weight: bold; font-size: 11px;'
);

// Global window unhandled error and rejection listeners
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const errorDetails = {
      type: 'uncaught_error',
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      buildId: currentBuildId,
      timestamp: new Date().toISOString(),
    };
    console.error('[ConceptLens Window Error]', errorDetails, event.error);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const errorDetails = {
      type: 'unhandled_rejection',
      reason: event.reason?.message || String(event.reason),
      buildId: currentBuildId,
      timestamp: new Date().toISOString(),
    };
    console.error('[ConceptLens Unhandled Rejection]', errorDetails, event.reason);
  });
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || '';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    const diagnostics = {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown error',
      componentStack: errorInfo?.componentStack ? errorInfo.componentStack.trim() : null,
      buildId: currentBuildId,
      timestamp: new Date().toISOString(),
    };
    console.error('[ConceptLens React Error Boundary]', diagnostics, error);
  }

  handleCopyDetails = async () => {
    const { error, errorInfo } = this.state;
    const diagnostics = {
      error: error?.message || 'Unknown error',
      name: error?.name || 'Error',
      componentStack: errorInfo?.componentStack ? errorInfo.componentStack.trim() : null,
      buildId: currentBuildId,
      timestamp: new Date().toISOString(),
    };

    const textToCopy = JSON.stringify(diagnostics, null, 2);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = textToCopy;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2500);
    } catch (e) {
      console.warn('Failed to copy error details to clipboard', e);
    }
  };

  render() {
    if (this.state.hasError) {
      const isDev = Boolean(import.meta.env.DEV);
      const { error, errorInfo, copied } = this.state;

      return (
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            backgroundColor: 'var(--bg-base, #F8FDF0)',
            fontFamily: "'Inter', sans-serif"
          }}
        >
          <div
            style={{
              maxWidth: '520px',
              width: '100%',
              backgroundColor: 'var(--glass-bg, rgba(255, 255, 255, 0.72))',
              backdropFilter: 'var(--glass-blur, blur(16px))',
              WebkitBackdropFilter: 'var(--glass-blur, blur(16px))',
              borderRadius: '20px',
              padding: '36px',
              boxShadow: 'var(--glass-shadow, 0 16px 40px rgba(16, 20, 12, 0.08))',
              border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.85))',
              textAlign: 'center'
            }}
          >
            <div style={{ fontSize: '36px', marginBottom: '14px' }}>🔍</div>
            <h2
              style={{
                fontFamily: "'Inter', sans-serif",
                color: 'var(--ink, #10140C)',
                fontSize: '1.45rem',
                fontWeight: 600,
                margin: '0 0 6px 0'
              }}
            >
              ConceptLens Notice
            </h2>
            <p
              style={{
                color: 'var(--text-secondary, #4E5945)',
                fontSize: '0.95rem',
                margin: '0 0 18px 0',
                lineHeight: 1.5
              }}
            >
              {isDev ? 'A runtime error was caught during rendering.' : 'Something went wrong while rendering this view.'}
            </p>

            <div
              style={{
                backgroundColor: 'var(--surface-2, #F4FDE5)',
                border: '1px solid var(--border, rgba(16, 20, 12, 0.08))',
                borderRadius: '12px',
                padding: '14px',
                color: 'var(--text-secondary, #4E5945)',
                fontSize: '0.85rem',
                marginBottom: '22px',
                textAlign: 'left',
                wordBreak: 'break-word',
                lineHeight: 1.55,
                maxHeight: isDev ? '240px' : 'auto',
                overflowY: isDev ? 'auto' : 'visible'
              }}
            >
              <div style={{ fontWeight: 600, color: 'var(--ink, #10140C)', marginBottom: isDev ? '6px' : '0' }}>
                {isDev ? (error?.message || 'Unknown error occurred.') : 'Your saved notes and documents are unaffected. Reloading will refresh your workspace safely.'}
              </div>
              {isDev && (error?.stack || errorInfo?.componentStack) && (
                <pre
                  style={{
                    fontSize: '0.75rem',
                    margin: '8px 0 0',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace',
                    color: '#842029',
                    opacity: 0.9
                  }}
                >
                  {error?.stack || errorInfo?.componentStack}
                </pre>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  background: 'linear-gradient(135deg, var(--brand-light, #C4F560) 0%, var(--brand, #9AE62E) 100%)',
                  color: 'var(--ink, #10140C)',
                  border: '1px solid var(--brand-deep, #6FC21A)',
                  borderRadius: '12px',
                  padding: '11px 22px',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(154, 230, 46, 0.28)'
                }}
              >
                Reload Workspace
              </button>

              <button
                type="button"
                onClick={this.handleCopyDetails}
                aria-label="Copy error details"
                style={{
                  background: 'var(--surface-1, #FFFFFF)',
                  color: 'var(--ink, #10140C)',
                  border: '1px solid var(--border, rgba(16, 20, 12, 0.16))',
                  borderRadius: '12px',
                  padding: '11px 18px',
                  fontWeight: 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s ease'
                }}
              >
                {copied ? '✓ Copied error details' : 'Copy error details'}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const RootComponent = () => {
  const content = (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );

  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        {content}
      </GoogleOAuthProvider>
    );
  }

  return content;
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <RootComponent />
    </StrictMode>,
  );
}
