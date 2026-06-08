import { describe, expect, it } from 'vitest';
import { settingsSchemaJson, settingsSchemaObject, validateSettingsShallow } from './schema.js';

describe('settingsSchemaJson', () => {
  it('returns valid JSON that parses to an object with $schema', async () => {
    const raw = await settingsSchemaJson();
    expect(raw.length).toBeGreaterThan(100);
    const obj = JSON.parse(raw) as { $schema: string; title: string };
    expect(obj.$schema).toContain('draft-07');
    expect(obj.title).toMatch(/settings/i);
  });
});

describe('settingsSchemaObject', () => {
  it('returns the parsed object', async () => {
    const o = await settingsSchemaObject();
    expect(o['title']).toMatch(/settings/i);
    expect(typeof o['properties']).toBe('object');
  });
});

describe('validateSettingsShallow', () => {
  it('returns empty array for a clean config', () => {
    expect(
      validateSettingsShallow({
        model: 'deepseek-chat',
        effortLevel: 'high',
        permissions: { defaultMode: 'plan' },
      }),
    ).toEqual([]);
  });

  it('flags unknown model', () => {
    const errs = validateSettingsShallow({ model: 'gpt-4' });
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/gpt-4/);
  });

  it('flags unknown effort tier', () => {
    const errs = validateSettingsShallow({ effortLevel: 'turbo' });
    expect(errs[0]).toMatch(/turbo/);
  });

  it('flags unknown defaultMode', () => {
    const errs = validateSettingsShallow({ permissions: { defaultMode: 'YOLO' } });
    expect(errs[0]).toMatch(/YOLO/);
  });

  it('flags unknown hook event', () => {
    const errs = validateSettingsShallow({ hooks: { OnEverything: [] } });
    expect(errs[0]).toMatch(/OnEverything/);
  });

  it('flags unknown voice provider but accepts whisper.cpp', () => {
    expect(validateSettingsShallow({ voice: { provider: 'whisper.cpp' } })).toEqual([]);
    const errs = validateSettingsShallow({ voice: { provider: 'azure' } });
    expect(errs[0]).toMatch(/voice\.provider "azure"/);
  });

  it('returns no errors on empty config', () => {
    expect(validateSettingsShallow({})).toEqual([]);
  });

  it('catches multiple errors at once', () => {
    const errs = validateSettingsShallow({
      model: 'bad',
      effortLevel: 'bad',
      permissions: { defaultMode: 'bad' },
    });
    expect(errs.length).toBe(3);
  });
});
