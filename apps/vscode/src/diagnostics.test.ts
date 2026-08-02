import { describe, expect, it } from 'vitest';

import { formatConfigDiagnostics } from './diagnostics.js';

describe('formatConfigDiagnostics', () => {
  it('renders trust, source layers, gates, and issues without configuration values', () => {
    const output = formatConfigDiagnostics({
      cwd: '/workspace',
      trustStatus: 'untrusted',
      layers: [
        {
          layer: 'project',
          path: '/workspace/.deepcode/settings.json',
          present: true,
          trusted: false,
        },
      ],
      provenance: { '/env/API_TOKEN': { layer: 'project', path: '/settings.json' } },
      gated: ['env'],
      issues: [
        {
          severity: 'warning',
          code: 'untrusted_setting_gated',
          message: 'Ignored project setting /env',
        },
      ],
    }).join('\n');

    expect(output).toContain('Trust: untrusted');
    expect(output).toContain('project  untrusted');
    expect(output).toContain('Gated fields: env');
    expect(output).toContain('WARNING untrusted_setting_gated');
    expect(output).not.toContain('secret-value');
  });
});
