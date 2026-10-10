import React, { Component, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/index.css';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { GoogleOAuthProvider } from '@react-oauth/google';

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
          backgroundColor: '#F7F8F5',
          fontFamily: "'Inter', sans-serif"
        }}>
          <div style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: '#FFFFFF',
            borderRadius: '20px',
            padding: '36px',
            boxShadow: '0 12px 36px rgba(37, 45, 42, 0.08)',
            border: '1px solid #E2E8E3',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '14px' }}>🔍</div>
            <h2 style={{ fontFamily: "'Inter', sans-serif", color: '#252D2A', fontSize: '1.5rem', fontWeight: 600, margin: '0 0 10px 0' }}>
              ConceptLens Notice
            </h2>
            <div style={{
              backgroundColor: '#E8F3ED',
              border: '1px solid #E2E8E3',
              borderRadius: '12px',
              padding: '14px',
              color: '#68736D',
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
                background: '#E89545',
                color: '#252D2A',
                border: '1px solid rgba(189, 105, 32, 0.4)',
                borderRadius: '12px',
                padding: '11px 24px',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37, 45, 42, 0.12)'
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
