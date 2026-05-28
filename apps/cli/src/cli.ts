#!/usr/bin/env node
// deepcode CLI entry point.
// Spec: docs/DEVELOPMENT_PLAN.md §5 / §5a
// M2: onboarding + REPL + slash commands + settings + permissions matcher.

import { CredentialsStore, VERSION, redact } from '@deepcode/core';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { runHeadless } from './headless.js';
import { runOnboarding } from './onboarding.js';
import { helpText, parseArgs } from './parse-args.js';
import { startRepl } from './repl.js';

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.showVersion) {
    process.stdout.write(VERSION + '\n');
    return 0;
  }

  if (args.showHelp) {
    process.stdout.write(helpText(VERSION));
    return 0;
  }

  if (args.unknownFlags.length > 0) {
    process.stderr.write(`Unknown or invalid flags: ${args.unknownFlags.join(' ')}\n`);
    process.stderr.write(`Run \`deepcode --help\` for the full list.\n`);
    return 2;
  }

  if (args.doctor) {
    return doctor();
  }
  if (args.upgrade) {
    process.stdout.write(`Run: npm i -g deepcode-cli@latest\n`);
    process.stdout.write(`(Self-update via electron-updater is Mac-client only — see §4b.)\n`);
    return 0;
  }

  // Headless one-shot (-p / --print)
  if (args.prompt !== undefined) {
    return runHeadless({
      output: process.stdout,
      errOutput: process.stderr,
      cwd: process.cwd(),
      prompt: args.prompt,
      outputFormat: args.outputFormat,
      mode: args.mode,
      model: args.model,
      effort: args.effort,
      systemPromptOverride: args.systemPrompt,
      appendSystemPrompt: args.appendSystemPrompt,
      appendSystemPromptFile: args.appendSystemPromptFile,
      allowedTools: args.allowedTools,
      disallowedTools: args.disallowedTools,
      maxTurns: args.maxTurns,
      jsonSchema: args.jsonSchema,
      includePartialMessages: args.includePartialMessages,
    });
  }

  // Onboarding if no creds
  const credsStore = new CredentialsStore();
  const existing = await credsStore.load();
  if (!existing.apiKey && !existing.authToken && !process.env.DEEPSEEK_API_KEY) {
    const result = await runOnboarding({
      input: process.stdin,
      output: process.stdout,
      store: credsStore,
    });
    if (result.skipped && !result.creds.apiKey && !result.creds.authToken) {
      process.stdout.write('Skipped onboarding. Set DEEPSEEK_API_KEY or re-run `deepcode`.\n');
      return 0;
    }
  }

  // Otherwise: REPL
  return startRepl({
    input: process.stdin,
    output: process.stdout,
    cwd: process.cwd(),
    mode: args.mode,
    model: args.model,
    effort: args.effort,
    systemPromptOverride: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
    appendSystemPromptFile: args.appendSystemPromptFile,
    allowedTools: args.allowedTools,
    disallowedTools: args.disallowedTools,
    maxTurns: args.maxTurns,
  });
}

async function doctor(): Promise<number> {
  process.stdout.write(`DeepCode v${VERSION}\n`);
  process.stdout.write(`Node: ${process.version}\n`);
  process.stdout.write(`Platform: ${process.platform} ${process.arch}\n`);
  process.stdout.write(`Home: ${homedir()}\n`);
  process.stdout.write(`CWD: ${resolve(process.cwd())}\n`);
  try {
    const store = new CredentialsStore();
    const creds = await store.load();
    process.stdout.write(`API key: ${redact(creds.apiKey ?? creds.authToken)}\n`);
    process.stdout.write(`Base URL: ${creds.baseURL ?? 'https://api.deepseek.com/v1'}\n`);
  } catch (err) {
    process.stdout.write(`Credentials error: ${(err as Error).message}\n`);
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Fatal: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
