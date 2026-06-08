// CLI slash commands — pure functions over a session context.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6 (30+ commands; M2 ships a core subset)

import type {
  ContentBlock,
  CredentialsStore,
  DeepCodeSettings,
  McpClientHandle,
  Provider,
  SessionManager,
  SessionMeta,
  StoredMessage,
  TaskManager,
} from '@deepcode/core';
import {
  contextWindowFor,
  estimateCost,
  redact,
  writeSettings,
  EFFORT_PARAMS,
  VERSION,
  type Credentials,
  type Effort,
} from '@deepcode/core';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Environment for spawning git: strips inherited GIT_* (e.g. a GIT_DIR leaked
 *  from a parent git hook) so the call targets `cwd`, not the hook's repo. */
function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  return env;
}

/** Run a git subcommand in `cwd`, never throwing. */
async function runGit(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      env: gitEnv(),
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? 'git failed' };
  }
}

/** Run a `gh` (GitHub CLI) subcommand in `cwd`, never throwing. `code` is the
 *  spawn errno (e.g. 'ENOENT' when gh isn't installed). */
async function runGh(
  cwd: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string; code?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('gh', args, {
      cwd,
      env: gitEnv(),
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: string };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? 'gh failed',
      code: e.code,
    };
  }
}

/** PR comments payload from `gh pr view --json`. */
interface PrCommentsData {
  number: number;
  title: string;
  comments?: Array<{ author?: { login?: string }; body?: string; createdAt?: string }>;
}

/** Render the `gh pr view` comments JSON into display lines (pure — unit-tested). */
export function formatPrComments(data: PrCommentsData): string[] {
  const comments = data.comments ?? [];
  if (comments.length === 0) {
    return [`PR #${data.number} — ${data.title}`, '', 'No comments yet.'];
  }
  const lines: string[] = [
    `PR #${data.number} — ${data.title}  (${comments.length} comment${comments.length === 1 ? '' : 's'})`,
    '',
  ];
  for (const c of comments) {
    const who = c.author?.login ? `@${c.author.login}` : '(unknown)';
    const when = c.createdAt ? ` · ${c.createdAt.slice(0, 10)}` : '';
    lines.push(`${who}${when}`);
    for (const ln of (c.body ?? '').trim().split('\n')) lines.push(`  ${ln}`);
    lines.push('');
  }
  return lines;
}

/** Set a possibly-dotted key path on an object, creating intermediate objects. */
function setDeep(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    if (typeof o[k] !== 'object' || o[k] === null || Array.isArray(o[k])) o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[keys[keys.length - 1]!] = value;
}

export interface SessionContext {
  cwd: string;
  model: string;
  mode: string;
  effort: string;
  settings: DeepCodeSettings;
  creds: Credentials;
  /** Credentials store (REPL-injected) — backs /login and /logout. */
  credsStore?: CredentialsStore;
  /** User settings.json path (REPL-injected, honors --home) — backs /config set. */
  userSettingsPath?: string;
  sessionId: string;
  sessions: SessionManager;
  usage: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheReadTokens: number;
  };
  /** Set true to terminate the REPL after this command. */
  exitRequested?: boolean;
  /** Replace history entirely (used by /clear, /resume). */
  clearHistory?: boolean;
  /** Connected MCP server handles (M3c). */
  mcpServers?: McpClientHandle[];
  /** MCP servers that failed to connect on startup (M3c). */
  mcpErrors?: Array<{ serverName: string; error: string }>;
  /** Plugins that successfully wired up (M5.2). */
  wiredPlugins?: Array<{
    name: string;
    version: string;
    contributedHookEvents: string[];
  }>;
  /** Plugin discover/wire warnings (hash drift, spawn failure). */
  pluginWarnings?: string[];
  /**
   * Optional initFlow callback — wired by REPL bootstrap so the /init slash
   * command can drive a multi-phase interactive flow (explore → propose →
   * approve → write). Returns the path written, or null if user cancelled.
   */
  initFlow?: () => Promise<string | null>;
  /** Current conversation history — REPL refreshes this before each command call. */
  history?: StoredMessage[];
  /** Provider for commands that need to call the LLM (e.g. /rewind summarize). */
  provider?: Provider;
  /** Set by /rewind to request history replacement. REPL applies after run. */
  newHistory?: StoredMessage[];
  /** Session-scoped background-task manager (REPL-injected) — backs /tasks and
   *  /background. Same instance the agent loop uses, so tasks the agent starts
   *  are visible here and vice-versa. */
  tasks?: TaskManager;
}

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  /** Returns the lines to print after the command runs (or empty array). */
  run(args: string[], ctx: SessionContext): Promise<string[]> | string[];
}

// ──────────────────────────────────────────────────────────────────────────
// Built-in commands (M2 subset of the 30+ planned)
// ──────────────────────────────────────────────────────────────────────────

export const HelpCommand: SlashCommand = {
  name: '/help',
  aliases: ['/?'],
  description: 'Show available commands.',
  run() {
    const lines = ['Available commands:'];
    for (const cmd of BUILTIN_COMMANDS) {
      const aliases = cmd.aliases?.length ? `  (${cmd.aliases.join(', ')})` : '';
      lines.push(`  ${cmd.name.padEnd(12)} ${cmd.description}${aliases}`);
    }
    lines.push('');
    lines.push("Type your message to chat. Use '@' for files, '/' for commands, '#' to remember.");
    lines.push('Press Ctrl+C twice to exit.');
    return lines;
  },
};

export const ClearCommand: SlashCommand = {
  name: '/clear',
  description: 'Clear conversation history (keeps session ID).',
  run(_args, ctx) {
    ctx.clearHistory = true;
    return ['Conversation history cleared.'];
  },
};

