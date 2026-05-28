// Headless one-shot mode: `deepcode -p "do X"`
// Spec: docs/DEVELOPMENT_PLAN.md §5a (M8) — implemented earlier than scheduled.
//
// Three output formats:
//   text         — plain text deltas + minimal tool markers (default)
//   json         — single JSON object on stdout at exit
//   stream-json  — JSONL of every agent event (NDJSON)
//
// Exit codes (stable contract — do NOT change without bumping major):
//   0  success
//   1  generic error (uncaught)
//   2  bad input (handled in cli.ts before reaching here)
//   3  API / provider error (network, auth)
//   4  max turns reached without completion
//   5  aborted by signal (SIGINT / SIGTERM)

import {
  CredentialsStore,
  DeepSeekProvider,
  EFFORT_PARAMS,
  HookDispatcher,
  SessionManager,
  ToolRegistry,
  applyStyle,
  buildSkillsDescriptionBlock,
  closeAllMcpServers,
  connectAllMcpServers,
  findStyle,
  loadMemory,
  loadOutputStyles,
  loadSettings,
  loadSkills,
  makeSkillTool,
  resolveCredentials,
  runAgent,
  type AgentEvent,
  type DeepCodeSettings,
  type Effort,
  type McpClientHandle,
  type Mode,
} from '@deepcode/core';
import type { Writable } from 'node:stream';

export interface HeadlessOpts {
  output: Writable;
  errOutput: Writable;
  cwd: string;
  home?: string;
  /** The prompt to run. */
  prompt: string;
  /** text | json | stream-json (cli default 'text'). */
  outputFormat: 'text' | 'json' | 'stream-json';
  mode?: string;
  model?: string;
  effort?: Effort;
  systemPromptOverride?: string;
  appendSystemPrompt?: string;
  appendSystemPromptFile?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
}

const DEFAULT_SYSTEM_PROMPT = `You are DeepCode, an AI coding assistant powered by DeepSeek. Help the user with their codebase using the available tools. Be concise and accurate. When you modify files, briefly explain what you changed and why.`;

const DEFAULT_HEADLESS_MAX_TURNS = 30;

