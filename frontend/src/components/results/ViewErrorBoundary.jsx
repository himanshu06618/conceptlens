import React, { Component } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';

export default class ViewErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`Error in view [${this.props.viewName || 'Results View'}]:`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="view-error-boundary-container"
          style={{
            padding: '40px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            minHeight: '340px',
            background: 'var(--surface-base, rgba(255, 255, 255, 0.6))',
            borderRadius: '16px',
            border: '1px dashed var(--border-soft, rgba(16, 20, 12, 0.16))',
            margin: '16px'
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '16px'
            }}
          >
            <AlertCircle size={24} color="#EF4444" />
          </div>

          <h4
            style={{
              margin: '0 0 8px 0',
              color: 'var(--ink, #10140C)',
              fontSize: '1.05rem',
              fontWeight: 600,
              fontFamily: 'var(--planner-font-title, sans-serif)'
            }}
          >
            Can't display {this.props.viewName || 'this view'} right now
          </h4>

          <p
            style={{
              margin: '0 0 20px 0',
              color: 'var(--text-muted, #728065)',
              fontSize: '0.88rem',
              maxWidth: '380px',
              lineHeight: 1.5
            }}
          >
            There was an issue rendering this specific diagram. Your other results views remain fully available.
          </p>

          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '9px 18px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, var(--brand-light, #C4F560) 0%, var(--brand, #9AE62E) 100%)',
              color: 'var(--ink, #10140C)',
              border: '1px solid var(--brand-deep, #6FC21A)',
              fontWeight: 600,
              fontSize: '0.86rem',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(154, 230, 46, 0.25)',
              transition: 'transform 0.15s ease'
            }}
          >
            <RefreshCw size={14} />
            <span>Retry View</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