export const ExitCommand: SlashCommand = {
  name: '/exit',
  aliases: ['/quit'],
  description: 'Exit DeepCode.',
  run(_args, ctx) {
    ctx.exitRequested = true;
    return ['Bye.'];
  },
};

export const StatusCommand: SlashCommand = {
  name: '/status',
  aliases: ['/doctor'],
  description: 'Show session + environment info.',
  async run(_args, ctx) {
    const sessionMetas: SessionMeta[] = await ctx.sessions.list();
    return [
      `Session   : ${ctx.sessionId}`,
      `CWD       : ${ctx.cwd}`,
      `Model     : ${ctx.model}`,
      `Mode      : ${ctx.mode}`,
      `Effort    : ${ctx.effort}`,
      `API key   : ${redact(ctx.creds.apiKey ?? ctx.creds.authToken)}`,
      `Base URL  : ${ctx.creds.baseURL ?? 'https://api.deepseek.com/v1'}`,
      `Sessions  : ${sessionMetas.length} total`,
      ``,
      `Usage this session: ${ctx.usage.inputTokens} in / ${ctx.usage.outputTokens} out / ${ctx.usage.reasoningTokens} reasoning`,
    ];
  },
};

export const ModelCommand: SlashCommand = {
  name: '/model',
  description: 'Switch model: /model deepseek-chat | deepseek-reasoner',
  run(args, ctx) {
    if (args.length === 0) return [`Current model: ${ctx.model}`];
    const next = args[0]!;
    if (next !== 'deepseek-chat' && next !== 'deepseek-reasoner') {
      return [`Unknown model "${next}". Valid: deepseek-chat | deepseek-reasoner`];
    }
    ctx.model = next;
    return [`Model switched to ${next}.`];
  },
};

export const ModeCommand: SlashCommand = {
  name: '/mode',
  description: 'Switch mode: /mode default|acceptEdits|plan|auto|dontAsk|bypassPermissions',
  run(args, ctx) {
    const valid = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
    if (args.length === 0) return [`Current mode: ${ctx.mode}`];
    const next = args[0]!;
    if (!valid.includes(next)) return [`Unknown mode "${next}". Valid: ${valid.join(' | ')}`];
    ctx.mode = next;
    return [`Mode switched to ${next}.`];
  },
};

// Effort tier UI metadata surfaced by `/effort` with no args.
// why: the maxTokens/temperature numbers are NOT defined here — they are read
// from EFFORT_PARAMS in @deepcode/core, the single source of truth the REPL and
// headless paths actually send to the provider. A divergent hardcoded table
// here previously told users "max = 32768 tokens, temp 0.7" while the provider
// sent max_tokens=8192, temp=0.8 — pure misinformation. Only the human-readable
// use-case hint is CLI-local; everything quantitative is derived.
const EFFORT_ORDER: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const EFFORT_USE: Record<Effort, string> = {
  low: 'Quick targeted fixes. Cheap.',
  medium: 'Default. Most tasks.',
  high: 'Multi-step refactors.',
  xhigh: 'Plans, architecture decisions.',
  max: 'Open-ended exploration. Burns tokens.',
};

const EFFORT_TIERS: Array<{
  name: Effort;
  maxTokens: number;
  temperature: number;
  use: string;
}> = EFFORT_ORDER.map((name) => ({
  name,
  maxTokens: EFFORT_PARAMS[name].maxTokens,
  temperature: EFFORT_PARAMS[name].temperature,
  use: EFFORT_USE[name],
}));

export const EffortCommand: SlashCommand = {
  name: '/effort',
  description:
    'Set effort tier (interactive picker if no arg): /effort [low|medium|high|xhigh|max]',
  run(args, ctx) {
    if (args.length === 0) {
      // Selector UI — show the table; user picks via `/effort <name>` next turn.
      const lines = [`Current effort: ${ctx.effort}`, ''];
      lines.push('Available tiers:');
      lines.push('  Tier      maxTokens  temperature  Use case');
      for (const t of EFFORT_TIERS) {
        const marker = t.name === ctx.effort ? '●' : ' ';
        lines.push(
          `  ${marker} ${t.name.padEnd(7)} ${String(t.maxTokens).padStart(7)}  ${t.temperature.toFixed(1).padStart(11)}  ${t.use}`,
        );
      }
      lines.push('');
      lines.push('Switch with: /effort <tier>');
      return lines;
    }
    const next = args[0]!;
    const tier = EFFORT_TIERS.find((t) => t.name === next);
    if (!tier) {
      return [`Unknown effort "${next}". Valid: ${EFFORT_TIERS.map((t) => t.name).join(' | ')}`];
    }
    ctx.effort = next;
    return [
      `Effort switched to ${next}. (maxTokens=${tier.maxTokens}, temperature=${tier.temperature}, ${tier.use})`,
    ];
  },
};

export const CostCommand: SlashCommand = {
  name: '/cost',
  aliases: ['/usage'],
  description: 'Show token usage and cost estimate.',
  run(_args, ctx) {
    // Cache-aware pricing per docs/design/effort-levels.md §2.4. DeepSeek's
    // prompt caching is automatic server-side; cache-hit input tokens bill at
    // ~10% of a miss, so a stable prompt prefix across turns saves real money.
    const c = estimateCost(ctx.usage, ctx.model);
    const cacheHits = Math.min(ctx.usage.cacheReadTokens, ctx.usage.inputTokens);
    const hitPct = (c.cacheHitRate * 100).toFixed(0);
    const lines = [
      `Tokens — in: ${ctx.usage.inputTokens.toLocaleString()} (cache hits: ${cacheHits.toLocaleString()}, ${hitPct}%), out: ${ctx.usage.outputTokens.toLocaleString()}, reasoning: ${ctx.usage.reasoningTokens.toLocaleString()}`,
      `Estimate — input ¥${(c.cacheMissYuan + c.cacheHitYuan).toFixed(4)} (miss ¥${c.cacheMissYuan.toFixed(4)} + cache ¥${c.cacheHitYuan.toFixed(4)}), output ¥${c.outputYuan.toFixed(4)}, reasoning ¥${c.reasoningYuan.toFixed(4)}`,
      `Total this session: ¥${c.totalYuan.toFixed(4)}`,
    ];
    if (c.cacheSavingsYuan > 0) {
      lines.push(`Prompt cache saved ¥${c.cacheSavingsYuan.toFixed(4)} vs no caching.`);
    }
    return lines;
  },
};

