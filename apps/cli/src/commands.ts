// CLI slash commands — pure functions over a session context.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6 (30+ commands; M2 ships a core subset)

import type {
  DeepCodeSettings,
  McpClientHandle,
  Provider,
  SessionManager,
  SessionMeta,
  StoredMessage,
} from '@deepcode/core';
import { contextWindowFor, redact, type Credentials } from '@deepcode/core';

export interface SessionContext {
  cwd: string;
  model: string;
  mode: string;
  effort: string;
  settings: DeepCodeSettings;
  creds: Credentials;
  sessionId: string;
  sessions: SessionManager;
  usage: { inputTokens: number; outputTokens: number; reasoningTokens: number };
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

// Effort tier UI metadata — surfaced by `/effort` with no args.
const EFFORT_TIERS: Array<{
  name: string;
  maxTokens: number;
  temperature: number;
  use: string;
}> = [
  { name: 'low', maxTokens: 1024, temperature: 0.0, use: 'Quick targeted fixes. Cheap.' },
  { name: 'medium', maxTokens: 4096, temperature: 0.3, use: 'Default. Most tasks.' },
  { name: 'high', maxTokens: 8192, temperature: 0.5, use: 'Multi-step refactors.' },
  { name: 'xhigh', maxTokens: 16384, temperature: 0.6, use: 'Plans, architecture decisions.' },
  { name: 'max', maxTokens: 32768, temperature: 0.7, use: 'Open-ended exploration. Burns tokens.' },
];

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
    // Pricing per docs/design/effort-levels.md §2.4
    const inputYuan = (ctx.usage.inputTokens / 1_000_000) * 1.0;
    const outputYuan =
      ctx.model === 'deepseek-reasoner'
        ? (ctx.usage.outputTokens / 1_000_000) * 16.0
        : (ctx.usage.outputTokens / 1_000_000) * 2.0;
    const reasoningYuan =
      ctx.model === 'deepseek-reasoner' ? (ctx.usage.reasoningTokens / 1_000_000) * 4.0 : 0;
    const total = inputYuan + outputYuan + reasoningYuan;
    return [
      `Tokens — in: ${ctx.usage.inputTokens.toLocaleString()}, out: ${ctx.usage.outputTokens.toLocaleString()}, reasoning: ${ctx.usage.reasoningTokens.toLocaleString()}`,
      `Estimate — input: ¥${inputYuan.toFixed(4)}, output: ¥${outputYuan.toFixed(4)}, reasoning: ¥${reasoningYuan.toFixed(4)}`,
      `Total this session: ¥${total.toFixed(4)}`,
    ];
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
  description: 'Show resolved settings (read-only in M2).',
  run(_args, ctx) {
    const out = ['Current settings (merged):'];
    out.push(JSON.stringify(ctx.settings, null, 2).split('\n').slice(0, 40).join('\n'));
    out.push('');
    out.push('Edit ~/.deepcode/settings.json (user) or .deepcode/settings.json (project).');
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
  description: 'List recent sessions.',
  async run(_args, ctx) {
    const sessions = await ctx.sessions.list();
    if (sessions.length === 0) return ['No previous sessions.'];
    const top = sessions.slice(0, 10);
    return [
      'Recent sessions (top 10):',
      ...top.map(
        (s, i) => `  ${String(i + 1).padStart(2)}. ${s.id}  ${s.title ?? s.cwd}  (${s.updatedAt})`,
      ),
      '',
      'To resume: deepcode --resume <id> (M2 picker in next iteration).',
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
