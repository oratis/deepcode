import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { detectVoice, expandHome, type VoiceProbe } from './detect.js';
import type { VoiceConfig } from '../config/types.js';

const HOME = '/home/u';

/** Build a fake probe where `present` is the set of paths/bins that "exist". */
function probe(
  present: Iterable<string>,
  overrides: Partial<VoiceProbe> = {},
): Partial<VoiceProbe> {
  const set = new Set(present);
  return {
    home: HOME,
    fileExists: async (p) => set.has(p),
    which: async (name) => (set.has(name) ? `/usr/bin/${name}` : null),
    ...overrides,
  };
}

describe('expandHome', () => {
  it('expands ~ and ~/path, leaves others alone', () => {
    expect(expandHome('~', HOME)).toBe(HOME);
    expect(expandHome('~/m/x.bin', HOME)).toBe(join(HOME, 'm/x.bin'));
    expect(expandHome('/abs/x.bin', HOME)).toBe('/abs/x.bin');
    expect(expandHome('rel/x.bin', HOME)).toBe('rel/x.bin');
  });
});

describe('detectVoice', () => {
  it('is ready when configured binPath + modelPath both exist', async () => {
    const voice: VoiceConfig = { binPath: '/opt/whisper-cli', modelPath: '/models/base.bin' };
    const s = await detectVoice(voice, probe(['/opt/whisper-cli', '/models/base.bin']));
    expect(s.ready).toBe(true);
    expect(s.binPath).toBe('/opt/whisper-cli');
    expect(s.modelPath).toBe('/models/base.bin');
    expect(s.problems).toEqual([]);
  });

  it('finds the binary on PATH when binPath is unset', async () => {
    // 'whisper-cli' is the first candidate; PATH has it.
    const def = join(HOME, '.deepcode', 'models', 'whisper-base.en.bin');
    const s = await detectVoice({ modelPath: def }, probe(['whisper-cli', def]));
    expect(s.ready).toBe(true);
    expect(s.binPath).toBe('/usr/bin/whisper-cli');
  });

  it('falls back to the second PATH candidate (whisper)', async () => {
    const s = await detectVoice(
      { modelPath: '/m.bin' },
      probe(['whisper', '/m.bin']), // no whisper-cli, but whisper exists
    );
    expect(s.binPath).toBe('/usr/bin/whisper');
    expect(s.ready).toBe(true);
  });

  it('uses the default ~/.deepcode model path when modelPath is unset', async () => {
    const def = join(HOME, '.deepcode', 'models', 'whisper-base.en.bin');
    const s = await detectVoice({ binPath: '/b' }, probe(['/b', def]));
    expect(s.ready).toBe(true);
    expect(s.modelPath).toBe(def);
  });

  it('reports both missing pieces when nothing is installed', async () => {
    const s = await detectVoice(undefined, probe([])); // empty PATH + fs
    expect(s.ready).toBe(false);
    expect(s.binPath).toBeUndefined();
    expect(s.modelPath).toBeUndefined();
    expect(s.problems.join('\n')).toMatch(/binary not found on PATH/);
    expect(s.problems.join('\n')).toMatch(/no model at the default/);
  });

  it('flags a configured binPath / modelPath that does not exist', async () => {
    const s = await detectVoice(
      { binPath: '/nope/whisper', modelPath: '/nope/model.bin' },
      probe([]),
    );
    expect(s.ready).toBe(false);
    expect(s.problems).toContain('Configured voice.binPath not found: /nope/whisper');
    expect(s.problems).toContain('Configured voice.modelPath not found: /nope/model.bin');
  });

  it('expands ~ in configured paths against the probe home', async () => {
    const bin = join(HOME, 'bin', 'whisper');
    const model = join(HOME, 'm', 'x.bin');
    const s = await detectVoice(
      { binPath: '~/bin/whisper', modelPath: '~/m/x.bin' },
      probe([bin, model]),
    );
    expect(s.ready).toBe(true);
    expect(s.binPath).toBe(bin);
    expect(s.modelPath).toBe(model);
  });

  it('is not ready with an unknown provider even if bin + model resolve', async () => {
    const s = await detectVoice(
      { provider: 'azure' as unknown as VoiceConfig['provider'], binPath: '/b', modelPath: '/m' },
      probe(['/b', '/m']),
    );
    expect(s.ready).toBe(false);
    expect(s.provider).toBe('azure');
    expect(s.problems.join('\n')).toMatch(/Unknown voice provider/);
  });
});