export const ContextCommand: SlashCommand = {
  name: '/context',
  description: 'Show context window usage.',
  run(_args, ctx) {
    const used = ctx.usage.inputTokens + ctx.usage.outputTokens;
    const ctxMax = contextWindowFor(ctx.model);
    const pct = ((used / ctxMax) * 100).toFixed(1);
    return [
      `Context: ${used.toLocaleString()} / ${ctxMax.toLocaleString()} (${pct}%)`,
      `Next compaction threshold: ${Math.round(ctxMax * 0.8).toLocaleString()} (80%) — M3 feature`,
    ];
  },
};

export const ConfigCommand: SlashCommand = {
  name: '/config',
  description: 'Show settings, or `/config set <key> <value>` to edit (dotted keys ok).',
  async run(args, ctx) {
    if (args[0] === 'set') {
      const key = args[1]?.trim();
      const valueRaw = args.slice(2).join(' ').trim();
      if (!key || !valueRaw) {
        return [
          'Usage: /config set <key> <value>',
          '  key may be dotted (e.g. permissions.defaultMode); value is parsed as JSON, else kept as a string.',
        ];
      }
      if (!ctx.userSettingsPath) return ['(/config set is unavailable here.)'];
      let value: unknown;
      try {
        value = JSON.parse(valueRaw);
      } catch {
        value = valueRaw;
      }
      let current: Record<string, unknown> = {};
      try {
        current = JSON.parse(await readFile(ctx.userSettingsPath, 'utf8')) as Record<
          string,
          unknown
        >;
      } catch {
        /* missing/empty → start fresh */
      }
      setDeep(current, key, value);
      await writeSettings(ctx.userSettingsPath, current as DeepCodeSettings);
      return [
        `Set ${key} = ${JSON.stringify(value)}`,
        `→ ${ctx.userSettingsPath}`,
        'Applies to new sessions (model / mode / effort change live via /model, /mode, /effort).',
      ];
    }
    const out = ['Current settings (merged):'];
    out.push(JSON.stringify(ctx.settings, null, 2).split('\n').slice(0, 40).join('\n'));
    out.push('');
    out.push('Edit with `/config set <key> <value>`, or ~/.deepcode/settings.json directly.');
    return out;
  },
};

export const AddDirCommand: SlashCommand = {
  name: '/add-dir',
  description: 'Add an additional allowed directory (M3 enforced; M2 records intent).',
  run(args) {
    if (args.length === 0) return ['Usage: /add-dir <path>'];
    return [`Recorded ${args[0]} as additional allowed directory (effective in M3).`];
  },
};

export const ResumeCommand: SlashCommand = {
  name: '/resume',
  description: 'List recent sessions, or `/resume <id|number>` to switch live.',
  async run(args, ctx) {
    const sessions = await ctx.sessions.list();
    if (args[0]) {
      // Accept a full id, or a 1-based index into the recent list below.
      let id = args[0].trim();
      const n = Number(id);
      if (Number.isInteger(n) && n >= 1 && n <= sessions.length) id = sessions[n - 1]!.id;
      const loaded = await ctx.sessions.load(id);
      if (!loaded) return [`Session ${id} not found. Run /resume to list recent sessions.`];
      // Swap the live conversation (REPL applies newHistory) + the append target.
      ctx.sessionId = id;
      ctx.newHistory = loaded.messages;
      const c = loaded.messages.length;
      return [
        `↻ Switched to session ${id} (${c} message${c === 1 ? '' : 's'}).`,
        'New messages now append to this session.',
      ];
    }
    if (sessions.length === 0) return ['No previous sessions.'];
    const top = sessions.slice(0, 10);
    return [
      'Recent sessions (top 10):',
      ...top.map(
        (s, i) => `  ${String(i + 1).padStart(2)}. ${s.id}  ${s.title ?? s.cwd}  (${s.updatedAt})`,
      ),
      '',
      'Switch live with `/resume <id-or-number>`, or `deepcode --resume <id>` at launch.',
    ];
  },
};

export const InitCommand: SlashCommand = {
  name: '/init',
  description: 'Interactive: explore project, propose AGENTS.md, ask user to approve.',
  async run(_args, ctx) {
    if (!ctx.initFlow) {
      return [
        'Init flow is only available in the interactive REPL.',
        'Run `deepcode` (no args) then type /init.',
      ];
    }
    const path = await ctx.initFlow();
    if (!path) return ['Cancelled — no file written.'];
    return [`✓ Wrote ${path}.`];
  },
};

export const McpCommand: SlashCommand = {
  name: '/mcp',
  description: 'List connected MCP servers and their tools.',
  async run(_args, ctx) {
    const servers = ctx.mcpServers ?? [];
    if (servers.length === 0) {
      return [
        'No MCP servers connected.',
        '',
        'Add servers in settings.json under "mcpServers". Example:',
        '  { "mcpServers": { "filesystem": { "command": "npx",',
        '      "args": ["@modelcontextprotocol/server-filesystem", "/tmp"] } } }',
      ];
    }
    const lines = [`Connected MCP servers (${servers.length}):`];
    for (const s of servers) {
      lines.push(`  ● ${s.serverName}  ·  ${s.tools.length} tools`);
      for (const t of s.tools.slice(0, 6)) {
        lines.push(`     - ${t.name}`);
      }
      if (s.tools.length > 6) lines.push(`     … and ${s.tools.length - 6} more`);
    }
    if ((ctx.mcpErrors ?? []).length > 0) {
      lines.push('');
      lines.push('Servers that failed to connect:');
      for (const e of ctx.mcpErrors!) lines.push(`  ✕ ${e.serverName}  ${e.error}`);
    }
    return lines;
  },
};

