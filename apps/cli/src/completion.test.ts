import { describe, expect, it } from 'vitest';
import type { Writable } from 'node:stream';
import {
  completionScript,
  isCompletionShell,
  runCompletion,
  COMPLETION_SHELLS,
} from './completion.js';

function collector(): { stream: Writable; text: () => string } {
  let buf = '';
  const stream = {
    write: (s: string): boolean => {
      buf += s;
      return true;
    },
  } as unknown as Writable;
  return { stream, text: () => buf };
}

describe('completionScript', () => {
  it('bash script registers a completion function with flags + subcommands', () => {
    const s = completionScript('bash');
    expect(s).toContain('complete -F _deepcode deepcode');
    expect(s).toContain('--model');
    expect(s).toContain('doctor');
    expect(s).toContain('-C');
  });

  it('zsh script uses compdef', () => {
    const s = completionScript('zsh');
    expect(s).toContain('#compdef deepcode');
    expect(s).toContain('compdef _deepcode deepcode');
    expect(s).toContain("'--effort'");
  });

  it('fish script registers completions per flag + subcommands', () => {
    const s = completionScript('fish');
    expect(s).toContain('complete -c deepcode -l model');
    expect(s).toContain('complete -c deepcode -o C'); // the -C short flag
    expect(s).toContain('completion'); // subcommand listed
  });

  it('COMPLETION_SHELLS lists the three supported shells', () => {
    expect(COMPLETION_SHELLS).toEqual(['bash', 'zsh', 'fish']);
  });
});

describe('isCompletionShell', () => {
  it('accepts known shells, rejects others', () => {
    expect(isCompletionShell('bash')).toBe(true);
    expect(isCompletionShell('zsh')).toBe(true);
    expect(isCompletionShell('fish')).toBe(true);
    expect(isCompletionShell('powershell')).toBe(false);
    expect(isCompletionShell(undefined)).toBe(false);
  });
});

describe('runCompletion', () => {
  it('writes the script and returns 0 for a known shell', () => {
    const out = collector();
    const err = collector();
    const code = runCompletion(['bash'], { output: out.stream, errOutput: err.stream });
    expect(code).toBe(0);
    expect(out.text()).toContain('complete -F _deepcode deepcode');
    expect(err.text()).toBe('');
  });

  it('returns 2 and a usage message for an unknown shell', () => {
    const out = collector();
    const err = collector();
    const code = runCompletion(['powershell'], { output: out.stream, errOutput: err.stream });
    expect(code).toBe(2);
    expect(err.text()).toMatch(/Usage: deepcode completion/);
    expect(out.text()).toBe('');
  });

  it('returns 2 when no shell argument is given', () => {
    const out = collector();
    const err = collector();
    const code = runCompletion([], { output: out.stream, errOutput: err.stream });
    expect(code).toBe(2);
  });
});
