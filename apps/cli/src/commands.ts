// CLI slash commands — pure functions over a session context.
// Spec: docs/DEVELOPMENT_PLAN.md §3.6 (30+ commands; M2 ships a core subset)

import type {
  DeepCodeSettings,
  McpClientHandle,
  SessionManager,
  SessionMeta,
} from '@deepcode/core';
import { redact, type Credentials } from '@deepcode/core';

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

export const EffortCommand: SlashCommand = {
  name: '/effort',
  description: 'Set effort tier: /effort low|medium|high|xhigh|max',
  run(args, ctx) {
    const valid = ['low', 'medium', 'high', 'xhigh', 'max'];
    if (args.length === 0) return [`Current effort: ${ctx.effort}`];
    const next = args[0]!;
    if (!valid.includes(next)) return [`Unknown effort "${next}". Valid: ${valid.join(' | ')}`];
    ctx.effort = next;
    return [`Effort switched to ${next}.`];
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
    const ctxMax = 128_000;
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
  description: 'Write a starter DEEPCODE.md (M3 makes this fully interactive).',
  run(_args, ctx) {
    return [
      `Will write a starter DEEPCODE.md at ${ctx.cwd}/DEEPCODE.md.`,
      `(M2 stub — full multi-phase interactive flow lands in M3 per DEVELOPMENT_PLAN.md §3.6.)`,
    ];
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
  description: 'Show active TODO list (M3 wires TodoWrite tool).',
  run() {
    return ['No active todos — TodoWrite tool ships in M3.'];
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