export const TodosCommand: SlashCommand = {
  name: '/todos',
  description: 'Show active TODO list (TodoWrite tool — M3c-rest).',
  async run(_args, ctx) {
    try {
      const { readTodos } = await import('@deepcode/core');
      const path = await import('node:path');
      const dir = path.join(ctx.sessions.root, ctx.sessionId);
      const todos = await readTodos(dir);
      if (todos.length === 0) return ['No active todos.'];
      const lines = [`Todos (${todos.length}):`];
      for (const t of todos) {
        const marker = t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '●' : '○';
        const text = t.status === 'in_progress' ? t.activeForm : t.content;
        lines.push(`  ${marker} ${text}`);
      }
      return lines;
    } catch (err) {
      return [`(Error reading todos: ${(err as Error).message})`];
    }
  },
};

export const KeybindingsCommand: SlashCommand = {
  name: '/keybindings',
  description: 'List configured key bindings.',
  async run() {
    const { loadKeybindings, DEFAULT_KEYBINDINGS } = await import('@deepcode/core');
    try {
      const { config, bindings } = await loadKeybindings();
      const lines = [
        `Keybindings — enabled: ${config.enabled ? 'yes' : 'no'} · vim: ${config.vim ? 'on' : 'off'}`,
        '',
        `Defaults (${DEFAULT_KEYBINDINGS.length}):`,
      ];
      for (const b of bindings.slice(0, 20)) {
        const when = b.when ? ` [${b.when}]` : '';
        const desc = b.description ? ` — ${b.description}` : '';
        lines.push(`  ${b.key.padEnd(14)} ${b.action}${when}${desc}`);
      }
      if (bindings.length > 20) lines.push(`  ... and ${bindings.length - 20} more`);
      lines.push('');
      lines.push('Edit ~/.deepcode/keybindings.json to add custom bindings.');
      return lines;
    } catch (err) {
      return [`(Error loading keybindings: ${(err as Error).message})`];
    }
  },
};

export const VimCommand: SlashCommand = {
  name: '/vim',
  description: 'Toggle Vim mode on/off (persisted to ~/.deepcode/keybindings.json).',
  async run() {
    const { loadKeybindings, saveKeybindings } = await import('@deepcode/core');
    try {
      const { config } = await loadKeybindings();
      const next = !config.vim;
      await saveKeybindings({ ...config, vim: next });
      return [
        `Vim mode is now ${next ? 'ON' : 'OFF'}.`,
        next
          ? 'Press Esc to enter NORMAL mode; press i / a / v to navigate.'
          : 'Emacs-style bindings are active. Run /vim again to re-enable.',
      ];
    } catch (err) {
      return [`(Error toggling vim: ${(err as Error).message})`];
    }
  },
};

export const PluginsCommand: SlashCommand = {
  name: '/plugins',
  description: 'List wired plugins and what they contribute.',
  run(_args, ctx) {
    const plugins = ctx.wiredPlugins ?? [];
    const warnings = ctx.pluginWarnings ?? [];
    const lines: string[] = [];
    if (plugins.length === 0 && warnings.length === 0) {
      lines.push('No plugins installed.');
      lines.push('');
      lines.push('Install with:  deepcode plugin install <path>');
      lines.push('(M5 = manifest + hash pin; M5.1 = subprocess + RPC; M5.2 = live wire-up.)');
      return lines;
    }
    if (plugins.length > 0) {
      lines.push(`Active plugins (${plugins.length}):`);
      for (const p of plugins) {
        const events = p.contributedHookEvents.length
          ? `  hooks: ${p.contributedHookEvents.join(', ')}`
          : '';
        lines.push(`  ● ${p.name}@${p.version}${events}`);
      }
    }
    if (warnings.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`Warnings:`);
      for (const w of warnings) lines.push(`  ⚠ ${w}`);
    }
    return lines;
  },
};

