// Lightweight click-popover dropdown. Matches the design's model-picker
// style (rounded pill + caret) so it can stand in for native <select>
// inside the composer toolbar.
//
// Closes on outside click + escape. No portal — sits in normal DOM,
// positioned absolute below the trigger. Good enough for composer
// dropdowns that don't need to escape clipping.

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  meta?: string; // small right-aligned annotation
}

interface DropdownProps<T extends string> {
  /** Current selection. */
  value: T;
  options: DropdownOption<T>[];
  onChange: (next: T) => void;
  /** Optional left-side icon — gets a mint dot if you set `dot`. */
  dot?: boolean;
  /** Override how the trigger is rendered. Default: label + meta. */
  renderTrigger?: (opt: DropdownOption<T>) => ReactNode;
  /** Disabled state — clicks no-op, color dims. */
  disabled?: boolean;
  /** Width of the popover panel in px. Default 240. */
  panelWidth?: number;
  /** Tooltip on the trigger button. */
  title?: string;
  /** Extra className for the trigger pill (e.g. 'mode-badge default'). */
  triggerClass?: string;
}

export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  dot,
  renderTrigger,
  disabled,
  panelWidth = 260,
  title,
  triggerClass,
}: DropdownProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent): void {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function escape(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', handle);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', handle);
      window.removeEventListener('keydown', escape);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value) ?? options[0]!;

  return (
    <div ref={rootRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={triggerClass ?? 'model-picker'}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={title}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {dot && <span className="dot" />}
        {renderTrigger ? (
          renderTrigger(selected)
        ) : (
          <>
            <span>{selected.label}</span>
            {selected.meta && <span className="meta">{selected.meta}</span>}
          </>
        )}
        <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 2 }}>⌄</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 6px)',
            right: 0,
            width: panelWidth,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
            padding: 4,
            zIndex: 20,
          }}
          role="listbox"
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                type="button"
                key={opt.value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                role="option"
                aria-selected={active}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: active ? 'var(--brand-tint)' : 'transparent',
                  color: active ? '#B4C2FF' : 'var(--text-0)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 13,
                  border: 0,
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-3)';
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = 'transparent';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{opt.label}</span>
                  {opt.meta && (
                    <span
                      style={{
                        marginLeft: 'auto',
                        color: 'var(--text-3)',
                        fontSize: 11,
                      }}
                    >
                      {opt.meta}
                    </span>
                  )}
                </div>
                {opt.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--text-2)',
                      lineHeight: 1.4,
                    }}
                  >
                    {opt.description}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
