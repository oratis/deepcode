// `auto` mode classifier — LLM-judged per-tool-call gate.
// Spec: docs/DEVELOPMENT_PLAN.md §3.8 (M3c-rest)
//
// When mode === 'auto', every tool call goes through:
//   1. Static deny/allow against AutoModeConfig (hard_deny → block, allow → pass)
//   2. If none matched, call a small LLM to classify the call as
//      "allow" | "soft-deny" | "ask". Output drives the gate.
//   3. fallback determines what happens when the LLM returns no clear verdict.

import type { AutoModeConfig, PermissionRules } from '../config/types.js';
import { matchRule } from '../config/permissions.js';
import type { Provider } from '../providers/types.js';

export type AutoVerdict = 'allow' | 'ask' | 'deny';

export interface ClassifyOpts {
  /** Tool call to judge. */
  toolName: string;
  toolInput: Record<string, unknown>;
  /** AutoModeConfig from settings. Undefined → no static rules; LLM only. */
  config?: AutoModeConfig;
  /** Provider for the LLM judge. Required unless config decides statically. */
  provider?: Provider;
  /** Model id for the judge call. Defaults to config.model or deepseek-chat. */
  model?: string;
}

/**
 * Decide whether a tool call is allowed under auto mode.
 *
 * Order:
 *   1. allow[] match → 'allow' (no LLM call)
 *   2. hard_deny[] match → 'deny'
 *   3. soft_deny[] match → 'ask'
 *   4. LLM classifier on the primary input string
 *   5. fallback ('ask' default)
 */
export async function classifyAutoMode(opts: ClassifyOpts): Promise<AutoVerdict> {
  const cfg = opts.config ?? {};
  const rules: PermissionRules = {
    allow: cfg.allow,
    ask: cfg.soft_deny,
    deny: cfg.hard_deny,
  };
  const req = { tool: opts.toolName, input: opts.toolInput };
  for (const rule of rules.deny ?? []) {
    if (matchRule(rule, req)) return 'deny';
  }
  for (const rule of rules.allow ?? []) {
    if (matchRule(rule, req)) return 'allow';
  }
  for (const rule of rules.ask ?? []) {
    if (matchRule(rule, req)) return 'ask';
  }

  // LLM classifier
  if (!opts.provider) {
    return (cfg.fallback ?? 'ask') as AutoVerdict;
  }
  try {
    const verdict = await llmClassify(opts.provider, opts.toolName, opts.toolInput, opts.model);
    return verdict;
  } catch {
    return (cfg.fallback ?? 'ask') as AutoVerdict;
  }
}

const CLASSIFY_PROMPT = `You are a safety classifier for an AI coding assistant. You receive a single tool call and must decide:
  · "allow" — the call is clearly safe (e.g. reading a project file, running tests)
  · "ask" — uncertain risk (e.g. running an unfamiliar shell command, modifying config)
  · "deny" — clearly dangerous (e.g. \`rm -rf /\`, exfiltrating secrets, writing to /usr or /etc)

Respond with EXACTLY one of: allow | ask | deny

Be conservative: when in doubt, say "ask". Never say "deny" without reason.`;

async function llmClassify(
  provider: Provider,
  toolName: string,
  toolInput: Record<string, unknown>,
  model?: string,
): Promise<AutoVerdict> {
  const userMsg = `Tool: ${toolName}\nInput: ${JSON.stringify(toolInput).slice(0, 1500)}`;
  const result = await provider.runTurn({
    model: model ?? 'deepseek-chat',
    systemPrompt: CLASSIFY_PROMPT,
    tools: [],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userMsg }] },
    ],
    maxTokens: 8,
    temperature: 0,
  });
  const textBlock = result.content.find((c) => c.type === 'text');
  if (!textBlock || textBlock.type !== 'text') return 'ask';
  const raw = textBlock.text.toLowerCase().trim();
  if (raw.startsWith('allow')) return 'allow';
  if (raw.startsWith('deny')) return 'deny';
  return 'ask';
}
