import { describe, expect, it } from 'vitest';
import { parseArgs, resolveEffort } from './parse-args.js';

describe('parseArgs', () => {
  it('parses empty argv', () => {
    const p = parseArgs([]);
    expect(p.showHelp).toBe(false);
    expect(p.showVersion).toBe(false);
    expect(p.outputFormat).toBe('text');
  });

  it('--help / -h', () => {
    expect(parseArgs(['--help']).showHelp).toBe(true);
    expect(parseArgs(['-h']).showHelp).toBe(true);
  });

  it('--version / -v', () => {
    expect(parseArgs(['--version']).showVersion).toBe(true);
    expect(parseArgs(['-v']).showVersion).toBe(true);
  });

  it('doctor / upgrade subcommands', () => {
    expect(parseArgs(['doctor']).doctor).toBe(true);
    expect(parseArgs(['upgrade']).upgrade).toBe(true);
  });

  it('-p "prompt"', () => {
    expect(parseArgs(['-p', 'do the thing']).prompt).toBe('do the thing');
    expect(parseArgs(['--print', 'foo']).prompt).toBe('foo');
  });

  it('--resume without id', () => {
    const p = parseArgs(['--resume']);
    expect(p.resume).toBe(true);
    expect(p.resumeId).toBeUndefined();
  });
  it('--resume <id>', () => {
    const p = parseArgs(['--resume', 'sess-abc']);
    expect(p.resume).toBe(true);
    expect(p.resumeId).toBe('sess-abc');
  });
  it('--resume followed by next flag has no id', () => {
    const p = parseArgs(['--resume', '--mode', 'plan']);
    expect(p.resume).toBe(true);
    expect(p.resumeId).toBeUndefined();
    expect(p.mode).toBe('plan');
  });

  it('--mode validation', () => {
    expect(parseArgs(['--mode', 'plan']).mode).toBe('plan');
    expect(parseArgs(['--mode', 'bypassPermissions']).mode).toBe('bypassPermissions');
    const p = parseArgs(['--mode', 'invalid']);
    expect(p.mode).toBeUndefined();
    expect(p.unknownFlags).toContain('--mode invalid');
  });

  it('--effort validation', () => {
    expect(parseArgs(['--effort', 'high']).effort).toBe('high');
    expect(parseArgs(['--effort', 'wrong']).unknownFlags).toContain('--effort wrong');
  });

  it('--max-turns parses to number', () => {
    expect(parseArgs(['--max-turns', '5']).maxTurns).toBe(5);
    expect(parseArgs(['--max-turns', 'NaN']).unknownFlags).toContain('--max-turns NaN');
  });

  it('--allowedTools / --disallowedTools comma-list', () => {
    expect(parseArgs(['--allowedTools', 'Read,Grep,Edit']).allowedTools).toEqual([
      'Read',
      'Grep',
      'Edit',
    ]);
    expect(parseArgs(['--disallowedTools', 'Bash, WebFetch']).disallowedTools).toEqual([
      'Bash',
      'WebFetch',
    ]);
  });

  it('--output-format validation', () => {
    expect(parseArgs(['--output-format', 'json']).outputFormat).toBe('json');
    expect(parseArgs(['--output-format', 'stream-json']).outputFormat).toBe('stream-json');
    expect(parseArgs(['--output-format', 'wrong']).unknownFlags).toContain('--output-format wrong');
  });

  it('boolean flags', () => {
    const p = parseArgs([
      '--bare',
      '--no-plugins',
      '--strict',
      '--verbose',
      '--include-partial-messages',
      '--fork-session',
      '--continue',
    ]);
    expect(p.bare).toBe(true);
    expect(p.noPlugins).toBe(true);
    expect(p.strict).toBe(true);
    expect(p.verbose).toBe(true);
    expect(p.includePartialMessages).toBe(true);
    expect(p.forkSession).toBe(true);
    expect(p.continue).toBe(true);
  });

  it('captures unknown flags', () => {
    const p = parseArgs(['--made-up-flag']);
    expect(p.unknownFlags).toEqual(['--made-up-flag']);
  });

  it('collects positional args', () => {
    const p = parseArgs(['foo', 'bar']);
    expect(p.positional).toEqual(['foo', 'bar']);
  });

  it('combo: realistic invocation', () => {
    const p = parseArgs([
      '--mode',
      'acceptEdits',
      '--model',
      'deepseek-reasoner',
      '--effort',
      'high',
      '--max-turns',
      '12',
    ]);
    expect(p.mode).toBe('acceptEdits');
    expect(p.model).toBe('deepseek-reasoner');
    expect(p.effort).toBe('high');
    expect(p.maxTurns).toBe(12);
    expect(p.unknownFlags).toEqual([]);
  });
});

describe('resolveEffort (precedence)', () => {
  it('cli flag wins over env and settings', () => {
    expect(resolveEffort({ cliFlag: 'high', envVar: 'low', settingsLevel: 'max' })).toBe('high');
  });

  it('env var wins when no cli flag', () => {
    expect(resolveEffort({ envVar: 'xhigh', settingsLevel: 'low' })).toBe('xhigh');
  });

  it('settings wins when no cli flag and no env', () => {
    expect(resolveEffort({ settingsLevel: 'low' })).toBe('low');
  });

  it('defaults to medium when nothing is set', () => {
    expect(resolveEffort({})).toBe('medium');
  });

  it('ignores invalid env var', () => {
    expect(resolveEffort({ envVar: 'ultra', settingsLevel: 'low' })).toBe('low');
  });

  it('trims whitespace in env var', () => {
    expect(resolveEffort({ envVar: '  high  ' })).toBe('high');
  });

  it('ignores empty env var', () => {
    expect(resolveEffort({ envVar: '', settingsLevel: 'max' })).toBe('max');
  });
});
