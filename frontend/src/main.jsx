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

// Log build version in console
console.info(
  `%c[ConceptLens] Version: ${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'} (Built: ${typeof __BUILT_AT__ !== 'undefined' ? __BUILT_AT__ : 'local'})`,
  'color: #6FC21A; font-weight: bold; font-size: 11px;'
);

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() || '';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ConceptLens React Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          backgroundColor: 'var(--bg-base, #F8FDF0)',
          fontFamily: "'Inter', sans-serif"
        }}>
          <div style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: 'var(--glass-bg, rgba(255, 255, 255, 0.72))',
            backdropFilter: 'var(--glass-blur, blur(16px))',
            WebkitBackdropFilter: 'var(--glass-blur, blur(16px))',
            borderRadius: '20px',
            padding: '36px',
            boxShadow: 'var(--glass-shadow, 0 16px 40px rgba(16, 20, 12, 0.08))',
            border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.85))',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '14px' }}>🔍</div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", color: 'var(--ink, #10140C)', fontSize: '1.5rem', fontWeight: 600, margin: '0 0 10px 0' }}>
              ConceptLens Notice
            </h2>
            <div style={{
              backgroundColor: 'var(--surface-2, #F4FDE5)',
              border: '1px solid var(--border, rgba(16, 20, 12, 0.08))',
              borderRadius: '12px',
              padding: '14px',
              color: 'var(--text-secondary, #4E5945)',
              fontSize: '0.85rem',
              marginBottom: '22px',
              textAlign: 'left',
              wordBreak: 'break-word',
              lineHeight: 1.55
            }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'linear-gradient(135deg, var(--brand-light, #C4F560) 0%, var(--brand, #9AE62E) 100%)',
                color: 'var(--ink, #10140C)',
                border: '1px solid var(--brand-deep, #6FC21A)',
                borderRadius: '12px',
                padding: '11px 24px',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(154, 230, 46, 0.28)'
              }}
            >
              Reload Workspace
            </button>
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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootComponent />
  </StrictMode>,
);