export const RewindCommand: SlashCommand = {
  name: '/rewind',
  description:
    'List file snapshots and roll back (5 ops): /rewind [<seq> code|conversation|both|summarize-from|summarize-up-to]',
  async run(args, ctx) {
    const { listSnapshots, restoreSnapshot, compact } = await import('@deepcode/core');
    const sessionsRoot = ctx.sessions.root;
    const snaps = await listSnapshots({ sessionsRoot, sessionId: ctx.sessionId });

    if (snaps.length === 0) {
      return [
        'No snapshots in this session yet.',
        'Snapshots are captured automatically before Edit / Write (per file) and Bash (git checkpoint) tool calls.',
      ];
    }

    // No args → list snapshots in reverse chrono so the latest is at top.
    if (args.length === 0) {
      const lines = [`Snapshots (${snaps.length}):`, ''];
      const top = [...snaps].reverse().slice(0, 20);
      for (const s of top) {
        const when = s.capturedAt.slice(11, 19); // HH:MM:SS
        const file = trimMiddle(s.filePath, 50);
        lines.push(`  #${String(s.seq).padStart(3)}  ${when}  ${s.reason.padEnd(10)} ${file}`);
      }
      if (snaps.length > 20) lines.push(`  ... and ${snaps.length - 20} older`);
      lines.push('');
      lines.push('Rewind: /rewind <seq> <action>');
      lines.push('Actions:');
      lines.push('  code             — restore the file from this snapshot');
      lines.push('  conversation     — trim history to before this snapshot');
      lines.push('  both             — code + conversation');
      lines.push('  summarize-from   — keep history up to here; summarize the rest');
      lines.push('  summarize-up-to  — summarize history up to here; keep the rest');
      return lines;
    }

    const seqArg = Number.parseInt(args[0] ?? '', 10);
    if (!Number.isFinite(seqArg)) {
      return [`Bad seq "${args[0]}". Run /rewind to list snapshots.`];
    }
    const target = snaps.find((s) => s.seq === seqArg);
    if (!target) {
      return [`No snapshot with seq #${seqArg}. Valid: ${snaps.map((s) => s.seq).join(', ')}`];
    }

    const action = (args[1] ?? 'code').toLowerCase();
    const cutoffMs = Date.parse(target.capturedAt);
    const currentHistory = ctx.history ?? [];

    switch (action) {
      case 'code': {
        const restored = await restoreSnapshot(target);
        return [restoreCodeMessage(target, restored)];
      }
      case 'conversation': {
        const kept = trimHistoryBefore(currentHistory, cutoffMs);
        ctx.newHistory = kept;
        return [
          `✓ Rewound conversation to snapshot #${target.seq} (kept ${kept.length} of ${currentHistory.length} messages).`,
        ];
      }
      case 'both': {
        const restored = await restoreSnapshot(target);
        const kept = trimHistoryBefore(currentHistory, cutoffMs);
        ctx.newHistory = kept;
        return [
          restoreCodeMessage(target, restored),
          `✓ Rewound conversation (kept ${kept.length} of ${currentHistory.length} messages).`,
        ];
      }
      case 'summarize-from': {
        if (!ctx.provider)
          return ['(/rewind summarize-from requires a provider — none configured.)'];
        const kept = trimHistoryBefore(currentHistory, cutoffMs);
        const tail = currentHistory.slice(kept.length);
        if (tail.length === 0) {
          return [`Nothing after snapshot #${target.seq} to summarize.`];
        }
        const result = await compact(tail, { provider: ctx.provider });
        // New history: head (verbatim) + the compacted tail
        ctx.newHistory = [...kept, ...result.history];
        return [
          `✓ Summarized ${tail.length} messages after snapshot #${target.seq} → ${result.history.length} kept.`,
        ];
      }
      case 'summarize-up-to': {
        if (!ctx.provider)
          return ['(/rewind summarize-up-to requires a provider — none configured.)'];
        const head = trimHistoryBefore(currentHistory, cutoffMs);
        const tail = currentHistory.slice(head.length);
        if (head.length === 0) {
          return [`Nothing before snapshot #${target.seq} to summarize.`];
        }
        const result = await compact(head, { provider: ctx.provider });
        // New history: compacted head + tail (verbatim)
        ctx.newHistory = [...result.history, ...tail];
        return [
          `✓ Summarized ${head.length} messages up to snapshot #${target.seq} → ${result.history.length} kept.`,
        ];
      }
      default:
        return [
          `Unknown action "${action}".`,
          'Valid: code | conversation | both | summarize-from | summarize-up-to',
        ];
    }
  },
};

/** Keep messages with timestamp < cutoffMs. Falls back to a simple length-based
 *  heuristic if messages don't carry timestamps. */
function trimHistoryBefore(history: StoredMessage[], cutoffMs: number): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const msg of history) {
    const ts = msg.timestamp ? Date.parse(msg.timestamp) : NaN;
    if (Number.isFinite(ts) && ts < cutoffMs) {
      out.push(msg);
    } else if (!Number.isFinite(ts)) {
      // No timestamp: include — better to over-keep than to drop a turn the
      // user didn't intend to lose. The conversation can be re-trimmed.
      out.push(msg);
    }
  }
  return out;
}

function trimMiddle(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  const keep = Math.floor((maxLen - 1) / 2);
  return s.slice(0, keep) + '…' + s.slice(s.length - keep);
}

/** Human-readable result line for a `/rewind … code` restore. */
function restoreCodeMessage(
  target: { kind?: string; filePath: string; seq: number },
  restored: string[],
): string {
  if (target.kind === 'git') {
    if (restored.length === 0) {
      return `✓ Checkpoint #${target.seq}: nothing to revert (no tracked changes since).`;
    }
    const shown = restored.slice(0, 4).join(', ');
    const more = restored.length > 4 ? ` (+${restored.length - 4} more)` : '';
    return `✓ Reverted ${restored.length} file(s) to git checkpoint #${target.seq}: ${shown}${more}`;
  }
  return `✓ Restored ${target.filePath} from snapshot #${target.seq}`;
}

export const HooksCommand: SlashCommand = {
  name: '/hooks',
  description: 'List hooks configured in settings.json.',
  run(_args, ctx) {
    const hooks = ctx.settings.hooks ?? {};
    const events = Object.keys(hooks);
    if (events.length === 0) {
      return ['No hooks configured.', '', 'Add them in settings.json under "hooks".'];
    }
    const lines = ['Configured hooks:'];
    for (const event of events) {
      const matchers = hooks[event as keyof typeof hooks] ?? [];
      lines.push(`  ${event}:`);
      for (const m of matchers) {
        const match = m.matcher ? ` (match: ${m.matcher})` : '';
        const types = m.hooks.map((h) => h.type).join(', ');
        lines.push(`     - ${types}${match}`);
      }
    }
    return lines;
  },
};

