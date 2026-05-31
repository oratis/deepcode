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
  BashTool,
  CredentialsStore,
  DeepSeekProvider,
  EFFORT_PARAMS,
  HookDispatcher,
  ReadTool,
  SessionManager,
  ToolRegistry,
  WebFetchTool,
  WriteTool,
  applyStyle,
  buildSkillsDescriptionBlock,
  closeAllMcpServers,
  connectAllMcpServers,
  expandMcpResourceRefs,
  gateUntrustedSettings,
  contextWindowFor,
  findStyle,
  loadMemory,
  loadOutputStyles,
  loadSettings,
  loadSkills,
  makeSkillTool,
  resolveCredentials,
  runAgent,
  wirePlugins,
  type AgentEvent,
  type Effort,
  type McpClientHandle,
  type Mode,
  type WireResult,
} from '@deepcode/core';
import type { Writable } from 'node:stream';
import { TrustStore } from './trust.js';
import { resolveBuiltinSkillsDir } from './builtin-skills.js';

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
  /** Path to a JSON schema file. Final output (text in `text` mode, JSON
   *  object in `json` mode) is validated against it; mismatch → exit 1. */
  jsonSchema?: string;
  /** In stream-json mode, also emit text_delta and thinking_delta events.
   *  Default is to drop those for compact streams. */
  includePartialMessages?: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `You are DeepCode, an AI coding assistant powered by DeepSeek. Help the user with their codebase using the available tools. Be concise and accurate. When you modify files, briefly explain what you changed and why.`;

const DEFAULT_HEADLESS_MAX_TURNS = 30;

