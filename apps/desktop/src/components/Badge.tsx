// Status badge — three flavors per the design spec (#3 / #6).
// .badge-ok / .badge-warn / .badge-err / .badge-info live in index.css.

import type { ReactNode } from 'react';

export type BadgeKind = 'ok' | 'warn' | 'err' | 'info';

interface BadgeProps {
  kind: BadgeKind;
  children: ReactNode;
}

export function Badge({ kind, children }: BadgeProps): JSX.Element {
  return <span className={`badge badge-${kind}`}>{children}</span>;
}