export const PermissionsCommand: SlashCommand = {
  name: '/permissions',
  description: 'Show permission rules from settings.json.',
  run(_args, ctx) {
    const p = ctx.settings.permissions;
    if (!p) return ['No permission rules configured (DeepCode asks before risky tools).'];
    const lines = ['Permissions:'];
    if (p.defaultMode) lines.push(`  default mode: ${p.defaultMode}`);
    for (const kind of ['allow', 'ask', 'deny'] as const) {
      const rules = p[kind] ?? [];
      if (rules.length > 0) {
        lines.push(`  ${kind}:`);
        for (const r of rules) lines.push(`     ${r}`);
      }
    }
    if ((p.additionalDirectories ?? []).length > 0) {
      lines.push(`  additionalDirectories: ${p.additionalDirectories!.join(', ')}`);
    }
    return lines.length === 1 ? ['Permissions: (no rules; default mode only)'] : lines;
  },
};

export const AgentsCommand: SlashCommand = {
  name: '/agents',
  description: 'List available sub-agents (.deepcode/agents/*.md).',
  async run(_args, ctx) {
    try {
      const { loadSubAgents } = await import('@deepcode/core');
      const agents = await loadSubAgents({ cwd: ctx.cwd });
      if (agents.length === 0) {
        return [
          'No sub-agents found.',
          'Add one as .deepcode/agents/<name>.md with a name/description frontmatter.',
        ];
      }
      const lines = [`Sub-agents (${agents.length}):`];
      for (const a of agents) {
        lines.push(
          `  ${a.qualifiedName}  [${a.source}]` +
            (a.frontmatter.description ? ` — ${a.frontmatter.description}` : ''),
        );
      }
      return lines;
    } catch (err) {
      return [`(Error loading sub-agents: ${(err as Error).message})`];
    }
  },
};

export const SkillsCommand: SlashCommand = {
  name: '/skills',
  description: 'List available skills (built-in + user + project).',
  async run(_args, ctx) {
    try {
      const { listSkills } = await import('./list-cmd.js');
      const rows = await listSkills({ cwd: ctx.cwd });
      if (rows.length === 0) return ['No skills found.'];
      const lines = [`Skills (${rows.length}):`];
      for (const s of rows) {
        lines.push(`  ${s.name}  [${s.source}]` + (s.description ? ` — ${s.description}` : ''));
      }
      return lines;
    } catch (err) {
      return [`(Error loading skills: ${(err as Error).message})`];
    }
  },
};

export const ExportCommand: SlashCommand = {
  name: '/export',
  description: 'Export the current conversation to a markdown file (/export [path]).',
  async run(args, ctx) {
    const history = ctx.history ?? [];
    if (history.length === 0) return ['Nothing to export yet.'];
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const target = args[0]
        ? path.resolve(ctx.cwd, args[0])
        : path.join(ctx.cwd, `deepcode-${ctx.sessionId}.md`);
      await fs.writeFile(target, historyToMarkdown(history), 'utf8');
      return [`✓ Exported ${history.length} messages → ${target}`];
    } catch (err) {
      return [`(Export failed: ${(err as Error).message})`];
    }
  },
};

export const CompactCommand: SlashCommand = {
  name: '/compact',
  description: 'Summarize the conversation so far to free up context.',
  async run(_args, ctx) {
    if (!ctx.provider) return ['(/compact needs a provider — none configured.)'];
    const history = ctx.history ?? [];
    if (history.length === 0) return ['Nothing to compact yet.'];
    try {
      const { compact } = await import('@deepcode/core');
      const result = await compact(history, { provider: ctx.provider });
      if (result.messagesRemoved === 0) {
        return ['Conversation is already short enough — nothing to compact.'];
      }
      ctx.newHistory = result.history;
      return [`✓ Compacted ${result.messagesRemoved} messages → ${result.history.length} kept.`];
    } catch (err) {
      return [`(Compaction failed: ${(err as Error).message})`];
    }
  },
};

/** Render a conversation as readable markdown (text + tool calls). */
function historyToMarkdown(history: StoredMessage[]): string {
  const out: string[] = ['# DeepCode conversation export', ''];
  for (const msg of history) {
    out.push(`## ${msg.role === 'user' ? 'User' : 'Assistant'}`, '');
    for (const block of msg.content) {
      if (block.type === 'text') out.push(block.text, '');
      else if (block.type === 'thinking') out.push(`> _(thinking)_ ${block.text}`, '');
      else if (block.type === 'tool_use')
        out.push(
          '```json',
          `// tool: ${block.name}`,
          JSON.stringify(block.input, null, 2),
          '```',
          '',
        );
      else if (block.type === 'tool_result')
        out.push(
          '```',
          `// result${block.is_error ? ' (error)' : ''}`,
          block.content.slice(0, 4000),
          '```',
          '',
        );
    }
  }
  return out.join('\n');
}

export const DiffCommand: SlashCommand = {
  name: '/diff',
  description: 'Show uncommitted changes in the working tree (git diff + untracked files).',
  async run(_args, ctx) {
    const inside = await runGit(ctx.cwd, ['rev-parse', '--is-inside-work-tree']);
    if (!inside.ok || inside.stdout.trim() !== 'true') {
      return ['Not a git repository (or git is unavailable) — nothing to diff.'];
    }
    const status = await runGit(ctx.cwd, ['status', '--short']);
    if (status.ok && status.stdout.trim() === '') {
      return ['Working tree clean — no uncommitted changes.'];
    }
    const lines: string[] = ['Uncommitted changes:', ''];
    if (status.stdout.trim()) {
      lines.push(...status.stdout.trimEnd().split('\n'), '');
    }
    // `diff HEAD` covers staged + unstaged edits to tracked files. It fails in a
    // repo with no commits yet (no HEAD) — that's fine, status/untracked still show.
    const diff = await runGit(ctx.cwd, ['--no-pager', 'diff', 'HEAD']);
    const MAX = 300;
    if (diff.ok && diff.stdout.trim()) {
      const diffLines = diff.stdout.split('\n');
      lines.push(...diffLines.slice(0, MAX));
      if (diffLines.length > MAX) {
        lines.push(`… (${diffLines.length - MAX} more lines — run \`git diff\` for the full diff)`);
      }
    }
    const untracked = await runGit(ctx.cwd, ['ls-files', '--others', '--exclude-standard']);
    if (untracked.ok && untracked.stdout.trim()) {
      lines.push('', 'Untracked files:');
      for (const f of untracked.stdout.trim().split('\n')) lines.push(`  ? ${f}`);
    }
    return lines;
  },
};

