// Catches uncaught React render errors anywhere in the app and shows a
// fallback panel instead of a blank screen. Without this, a stray
// `undefined.length` in any screen would leave the user staring at a
// solid dark background with no recourse.

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // Surface to devtools so we can grep build logs if a user shares one.
    console.error('[DeepCode] React error boundary caught:', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg-0)',
          color: 'var(--text-0)',
        }}
      >
        <div
          style={{
            maxWidth: 600,
            background: 'var(--bg-1)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-lg)',
            padding: 28,
            boxShadow: 'var(--shadow)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--error)', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>
            DeepCode crashed
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: '0 0 14px',
            }}
          >
            Something went wrong rendering this screen.
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16, lineHeight: 1.6 }}>
            This is a bug in DeepCode. The conversation, your settings, and
            your project folder are intact — reload to recover. If it keeps
            happening, please share the error below at github.com/oratis/deepcode/issues.
          </p>
          <pre
            style={{
              background: 'var(--bg-0)',
              border: '1px solid var(--line-soft)',
              color: 'var(--error)',
              padding: 12,
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 220,
              overflowY: 'auto',
              margin: '0 0 16px',
            }}
          >
            {error.message}
            {'\n'}
            {error.stack ?? '(no stack)'}
          </pre>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload DeepCode
          </button>
        </div>
      </div>
    );
  }
}
