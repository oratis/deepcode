// Generic utility-screen shell.
// Used by Sessions / Plugins / Skills / Permissions / MCP / Settings /
// About — each one is a vertical scroll surface with a header (title +
// optional subtitle + optional action) and a body containing Cards.
//
// Matches the design language: chat-main column, padded body, header
// pinned at top. No 3-column shell — that's the App-level grid.

import type { ReactNode } from 'react';

interface ScreenProps {
  title: string;
  subtitle?: string;
  /** Right-aligned header actions — usually one or two buttons. */
  actions?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, subtitle, actions, children }: ScreenProps): JSX.Element {
  return (
    <>
      <div className="chat-header">
        <span className="crumb">
          <b>{title}</b>
          {subtitle && (
            <>
              {' · '}
              <span className="muted">{subtitle}</span>
            </>
          )}
        </span>
        {actions && <div className="right">{actions}</div>}
      </div>
      <div className="chat-stream" style={{ paddingBlock: '20px', display: 'block' }}>
        {children}
      </div>
    </>
  );
}

interface CardProps {
  /** Optional title shown above the card body. */
  title?: string;
  /** Optional right-aligned controls (button group, badge, ...). */
  actions?: ReactNode;
  /** Body — usually a list, table, or form. */
  children: ReactNode;
  /** Inner padding override. Default 16. */
  padding?: number;
  /** If set, body has no top padding so a table sits flush with the head. */
  flush?: boolean;
}

export function Card({ title, actions, children, padding = 16, flush }: CardProps): JSX.Element {
  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        marginBottom: 14,
      }}
    >
      {(title || actions) && (
        <div
          style={{
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            borderBottom: '1px solid var(--line)',
            background: 'linear-gradient(180deg, var(--brand-tint), transparent)',
          }}
        >
          {title && (
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--text-0)',
                letterSpacing: 0.2,
              }}
            >
              {title}
            </div>
          )}
          {actions && <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>{actions}</div>}
        </div>
      )}
      <div style={{ padding: flush ? 0 : padding }}>{children}</div>
    </div>
  );
}

/** Two-column row commonly seen in About / Settings (label → value). */
interface RowProps {
  label: string;
  children: ReactNode;
  /** Optional secondary helper text under the label. */
  hint?: string;
}

export function Row({ label, hint, children }: RowProps): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr',
        gap: 16,
        padding: '10px 0',
        borderBottom: '1px solid var(--line-soft)',
        alignItems: 'baseline',
      }}
    >
      <div>
        <div style={{ fontSize: 13, color: 'var(--text-1)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{hint}</div>}
      </div>
      <div style={{ color: 'var(--text-0)', fontSize: 13, minWidth: 0 }}>{children}</div>
    </div>
  );
}

/** Section divider for grouping rows inside a card. */
export function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: 'var(--text-3)',
        fontWeight: 600,
        marginTop: 14,
        marginBottom: 6,
        paddingBottom: 4,
        borderBottom: '1px solid var(--line-soft)',
      }}
    >
      {children}
    </div>
  );
}
