#!/usr/bin/env node
// effort-bench — measure DeepSeek API actual response under each effort tier.
// Spec: docs/design/effort-levels.md §6
//
// Usage:
//   DEEPSEEK_API_KEY=sk-... pnpm -F @deepcode/core tsx scripts/effort-bench.ts
//
// Output:
//   - stdout: human summary table
//   - docs/design/effort-levels-measured.csv (next to the design doc)
//
// Each scenario × each effort tier runs once. NOTE: this burns real API tokens —
// estimated ~¥0.5 per full sweep. Reads credentials from ~/.deepcode/credentials.json
// or DEEPSEEK_API_KEY env var.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DeepSeekProvider, EFFORT_PARAMS, type Effort } from '../src/index.js';

interface Scenario {
  name: string;
  description: string;
  model: 'deepseek-chat' | 'deepseek-reasoner';
  prompt: string;
  systemPrompt?: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'simple-fix',
    description: 'Quick targeted bug-fix scenario',
    model: 'deepseek-chat',
    prompt:
      'I have a TypeScript file `src/foo.ts` with a typo "calue" — what one-line fix do I apply?',
  },
  {
    name: 'medium-refactor',
    description: 'Mid-sized refactoring scenario',
    model: 'deepseek-chat',
    prompt:
      'Sketch the steps to extract retry+backoff logic from src/http-client.ts into a reusable src/retry.ts (with TS types).',
  },
  {
    name: 'complex-reasoning',
    description: 'Multi-step reasoning scenario',
    model: 'deepseek-reasoner',
    prompt:
      'Walk me through migrating a Prisma schema to drizzle: outline the steps, the edge cases, and what could go wrong.',
  },
];

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

interface BenchRow {
  scenario: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  temperature: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  finishReason: string;
  costYuan: number;
}

async function resolveKey(): Promise<string> {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    const raw = await fs.readFile(join(homedir(), '.deepcode', 'credentials.json'), 'utf8');
    const parsed = JSON.parse(raw) as { apiKey?: string };
    if (parsed.apiKey) return parsed.apiKey;
  } catch {
    /* fall through */
  }
  throw new Error(
    'No DEEPSEEK_API_KEY env var or ~/.deepcode/credentials.json — set one before running effort-bench',
  );
}

function calcCostYuan(
  model: string,
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number },
): number {
  const isReasoner = model.includes('reasoner');
  const inputRate = 1.0; // ¥/M
  const outputRate = isReasoner ? 16.0 : 2.0;
  const reasoningRate = isReasoner ? 4.0 : 0;
  return (
    (usage.inputTokens / 1e6) * inputRate +
    (usage.outputTokens / 1e6) * outputRate +
    (usage.reasoningTokens / 1e6) * reasoningRate
  );
}

async function runOne(provider: DeepSeekProvider, sc: Scenario, effort: Effort): Promise<BenchRow> {
  const params = EFFORT_PARAMS[effort];
  const t0 = Date.now();
  const result = await provider.runTurn({
    model: sc.model,
    systemPrompt: sc.systemPrompt ?? 'You are DeepCode, a coding assistant. Be concise.',
    tools: [],
    messages: [{ role: 'user', content: [{ type: 'text', text: sc.prompt }] }],
    maxTokens: params.maxTokens,
    temperature: params.temperature,
  });
  const dt = Date.now() - t0;
  return {
    scenario: sc.name,
    model: sc.model,
    effort,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    durationMs: dt,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
    finishReason: result.stopReason,
    costYuan: calcCostYuan(sc.model, result.usage),
  };
}

async function main(): Promise<void> {
  const apiKey = await resolveKey();
  const provider = new DeepSeekProvider({ apiKey });

  const rows: BenchRow[] = [];
  console.log('Running effort-bench across scenarios × effort tiers...\n');

  for (const sc of SCENARIOS) {
    console.log(`▸ ${sc.name} (${sc.model})`);
    for (const eff of EFFORTS) {
      process.stdout.write(`   ${eff.padEnd(7)} `);
      try {
        const row = await runOne(provider, sc, eff);
        rows.push(row);
        process.stdout.write(
          `· ${row.durationMs.toString().padStart(5)}ms · in=${row.inputTokens} out=${row.outputTokens} reasoning=${row.reasoningTokens} · ¥${row.costYuan.toFixed(4)}\n`,
        );
      } catch (err) {
        process.stdout.write(`· FAILED: ${(err as Error).message}\n`);
      }
    }
    console.log('');
  }

  // CSV output
  const header =
    'scenario,model,effort,maxTokens,temperature,durationMs,inputTokens,outputTokens,reasoningTokens,finishReason,costYuan';
  const lines = [header];
  for (const r of rows) {
    lines.push(
      [
        r.scenario,
        r.model,
        r.effort,
        r.maxTokens,
        r.temperature,
        r.durationMs,
        r.inputTokens,
        r.outputTokens,
        r.reasoningTokens,
        r.finishReason,
        r.costYuan.toFixed(6),
      ].join(','),
    );
  }
  // Write CSV next to the design doc
  const outPath = '../../docs/design/effort-levels-measured.csv';
  await fs.writeFile(outPath, lines.join('\n') + '\n', 'utf8');
  console.log(`\nWrote ${outPath} (${rows.length} rows)`);
}

main().catch((err) => {
  console.error('effort-bench failed:', err);
  process.exit(1);
});