export const ReleaseNotesCommand: SlashCommand = {
  name: '/release-notes',
  description: 'Show the latest CHANGELOG entry.',
  async run(_args, ctx) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // Walk up from cwd looking for CHANGELOG.md (repo root may be above cwd).
    let dir = ctx.cwd;
    let changelog: string | null = null;
    for (let i = 0; i < 8; i++) {
      try {
        changelog = await fs.readFile(path.join(dir, 'CHANGELOG.md'), 'utf8');
        break;
      } catch {
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    if (!changelog) {
      return ['No CHANGELOG.md found (searched from cwd up to the filesystem root).'];
    }
    const all = changelog.split('\n');
    const firstH2 = all.findIndex((l) => l.startsWith('## '));
    if (firstH2 === -1) return all.slice(0, 40);
    const afterFirst = all.slice(firstH2 + 1);
    const nextRel = afterFirst.findIndex((l) => l.startsWith('## '));
    const end = nextRel === -1 ? all.length : firstH2 + 1 + nextRel;
    const section = all.slice(firstH2, end);
    while (section.length && section[section.length - 1]!.trim() === '') section.pop();
    return section;
  },
};

export const BugCommand: SlashCommand = {
  name: '/bug',
  aliases: ['/feedback'],
  description: 'Report a bug or give feedback (prints a prefilled GitHub issue link).',
  run(args, ctx) {
    const title = args.join(' ').trim();
    const params = new URLSearchParams();
    if (title) params.set('title', title);
    params.set(
      'body',
      `<!-- Describe the issue above. -->\n\n---\nModel: ${ctx.model} · Mode: ${ctx.mode} · Effort: ${ctx.effort}`,
    );
    return [
      'Report a bug or request a feature:',
      `  https://github.com/oratis/deepcode/issues/new?${params.toString()}`,
      '',
      'Or browse existing issues: https://github.com/oratis/deepcode/issues',
    ];
  },
};

export const RecapCommand: SlashCommand = {
  name: '/recap',
  description: 'Summarize the conversation so far.',
  async run(_args, ctx) {
    if (!ctx.provider) return ['(/recap requires a provider — none configured.)'];
    const history = ctx.history ?? [];
    if (history.length === 0) return ['Nothing to recap yet — the conversation is empty.'];
    const result = await ctx.provider.runTurn({
      model: ctx.model,
      systemPrompt:
        'Recap this coding session for the user: the goal, what was explored or changed ' +
        '(files, key findings), decisions made, and what is still in progress. Use short ' +
        'bullet points. No preamble.',
      tools: [],
      messages: [
        ...history,
        {
          role: 'user',
          content: [{ type: 'text', text: 'Recap where we are in this session so far.' }],
        },
      ],
    });
    const text = result.content
      .filter((b: ContentBlock) => b.type === 'text')
      .map((b: ContentBlock) => (b as { text: string }).text)
      .join('\n')
      .trim();
    return text ? text.split('\n') : ['(no recap produced)'];
  },
};

export const LoginCommand: SlashCommand = {
  name: '/login',
  description: 'Set or replace the stored DeepSeek API key.',
  async run(args, ctx) {
    if (!ctx.credsStore) return ['(/login unavailable — no credentials store.)'];
    const key = args[0]?.trim();
    if (!key) {
      const authed = !!(ctx.creds?.apiKey || ctx.creds?.authToken);
      return [
        authed ? 'Authenticated with a DeepSeek API key.' : 'Not authenticated.',
        'Usage: /login <DEEPSEEK_API_KEY>   — stores a new key (applies on next launch).',
      ];
    }
    await ctx.credsStore.save({ ...ctx.creds, apiKey: key });
    return [
      'Saved a new DeepSeek API key.',
      'Restart `deepcode` for it to take effect in a new session.',
    ];
  },
};

export const LogoutCommand: SlashCommand = {
  name: '/logout',
  description: 'Clear stored DeepSeek credentials and exit.',
  async run(_args, ctx) {
    if (!ctx.credsStore) return ['(/logout unavailable — no credentials store.)'];
    await ctx.credsStore.clear();
    ctx.exitRequested = true;
    return [
      'Logged out — stored DeepSeek credentials cleared.',
      'Run `deepcode` to sign in again.',
    ];
  },
};

export const PrCommentsCommand: SlashCommand = {
  name: '/pr_comments',
  description: "Show comments on the current branch's pull request (needs gh).",
  async run(_args, ctx) {
    const res = await runGh(ctx.cwd, ['pr', 'view', '--json', 'number,title,comments']);
    if (!res.ok) {
      if (res.code === 'ENOENT') {
        return ['/pr_comments needs the GitHub CLI (`gh`). Install: https://cli.github.com'];
      }
      const err = res.stderr.trim();
      if (/no (pull requests|default remote|open)|not found|no git remotes/i.test(err)) {
        return ['No open pull request found for the current branch.'];
      }
      return [`/pr_comments failed: ${err || 'unknown error'}`];
    }
    let data: PrCommentsData;
    try {
      data = JSON.parse(res.stdout) as PrCommentsData;
    } catch {
      return ['/pr_comments: could not parse gh output.'];
    }
    return formatPrComments(data);
  },
};

export const UpgradeCommand: SlashCommand = {
  name: '/upgrade',
  description: 'Show the current version and how to update.',
  run() {
    return [
      `DeepCode CLI v${VERSION}`,
      'Update the CLI:  npm i -g deepcode-cli@latest',
      'The macOS desktop app auto-updates via GitHub Releases.',
    ];
  },
};

export const PrivacySettingsCommand: SlashCommand = {
  name: '/privacy-settings',
  description: 'Show where your data lives and what is sent to DeepSeek.',
  run(_args, ctx) {
    const base = ctx.creds?.baseURL || 'https://api.deepseek.com';
    return [
      'Privacy — DeepCode is local-first:',
      '  • Credentials: ~/.deepcode/credentials.json (chmod 600), or an OS keychain via apiKeyHelper.',
      '  • Sessions, history & snapshots: ~/.deepcode/sessions/ — local files on this machine.',
      `  • Prompts, file contents & tool output are sent to the DeepSeek API (${base}) to generate responses, handled per DeepSeek's policy.`,
      '  • Plugin / hook subprocesses run with DeepSeek credentials stripped from their env.',
      '  • Full threat model: docs/security-model.md.',
    ];
  },
};

export const BtwCommand: SlashCommand = {
  name: '/btw',
  description: 'Add a "by the way" note to the context (no agent turn fired).',
  run(args, ctx) {
    const note = args.join(' ').trim();
    if (!note) {
      return ['Usage: /btw <note> — queues a side-note the agent sees with your next message.'];
    }
    const base = ctx.history ?? [];
    ctx.newHistory = [
      ...base,
      { role: 'user', content: [{ type: 'text', text: `(By the way: ${note})` }] },
    ];
    return [`Noted — the agent will see this with your next message.`];
  },
};

export const TasksCommand: SlashCommand = {
  name: '/tasks',
  description: 'List background tasks this session, or `/tasks <id>` to show one’s output.',
  run(args, ctx) {
    if (!ctx.tasks) return ['(Background tasks are unavailable here.)'];
    // `/tasks <id>` → show that task's status + output so far.
    if (args[0]) {
      const id = args[0].trim();
      const task = ctx.tasks.get(id);
      if (!task) return [`No task "${id}". Run /tasks to list them.`];
      const out = (task.output || '').trim();
      return [
        `${task.id}  [${task.status}]  ${task.description}`,
        `  created ${task.createdAt}${task.finishedAt ? ` · finished ${task.finishedAt}` : ''}`,
        '',
        out || `(no output yet — task is ${task.status})`,
      ];
    }
    const tasks = ctx.tasks.list();
    if (tasks.length === 0) {
      return ['No background tasks yet.', 'Start one with `/background <prompt>`.'];
    }
    const lines = [`Background tasks (${tasks.length}):`];
    for (const t of tasks) lines.push(`  ${t.id}  [${t.status}]  ${t.description}`);
    lines.push('');
    lines.push('Show one with `/tasks <id>`; cancel via the agent’s TaskStop tool.');
    return lines;
  },
};

export const BackgroundCommand: SlashCommand = {
  name: '/background',
  aliases: ['/bg'],
  description: 'Run a prompt as a background sub-agent while you keep working.',
  run(args, ctx) {
    if (!ctx.tasks) return ['(Background tasks are unavailable here.)'];
    const prompt = args.join(' ').trim();
    if (!prompt) {
      return ['Usage: /background <prompt> — runs <prompt> as a background sub-agent.'];
    }
    try {
      const task = ctx.tasks.create({ description: prompt.slice(0, 60), prompt });
      return [
        `Started background task ${task.id}: “${task.description}”.`,
        'It runs while you keep chatting. Check it with `/tasks` (or `/tasks ' + task.id + '`).',
      ];
    } catch (err) {
      return [`Could not start background task: ${(err as Error).message}`];
    }
  },
};

export const BUILTIN_COMMANDS: SlashCommand[] = [
  HelpCommand,
  ClearCommand,
  ExitCommand,
  StatusCommand,
  ModelCommand,
  ModeCommand,
  EffortCommand,
  CostCommand,
  ContextCommand,
  ConfigCommand,
  AddDirCommand,
  ResumeCommand,
  InitCommand,
  McpCommand,
  TodosCommand,
  PluginsCommand,
  KeybindingsCommand,
  VimCommand,
  RewindCommand,
  HooksCommand,
  PermissionsCommand,
  AgentsCommand,
  SkillsCommand,
  ExportCommand,
  CompactCommand,
  DiffCommand,
  ReleaseNotesCommand,
  BugCommand,
  RecapCommand,
  LoginCommand,
  LogoutCommand,
  PrCommentsCommand,
  UpgradeCommand,
  PrivacySettingsCommand,
  BtwCommand,
  TasksCommand,
  BackgroundCommand,
];

// ──────────────────────────────────────────────────────────────────────────
// Registry — dispatch by name OR alias
// ──────────────────────────────────────────────────────────────────────────

export class CommandRegistry {
  private readonly byName = new Map<string, SlashCommand>();

  constructor(initial: SlashCommand[] = BUILTIN_COMMANDS) {
    for (const c of initial) this.register(c);
  }

  register(cmd: SlashCommand): void {
    this.byName.set(cmd.name, cmd);
    for (const a of cmd.aliases ?? []) this.byName.set(a, cmd);
  }

  list(): SlashCommand[] {
    return [...new Set(this.byName.values())];
  }

  match(line: string): { cmd: SlashCommand; args: string[] } | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('/')) return null;
    const parts = trimmed.split(/\s+/);
    const name = parts[0]!;
    const cmd = this.byName.get(name);
    if (!cmd) return null;
    return { cmd, args: parts.slice(1) };
  }
}