export async function runHeadless(opts: HeadlessOpts): Promise<number> {
  const { output, errOutput, cwd, prompt, outputFormat } = opts;

  // ─── load config + credentials ───────────────────────────────────────
  const loaded = await loadSettings({ cwd, home: opts.home });
  const settings: DeepCodeSettings = loaded.merged;
  const credsStore = new CredentialsStore({ home: opts.home });
  const creds = await resolveCredentials({
    store: credsStore,
    apiKeyHelper: settings.apiKeyHelper,
  });
  if (!creds.apiKey && !creds.authToken) {
    errOutput.write(
      'No DeepSeek credentials. Set DEEPSEEK_API_KEY or run interactive `deepcode` to onboard.\n',
    );
    return 3;
  }

  const model = opts.model ?? settings.model ?? 'deepseek-chat';
  const mode = (opts.mode ?? settings.permissions?.defaultMode ?? 'default') as Mode;
  const effort = opts.effort ?? settings.effortLevel ?? 'medium';
  const { maxTokens, temperature } = EFFORT_PARAMS[effort as Effort] ?? EFFORT_PARAMS.medium;
  const maxTurns = opts.maxTurns ?? DEFAULT_HEADLESS_MAX_TURNS;

  const provider = new DeepSeekProvider({
    apiKey: creds.apiKey ?? '',
    authToken: creds.authToken,
    baseURL: creds.baseURL ?? settings.baseURL,
  });

  // ─── tools (with --allowedTools / --disallowedTools filter) ──────────
  let tools: ToolRegistry;
  if (opts.allowedTools || opts.disallowedTools) {
    const { BUILTIN_TOOLS } = await import('@deepcode/core');
    const allowSet = opts.allowedTools ? new Set(opts.allowedTools) : null;
    const denySet = new Set(opts.disallowedTools ?? []);
    const filtered = BUILTIN_TOOLS.filter((t) => {
      if (denySet.has(t.name)) return false;
      if (allowSet && !allowSet.has(t.name)) return false;
      return true;
    });
    tools = new ToolRegistry(filtered);
  } else {
    tools = new ToolRegistry();
  }

  // ─── memory + skills + style ────────────────────────────────────────
  const memory = await loadMemory({
    cwd,
    home: opts.home,
    maxBytes: (settings.memoryLoadCapKB ?? 100) * 1024,
  });
  const builtinSkillsDir = await resolveBuiltinSkillsDir();
  const skills = await loadSkills({
    cwd,
    home: opts.home,
    builtinDir: builtinSkillsDir,
    overrides: settings.skillOverrides,
  });
  const styles = await loadOutputStyles({ cwd, home: opts.home });
  const activeStyle = findStyle(styles, settings.outputStyle ?? 'default');
  if (skills.length > 0) tools.register(makeSkillTool(skills));

  // ─── MCP ─────────────────────────────────────────────────────────────
  let mcpServers: McpClientHandle[] = [];
  if (settings.mcpServers && Object.keys(settings.mcpServers).length > 0) {
    const r = await connectAllMcpServers(settings.mcpServers, {
      enabledOnly: settings.enabledMcpjsonServers,
      disabled: settings.disabledMcpjsonServers ?? [],
    });
    mcpServers = r.handles;
    for (const handle of mcpServers) for (const t of handle.tools) tools.register(t);
  }

  // ─── system prompt assembly ─────────────────────────────────────────
  let systemPrompt = opts.systemPromptOverride ?? DEFAULT_SYSTEM_PROMPT;
  if (memory.text) systemPrompt += '\n\n' + memory.text;
  const skillsBlock = buildSkillsDescriptionBlock(skills);
  if (skillsBlock) systemPrompt += '\n\n' + skillsBlock;
  systemPrompt = applyStyle(systemPrompt, activeStyle);
  if (opts.appendSystemPrompt) systemPrompt += '\n\n' + opts.appendSystemPrompt;
  if (opts.appendSystemPromptFile) {
    try {
      const { readFile } = await import('node:fs/promises');
      systemPrompt += '\n\n' + (await readFile(opts.appendSystemPromptFile, 'utf8'));
    } catch (err) {
      errOutput.write(
        `Warning: could not read --append-system-prompt-file: ${(err as Error).message}\n`,
      );
    }
  }

  const hooks = new HookDispatcher({
    hooks: settings.hooks,
    disableAllHooks: settings.disableAllHooks,
    allowedHttpHookUrls: settings.allowedHttpHookUrls,
  });

  const sessions = new SessionManager();
  const session = await sessions.create(cwd, { model });

  // ─── set up output ──────────────────────────────────────────────────
  const collectedEvents: AgentEvent[] = [];
  const onEvent = (e: AgentEvent) => {
    collectedEvents.push(e);
    if (outputFormat === 'stream-json') {
      output.write(JSON.stringify(e) + '\n');
    } else if (outputFormat === 'text') {
      formatEventText(output, e);
    }
    // json mode: defer everything until end
  };

  // ─── abort plumbing ─────────────────────────────────────────────────
  const ctrl = new AbortController();
  let aborted = false;
  const sigintHandler = () => {
    aborted = true;
    ctrl.abort();
  };
  process.on('SIGINT', sigintHandler);
  process.on('SIGTERM', sigintHandler);

  // ─── run ────────────────────────────────────────────────────────────
  let exitCode = 0;
  try {
    const result = await runAgent({
      provider,
      tools,
      systemPrompt,
      userMessage: prompt,
      history: [],
      model,
      maxTokens,
      temperature,
      maxTurns,
      cwd,
      session: { manager: sessions, id: session.id },
      mode,
      permissions: settings.permissions,
      hooks,
      autoCompact: { contextWindow: 128_000, threshold: 0.8 },
      sandboxConfig: settings.sandbox,
      // In headless mode there's no human to ask: auto-deny anything that
      // would normally need approval. Users wanting auto-yes should pass
      // --mode dontAsk or --mode bypassPermissions (gated by trust).
      approval: async () => false,
      onEvent,
    });

    if (aborted) {
      exitCode = 5;
    } else if (result.stopReason === 'max_turns') {
      exitCode = 4;
    } else if (result.stopReason === 'error') {
      exitCode = 3;
    } else {
      exitCode = 0;
    }

    if (outputFormat === 'json') {
      const finalText = result.history
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content)
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('');
      output.write(
        JSON.stringify(
          {
            text: finalText,
            stopReason: result.stopReason,
            usage: result.usage,
            events: collectedEvents,
            exitCode,
          },
          null,
          2,
        ) + '\n',
      );
    } else if (outputFormat === 'text') {
      output.write('\n');
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    if (outputFormat === 'json') {
      output.write(JSON.stringify({ error: msg, exitCode: 3 }) + '\n');
    } else {
      errOutput.write(`Error: ${msg}\n`);
    }
    exitCode = 3;
  } finally {
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigintHandler);
    if (mcpServers.length > 0) await closeAllMcpServers(mcpServers);
  }

  return exitCode;
}

function formatEventText(out: Writable, e: AgentEvent): void {
  switch (e.type) {
    case 'text_delta':
      out.write(e.text);
      return;
    case 'tool_use':
      out.write(`\n  ● ${e.name}  ${formatToolInput(e.input)}\n`);
      return;
    case 'tool_result':
      if (e.result.isError) out.write(`    ✕ ${truncate(e.result.content, 200)}\n`);
      else out.write(`    ✓ ${truncate(e.result.content, 200)}\n`);
      return;
    case 'error':
      out.write(`\n  ✕ ${e.error}\n`);
      return;
    case 'usage':
    case 'thinking_delta':
    case 'turn_complete':
      return;
  }
}

function formatToolInput(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path', 'url', 'query']) {
    const v = input[key];
    if (typeof v === 'string') return v;
  }
  return JSON.stringify(input).slice(0, 80);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function resolveBuiltinSkillsDir(): Promise<string | undefined> {
  const { createRequire } = await import('node:module');
  const require_ = createRequire(import.meta.url);
  try {
    const corePkg = require_.resolve('@deepcode/core/package.json');
    const path = await import('node:path');
    const fsp = await import('node:fs/promises');
    const skillsDir = path.join(path.dirname(corePkg), 'skills');
    try {
      await fsp.access(skillsDir);
      return skillsDir;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}
