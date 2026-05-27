// Onboarding — interactive API key entry on first run.
// Spec: docs/DEVELOPMENT_PLAN.md §3.4
// M2: prompt → validate format → save to credentials store. Real network
// validation against DeepSeek's /user/balance is deferred until apiKeyHelper
// refresh loop ships in M3.

import { CredentialsStore, type Credentials, redact } from '@deepcode/core';
import { createInterface, type Interface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

const BANNER = `
  ╭─ DeepCode ────────────────────────────────────╮
  │                                               │
  │  Welcome. Let's connect to DeepSeek.          │
  │                                               │
  │  1) Get a key:  https://platform.deepseek.com │
  │  2) Paste it below (input is hidden):         │
  │                                               │
  ╰───────────────────────────────────────────────╯
`;

export interface OnboardingResult {
  creds: Credentials;
  skipped: boolean;
}

export interface OnboardingIO {
  input: Readable;
  output: Writable;
}

export interface OnboardingOpts extends OnboardingIO {
  store: CredentialsStore;
}

export async function runOnboarding(opts: OnboardingOpts): Promise<OnboardingResult> {
  const existing = await opts.store.load();
  if (existing.apiKey || existing.authToken) {
    return { creds: existing, skipped: true };
  }

  opts.output.write(BANNER + '\n');

  const rl = createInterface({ input: opts.input, output: opts.output });
  try {
    const apiKey = await promptHidden(rl, opts.output, 'DeepSeek API Key: ');
    if (!apiKey) {
      opts.output.write('No key provided — skipping (re-run later or set DEEPSEEK_API_KEY).\n');
      return { creds: {}, skipped: true };
    }
    if (!looksLikeDeepSeekKey(apiKey)) {
      opts.output.write(
        '⚠  This does not look like a typical DeepSeek API key (expected sk-… or similar).\n   Saving anyway — you can re-run onboarding if it fails.\n',
      );
    }
    const baseURLRaw = (await rl.question(`Base URL  [https://api.deepseek.com/v1]: `)).trim();
    const baseURL = baseURLRaw || undefined;
    const creds: Credentials = { apiKey, baseURL };
    await opts.store.save(creds);
    opts.output.write(`\n  ✓ Saved ${redact(apiKey)}\n`);
    if (baseURL) opts.output.write(`  ✓ Base URL: ${baseURL}\n`);
    opts.output.write('\n');
    return { creds, skipped: false };
  } finally {
    rl.close();
  }
}

export function looksLikeDeepSeekKey(value: string): boolean {
  return /^sk-[A-Za-z0-9_-]{8,}$/.test(value);
}

/**
 * Prompt for input with character masking (★) to keep secrets off-screen.
 * Implemented via stdin raw-mode + ★ echo per keystroke.
 */
export function promptHidden(rl: Interface, output: Writable, question: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    output.write(question);
    const input = (rl as unknown as { input: NodeJS.ReadStream }).input;
    let muted = '';
    const isTTY = input.isTTY === true;
    if (isTTY && input.setRawMode) {
      input.setRawMode(true);
    }
    const onData = (chunk: Buffer): void => {
      const s = chunk.toString('utf8');
      for (const ch of s) {
        if (ch === '') {
          cleanup();
          rejectPromise(new Error('cancelled'));
          return;
        }
        if (ch === '\n' || ch === '\r') {
          output.write('\n');
          cleanup();
          resolvePromise(muted);
          return;
        }
        if (ch === '' || ch === '\b') {
          if (muted.length > 0) {
            muted = muted.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        muted += ch;
        output.write('★');
      }
    };
    const cleanup = (): void => {
      input.off('data', onData);
      if (isTTY && input.setRawMode) input.setRawMode(false);
    };
    input.on('data', onData);
  });
}
