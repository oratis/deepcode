// Composer "+" popover — design spec screen #4.
// Click-popover with three actions: Attach file / Slash command / Memory.
// Sits absolute-positioned above the composer toolbar (opens upward so
// it doesn't get clipped by the chat-stream above the composer).

import { useEffect, useRef, useState } from 'react';

export interface PlusMenuItem {
  icon: string; // emoji or single-char icon
  label: string;
  description?: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
}

interface PlusMenuProps {
  items: PlusMenuItem[];
  disabled?: boolean;
}

export function PlusMenu({ items, disabled }: PlusMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handle);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', handle);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title="Attach / commands / memory"
      >
        +
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            left: 0,
            width: 280,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
            padding: 4,
            zIndex: 20,
          }}
        >
          {items.map((item) => (
            <button
              type="button"
              role="menuitem"
              key={item.label}
              onClick={async () => {
                if (item.disabled) return;
                setOpen(false);
                await item.onClick();
              }}
              disabled={item.disabled}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                color: item.disabled ? 'var(--text-3)' : 'var(--text-0)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                font: 'inherit',
                fontSize: 13,
                border: 0,
                cursor: item.disabled ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) e.currentTarget.style.background = 'var(--bg-3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span
                style={{
                  width: 22,
                  textAlign: 'center',
                  fontSize: 14,
                  color: 'var(--text-2)',
                }}
              >
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{item.label}</div>
                {item.description && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>
                    {item.description}
                  </div>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
