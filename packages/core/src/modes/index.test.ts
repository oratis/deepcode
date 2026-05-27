import { describe, expect, it } from 'vitest';
import { evaluateMode, modeVerdictReason, type ModeRequest } from './index.js';
import type { Mode } from '../types.js';

function req(tool: string, perm: ModeRequest['permissionVerdict']): ModeRequest {
  return { tool, input: {}, permissionVerdict: perm };
}

describe('evaluateMode', () => {
  describe('plan mode (invariant: write tools always blocked)', () => {
    const mode: Mode = 'plan';
    it('blocks Write regardless of permission', () => {
      expect(evaluateMode(mode, req('Write', 'allow'))).toBe('plan-blocked');
      expect(evaluateMode(mode, req('Write', 'deny'))).toBe('plan-blocked');
      expect(evaluateMode(mode, req('Write', 'no-match'))).toBe('plan-blocked');
    });
    it('blocks Edit and Bash (might have side effects)', () => {
      expect(evaluateMode(mode, req('Edit', 'allow'))).toBe('plan-blocked');
      expect(evaluateMode(mode, req('Bash', 'allow'))).toBe('plan-blocked');
    });
    it('allows read-only tools (Read, Grep, Glob, WebFetch, WebSearch)', () => {
      for (const t of ['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']) {
        expect(evaluateMode(mode, req(t, 'no-match'))).toBe('allow');
      }
    });
    it('blocks unknown tool conservatively', () => {
      expect(evaluateMode(mode, req('UnknownTool', 'allow'))).toBe('plan-blocked');
    });
  });

  describe('bypassPermissions mode (skip permissions; sandbox still enforces — M3.5)', () => {
    const mode: Mode = 'bypassPermissions';
    it('allows everything regardless of permission', () => {
      expect(evaluateMode(mode, req('Bash', 'deny'))).toBe('allow');
      expect(evaluateMode(mode, req('Write', 'no-match'))).toBe('allow');
    });
  });

  describe('acceptEdits mode', () => {
    const mode: Mode = 'acceptEdits';
    it('auto-allows Edit/Write unless permissions explicitly deny', () => {
      expect(evaluateMode(mode, req('Edit', 'no-match'))).toBe('allow');
      expect(evaluateMode(mode, req('Edit', 'ask'))).toBe('allow');
      expect(evaluateMode(mode, req('Edit', 'allow'))).toBe('allow');
      expect(evaluateMode(mode, req('Write', 'ask'))).toBe('allow');
    });
    it('permission deny still wins for Edit/Write', () => {
      expect(evaluateMode(mode, req('Edit', 'deny'))).toBe('deny');
    });
    it('non-Edit tools follow permission rules', () => {
      expect(evaluateMode(mode, req('Bash', 'ask'))).toBe('ask');
      expect(evaluateMode(mode, req('Bash', 'deny'))).toBe('deny');
      expect(evaluateMode(mode, req('Bash', 'no-match'))).toBe('ask');
    });
  });

  describe('dontAsk mode (strict — only allow passes; no prompts)', () => {
    const mode: Mode = 'dontAsk';
    it('only allow passes', () => {
      expect(evaluateMode(mode, req('Read', 'allow'))).toBe('allow');
    });
    it('ask becomes deny (no prompt)', () => {
      expect(evaluateMode(mode, req('Bash', 'ask'))).toBe('deny');
    });
    it('no-match becomes deny', () => {
      expect(evaluateMode(mode, req('Bash', 'no-match'))).toBe('deny');
    });
  });

  describe('default mode', () => {
    const mode: Mode = 'default';
    it('threads through permission', () => {
      expect(evaluateMode(mode, req('Bash', 'allow'))).toBe('allow');
      expect(evaluateMode(mode, req('Bash', 'ask'))).toBe('ask');
      expect(evaluateMode(mode, req('Bash', 'deny'))).toBe('deny');
    });
    it('no-match defaults to ask', () => {
      expect(evaluateMode(mode, req('Bash', 'no-match'))).toBe('ask');
    });
  });

  describe('auto mode (M3 stub — falls back to default behavior)', () => {
    const mode: Mode = 'auto';
    it('threads through permission like default', () => {
      expect(evaluateMode(mode, req('Read', 'allow'))).toBe('allow');
      expect(evaluateMode(mode, req('Bash', 'no-match'))).toBe('ask');
    });
  });

  describe('modeVerdictReason', () => {
    it('explains plan-blocked', () => {
      expect(modeVerdictReason('plan', 'plan-blocked', 'Write')).toMatch(/write tool/);
    });
    it('explains deny', () => {
      expect(modeVerdictReason('default', 'deny', 'Bash')).toMatch(/denied by mode/);
    });
  });
});
