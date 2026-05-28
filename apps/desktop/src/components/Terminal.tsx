// xterm.js-backed terminal component.
// Spec: docs/DEVELOPMENT_PLAN.md §4 — Mac client terminal embed
//
// MVP scope: a working shell prompt the user can run commands in.
// Commands execute via tool_bash (Rust side). Each command launches
// a fresh /bin/sh -c — no long-running PTY session (that needs
// node-pty equivalent, which is M6-rest+).
//
// Input handling: line-based. User types a full command + Enter →
// it runs → output streams back → next prompt.

import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';

interface BashOk {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const THEME = {
  background: '#0e0e10',
  foreground: '#f4f4f5',
  cursor: '#a3e635',
  selectionBackground: '#27272a',
  black: '#0e0e10',
  red: '#f87171',
  green: '#a3e635',
  yellow: '#fcd34d',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#67e8f9',
  white: '#f4f4f5',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#bef264',
  brightYellow: '#fde68a',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#a5f3fc',
  brightWhite: '#fafafa',
};

const PROMPT = '\x1b[1;32m$\x1b[0m ';

export function Terminal(): JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const inputBuf = useRef<string>('');
  const cwd = useRef<string>('');

  useEffect(() => {
    if (!container.current) return;
    const term = new XTerm({
      theme: THEME,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Capture cwd via Tauri
    invoke<{ home_dir: string | null }>('get_app_info').then((info) => {
      cwd.current = info.home_dir ?? '/';
      term.writeln(
        '\x1b[1;36mDeepCode terminal\x1b[0m — each line runs as /bin/sh -c; type a command + Enter.',
      );
      writePrompt();
    });

    term.onData((data: string) => {
      handleData(data);
    });

    const onResize = () => fit.fit();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function writePrompt(): void {
    const t = termRef.current;
    if (!t) return;
    const cwdShort = cwd.current.replace(/.*\//, '');
    t.write(`\r\n\x1b[1;34m${cwdShort || cwd.current}\x1b[0m ${PROMPT}`);
  }

  function handleData(data: string): void {
    const t = termRef.current;
    if (!t) return;
    // Handle Enter
    if (data === '\r' || data === '\n') {
      const cmd = inputBuf.current.trim();
      inputBuf.current = '';
      t.write('\r\n');
      if (!cmd) {
        writePrompt();
        return;
      }
      if (cmd === 'clear' || cmd === 'cls') {
        t.clear();
        writePrompt();
        return;
      }
      // Handle `cd` specially so subsequent commands inherit the dir
      const cdMatch = /^cd(?:\s+(.+))?$/.exec(cmd);
      if (cdMatch) {
        const dir = (cdMatch[1] ?? '').trim() || '~';
        void resolveCdAndRun(dir);
        return;
      }
      void runBash(cmd);
      return;
    }
    // Handle backspace (DEL or BS)
    if (data === '\x7f' || data === '\b') {
      if (inputBuf.current.length > 0) {
        inputBuf.current = inputBuf.current.slice(0, -1);
        t.write('\b \b');
      }
      return;
    }
    // Ignore other control chars for MVP
    if (data.charCodeAt(0) < 32 && data !== '\t') {
      return;
    }
    inputBuf.current += data;
    t.write(data);
  }

  async function runBash(command: string): Promise<void> {
    const t = termRef.current;
    if (!t) return;
    try {
      const r = (await invoke('tool_bash', {
        input: { command, cwd: cwd.current, timeout_ms: 60_000 },
      })) as BashOk;
      if (r.stdout) t.write(r.stdout.replace(/\n/g, '\r\n'));
      if (r.stderr) {
        if (r.stdout && !r.stdout.endsWith('\n')) t.write('\r\n');
        t.write(`\x1b[1;31m${r.stderr.replace(/\n/g, '\r\n')}\x1b[0m`);
      }
      if (r.timedOut) {
        t.write('\r\n\x1b[1;33m(timed out after 60s)\x1b[0m');
      }
    } catch (err) {
      t.write(`\r\n\x1b[1;31m${(err as Error).message ?? String(err)}\x1b[0m`);
    }
    writePrompt();
  }

  async function resolveCdAndRun(dir: string): Promise<void> {
    const t = termRef.current;
    if (!t) return;
    // Use shell to resolve ~ and relative paths atomically
    const cmd = `cd ${shellQuote(dir)} && pwd`;
    try {
      const r = (await invoke('tool_bash', {
        input: { command: cmd, cwd: cwd.current, timeout_ms: 10_000 },
      })) as BashOk;
      if (r.exitCode === 0 && r.stdout.trim()) {
        cwd.current = r.stdout.trim();
      } else {
        t.write(`\x1b[1;31m${r.stderr || `cd: ${dir}: No such directory`}\x1b[0m`);
      }
    } catch (err) {
      t.write(`\x1b[1;31m${(err as Error).message ?? String(err)}\x1b[0m`);
    }
    writePrompt();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-xs text-muted">
        Terminal · /bin/sh
      </div>
      <div ref={container} className="flex-1 bg-bg" />
    </div>
  );
}

function shellQuote(s: string): string {
  if (s === '~' || s.startsWith('~/')) return s; // Let shell expand
  return `'${s.replace(/'/g, "'\\''")}'`;
}
