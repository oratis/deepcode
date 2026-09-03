// DEV-ONLY preview harness for tool cards. Not part of the prod bundle — vite's
// build input is pinned to index.html, so this page exists only under
// `vite dev` (served at /preview-toolcards.html) for visual iteration.
//
// Renders one card per render intent so the four layouts can be compared side
// by side without running an agent.

import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { presentToolCall } from '@deepcode/core/dist/tools/presentation.js';
import type { ToolLocation } from '@deepcode/core/dist/tools/presentation.js';
import { ToolBody } from './components/ToolBody.js';
import { ToolCard } from './components/ToolCard.js';
import './index.css';

const CALLS: Array<{
  name: string;
  input: Record<string, unknown>;
  result?: string;
  locations?: ToolLocation[];
  status: 'ok' | 'err' | 'running';
}> = [
  {
    name: 'Edit',
    input: {
      file_path: 'packages/core/src/tools/bash.ts',
      old_string:
        'const MAX_OUTPUT_BYTES = 30_000;\n\nfunction capStream(s: string, label: string): string {\n  return s.slice(0, MAX_OUTPUT_BYTES);\n}',
      new_string:
        'const CAPTURE_HEAD_CHARS = 1_000_000;\nconst CAPTURE_TAIL_CHARS = 3_000_000;\n\nfunction newCapture(): BoundedCapture {\n  return new BoundedCapture(CAPTURE_HEAD_CHARS, CAPTURE_TAIL_CHARS);\n}',
    },
    result: 'Edited packages/core/src/tools/bash.ts',
    status: 'ok',
  },
  {
    name: 'Write',
    input: {
      file_path: 'packages/core/src/spill/types.ts',
      content:
        'export interface SpillRef {\n  locator: string;\n  bytes: number;\n  retrievalHint: string;\n}',
    },
    result: 'Wrote 5 lines',
    status: 'ok',
  },
  {
    name: 'Bash',
    input: { command: 'pnpm --filter @deepcode/core test -- src/spill' },
    result:
      '<stdout>\n RUN  v4.1.10\n\n Test Files  2 passed (2)\n      Tests  19 passed (19)\n</stdout>\nexit: 0',
    status: 'ok',
  },
  {
    name: 'Bash',
    input: { command: 'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml' },
    result: '<stderr>\nerror: could not compile `deepcode-desktop`\n</stderr>\nexit: 101',
    status: 'err',
  },
  {
    name: 'Grep',
    input: { pattern: 'applySpillPolicy', path: 'packages/core/src', '-n': true },
    result:
      'packages/core/src/agent.ts:16:import { applySpillPolicy } from...\npackages/core/src/spill/policy.ts:71:export function applySpillPolicy(\npackages/core/src/index.ts:213:  applySpillPolicy,',
    locations: [
      {
        path: '/repo/packages/core/src/agent.ts',
        display: 'packages/core/src/agent.ts',
        line: 16,
        preview: "import { applySpillPolicy } from './spill/policy.js';",
      },
      {
        path: '/repo/packages/core/src/spill/policy.ts',
        display: 'packages/core/src/spill/policy.ts',
        line: 71,
        preview: 'export function applySpillPolicy(',
      },
      {
        path: '/repo/packages/core/src/index.ts',
        display: 'packages/core/src/index.ts',
        line: 213,
        preview: '  applySpillPolicy,',
      },
    ],
    status: 'ok',
  },
  {
    name: 'Glob',
    input: { pattern: 'src/sandbox/*.ts', path: 'packages/core' },
    result: 'src/sandbox/dns-proxy.ts\nsrc/sandbox/netns.ts\nsrc/sandbox/profiles.ts',
    locations: [
      { path: '/repo/packages/core/src/sandbox/dns-proxy.ts', display: 'src/sandbox/dns-proxy.ts' },
      { path: '/repo/packages/core/src/sandbox/netns.ts', display: 'src/sandbox/netns.ts' },
      { path: '/repo/packages/core/src/sandbox/profiles.ts', display: 'src/sandbox/profiles.ts' },
    ],
    status: 'ok',
  },
  {
    // A restored session has only the result text — the same call degrades to
    // the generic body, no buttons.
    name: 'Grep',
    input: { pattern: 'applySpillPolicy', path: 'packages/core/src' },
    result: 'packages/core/src/agent.ts:16\npackages/core/src/spill/policy.ts:71',
    status: 'ok',
  },
  {
    name: 'Bash',
    input: { command: 'pnpm build' },
    status: 'running',
  },
];

function Preview(): JSX.Element {
  return (
    <div style={{ padding: 24, maxWidth: 860, margin: '0 auto' }}>
      <h2 style={{ font: '600 15px/1.4 system-ui', color: 'var(--text-1)', marginBottom: 16 }}>
        Tool cards by render intent
      </h2>
      {CALLS.map((call, i) => {
        const presentation = presentToolCall(call.name, call.input);
        return (
          <div key={i} style={{ marginBottom: 14 }}>
            <div style={{ font: '11px/1.6 system-ui', color: 'var(--text-3)', marginBottom: 4 }}>
              {call.name} → {presentation.kind}
            </div>
            <ToolCard
              name={call.name}
              target={presentation.kind === 'terminal' ? undefined : presentation.target}
              layout={presentation.kind}
              status={{
                kind: call.status === 'running' ? 'info' : call.status === 'ok' ? 'ok' : 'err',
                label:
                  call.status === 'running'
                    ? '… running'
                    : call.status === 'ok'
                      ? '✓ done'
                      : '✕ error',
              }}
              body={
                <ToolBody
                  presentation={presentation}
                  resultText={call.result}
                  locations={call.locations}
                  onOpenFile={(path) => console.log('open', path)}
                />
              }
            />
          </div>
        );
      })}
    </div>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(<Preview />);