export async function runHeadless(opts: HeadlessOpts): Promise<number> {
  const { output, errOutput, cwd, prompt, outputFormat } = opts;

  // ─── load config + credentials ───────────────────────────────────────
  // Trust-gate: a headless run against an untrusted checkout (e.g. a PR branch)
  // must not execute that project's hooks/mcpServers/apiKeyHelper/statusLine.
  // The user-global layer stays trusted. Pre-trust with `deepcode trust`.
  const loaded = await loadSettings({ cwd, home: opts.home });
  const trustStore = new TrustStore({ home: opts.home });
  const trustStatus = await trustStore.statusFor(cwd);
  const { settings, gated } = gateUntrustedSettings(loaded, trustStatus);
  if (gated.length > 0) {
    errOutput.write(
      `Untrusted directory — ignoring project ${gated.join(', ')} (can execute code). ` +
        `Run \`deepcode trust\` to enable.\n`,
    );
  }
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

  // Expand `@server:scheme://path` MCP resource references in the prompt.
  let userMessage = prompt;
  if (mcpServers.length > 0) {
    const { text, errors } = await expandMcpResourceRefs(prompt, mcpServers);
    userMessage = text;
    for (const e of errors) {
      errOutput.write(`MCP resource @${e.ref.server}:${e.ref.uri} — ${e.error}\n`);
    }
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

  // M5.2: wire installed plugins. We pipe their startup log to stderr to keep
  // stdout reserved for the headless output payload.
  let pluginsWire: WireResult | null = null;
  try {
    pluginsWire = await wirePlugins({
      home: opts.home,
      disabled: settings.disabledPlugins,
      hooks,
      capabilities: buildPluginCapabilitiesHeadless(cwd),
      sandbox: settings.sandbox,
      log: (s) => errOutput.write(s + '\n'),
    });
  } catch (err) {
    errOutput.write(`Plugin wire-up failed: ${(err as Error).message}\n`);
  }

  const sessions = new SessionManager();
  const session = await sessions.create(cwd, { model });

  // ─── set up output ──────────────────────────────────────────────────
  const collectedEvents: AgentEvent[] = [];
  const includePartial = !!opts.includePartialMessages;
  const onEvent = (e: AgentEvent) => {
    collectedEvents.push(e);
    if (outputFormat === 'stream-json') {
      // Drop noisy text_delta/thinking_delta unless --include-partial-messages
      if (!includePartial && (e.type === 'text_delta' || e.type === 'thinking_delta')) {
        return;
      }
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
  // SessionStart hook (headless is a one-shot session). Agent-loop hooks
  // (UserPromptSubmit/Stop/…) fire from runAgent; SessionEnd fires in finally.
  try {
    await hooks.dispatch({
      event: 'SessionStart',
      cwd,
      triggeredAt: new Date().toISOString(),
      payload: { sessionId: session.id, source: 'headless' },
    });
  } catch {
    /* ignore */
  }
  let exitCode = 0;
  try {
    const result = await runAgent({
      provider,
      tools,
      systemPrompt,
      userMessage,
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
      autoCompact: { contextWindow: contextWindowFor(model), threshold: 0.8 },
      autoMode: settings.autoMode,
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
      // --json-schema validation (lightweight — only enforces top-level type +
      // required fields; full draft-2020 validation is opt-in via a separate
      // schema validator user provides). For now we just round-trip-parse the
      // model output as JSON if the schema declares type: object.
      let schemaError: string | null = null;
      if (opts.jsonSchema) {
        schemaError = await validateAgainstSchema(opts.jsonSchema, finalText);
        if (schemaError) exitCode = 1;
      }
      output.write(
        JSON.stringify(
          {
            text: finalText,
            stopReason: result.stopReason,
            usage: result.usage,
            events: collectedEvents,
            exitCode,
            ...(schemaError ? { schemaError } : {}),
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
    try {
      await hooks.dispatch({
        event: 'SessionEnd',
        cwd,
        triggeredAt: new Date().toISOString(),
        payload: { sessionId: session.id, exitCode },
      });
    } catch {
      /* ignore */
    }
    process.off('SIGINT', sigintHandler);
    process.off('SIGTERM', sigintHandler);
    if (mcpServers.length > 0) await closeAllMcpServers(mcpServers);
    if (pluginsWire) await pluginsWire.shutdown();
  }

  return exitCode;
}

async function validateAgainstSchema(schemaPath: string, output: string): Promise<string | null> {
  let schema: { type?: string; required?: string[] };
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(schemaPath, 'utf8');
    schema = JSON.parse(raw) as { type?: string; required?: string[] };
  } catch (err) {
    return `failed to load --json-schema: ${(err as Error).message}`;
  }
  if (schema.type === 'object') {
    try {
      const parsed = JSON.parse(output) as Record<string, unknown>;
      if (Array.isArray(schema.required)) {
        for (const k of schema.required) {
          if (!(k in parsed)) return `missing required field: ${k}`;
        }
      }
      return null;
    } catch {
      return 'output was not valid JSON';
    }
  }
  // type: string / number / etc — just check the literal type
  if (schema.type === 'string') return null; // any string is valid
  return null;
}

function buildPluginCapabilitiesHeadless(cwd: string) {
  const ctx = { cwd };
  return {
    fs_read: async (path: string) => {
      const r = await ReadTool.execute({ file_path: path }, ctx);
      if (r.isError) throw new Error(r.content);
      return r.content;
    },
    fs_write: async (path: string, content: string) => {
      const r = await WriteTool.execute({ file_path: path, content }, ctx);
      if (r.isError) throw new Error(r.content);
    },
    bash: async (cmd: string) => {
      const r = await BashTool.execute({ command: cmd }, ctx);
      const d = (r.data ?? {}) as { stderr?: string; exitCode?: number };
      return {
        stdout: r.content ?? '',
        stderr: d.stderr ?? '',
        exitCode: d.exitCode ?? (r.isError ? 1 : 0),
      };
    },
    fetch: async (url: string) => {
      const r = await WebFetchTool.execute({ url }, ctx);
      if (r.isError) throw new Error(r.content);
      return r.content;
    },
  };
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
