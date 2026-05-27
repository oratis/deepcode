// CLI REPL — readline-based interactive loop.
// Spec: docs/DEVELOPMENT_PLAN.md §5

import {
  CredentialsStore,
  DeepSeekProvider,
  EFFORT_PARAMS,
  HookDispatcher,
  SessionManager,
  ToolRegistry,
  applyStyle,
  buildSkillsDescriptionBlock,
  findStyle,
  loadMemory,
  loadOutputStyles,
  loadSettings,
  loadSkills,
  makeSkillTool,
  resolveCredentials,
  runAgent,
  type DeepCodeSettings,
  type Effort,
  type Mode,
  type AgentEvent,
  type StoredMessage,
} from '@deepcode/core';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { CommandRegistry, type SessionContext } from './commands.js';

export interface ReplOpts {
  input: Readable;
  output: Writable;
  cwd: string;
  /** Override $HOME for tests. */
  home?: string;
  /** Initial mode (overrides settings). */
  mode?: string;
  /** Initial model (overrides settings). */
  model?: string;
  /** Initial effort (overrides settings). */
  effort?: Effort;
}

const DEFAULT_SYSTEM_PROMPT = `You are DeepCode, an AI coding assistant powered by DeepSeek. Help the user with their codebase using the available tools (Read, Write, Edit, Bash, Grep, Glob). Be concise and accurate. When you modify files, briefly explain what you changed and why.`;

export async function startRepl(opts: ReplOpts): Promise<number> {
  const { output, cwd } = opts;

  // Load config + creds
  const loaded = await loadSettings({ cwd, home: opts.home });
  const settings: DeepCodeSettings = loaded.merged;
  const credsStore = new CredentialsStore({ home: opts.home });
  const creds = await resolveCredentials({
    store: credsStore,
    apiKeyHelper: settings.apiKeyHelper,
  });

  if (!creds.apiKey && !creds.authToken) {
    output.write(
      'No DeepSeek credentials found. Run `deepcode` (no args) to onboard, or set DEEPSEEK_API_KEY.\n',
    );
    return 1;
  }

  const model = opts.model ?? settings.model ?? 'deepseek-chat';
  const mode = (opts.mode ?? settings.permissions?.defaultMode ?? 'default') as Mode;
  const effort = opts.effort ?? settings.effortLevel ?? 'medium';
  const { maxTokens, temperature } = EFFORT_PARAMS[effort as Effort] ?? EFFORT_PARAMS.medium;

  const sessions = new SessionManager();
  const session = await sessions.create(cwd, { model });

  const provider = new DeepSeekProvider({
    apiKey: creds.apiKey ?? '',
    authToken: creds.authToken,
    baseURL: creds.baseURL ?? settings.baseURL,
  });
  const tools = new ToolRegistry();
  const commands = new CommandRegistry();

  // M5: load memory, skills, output style — assemble final system prompt
  const memory = await loadMemory({
    cwd,
    home: opts.home,
    maxBytes: (settings.memoryLoadCapKB ?? 100) * 1024,
  });
  const skills = await loadSkills({
    cwd,
    home: opts.home,
    overrides: settings.skillOverrides,
  });
  const styles = await loadOutputStyles({ cwd, home: opts.home });
  const activeStyle = findStyle(styles, settings.outputStyle ?? 'default');

  // Register Skill tool (M5)
  if (skills.length > 0) {
    tools.register(makeSkillTool(skills));
  }

  // Build the composite system prompt
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  if (memory.text) systemPrompt += '\n\n' + memory.text;
  const skillsBlock = buildSkillsDescriptionBlock(skills);
  if (skillsBlock) systemPrompt += '\n\n' + skillsBlock;
  systemPrompt = applyStyle(systemPrompt, activeStyle);

  // Hook dispatcher (M3)
  const hooks = new HookDispatcher({
    hooks: settings.hooks,
    disableAllHooks: settings.disableAllHooks,
  });

  let history: StoredMessage[] = [];
  const ctx: SessionContext = {
    cwd,
    model,
    mode,
    effort,
    settings,
    creds,
    sessionId: session.id,
    sessions,
    usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  };

  output.write(`\n  ▎ DeepCode  ·  ${ctx.model}  ·  mode: ${ctx.mode}  ·  effort: ${ctx.effort}\n`);
  output.write(`  Working in ${cwd}\n`);
  output.write(`  Type /help for commands, /exit to quit.\n\n`);

  const rl = createInterface({ input: opts.input, output, terminal: true });

  let ctrlCCount = 0;
  rl.on('SIGINT', () => {
    ctrlCCount++;
    if (ctrlCCount >= 2) {
      output.write('\nGoodbye.\n');
      rl.close();
      return;
    }
    output.write('\n(Press Ctrl+C again to exit.)\n');
    setTimeout(() => {
      ctrlCCount = 0;
    }, 2000);
  });

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question('› ');
    } catch {
      break;
    }
    ctrlCCount = 0;

    if (!userInput.trim()) continue;

    // Slash command?
    const match = commands.match(userInput);
    if (match) {
      const lines = await Promise.resolve(match.cmd.run(match.args, ctx));
      for (const line of lines) output.write(line + '\n');
      output.write('\n');
      if (ctx.clearHistory) {
        history = [];
        ctx.clearHistory = false;
      }
      if (ctx.exitRequested) break;
      continue;
    }

    // Otherwise: send to agent (with mode/permission/hooks gating from M3b)
    const result = await runAgent({
      provider,
      tools,
      systemPrompt,
      userMessage: userInput,
      history,
      model: ctx.model,
      maxTokens,
      temperature,
      cwd: ctx.cwd,
      session: { manager: sessions, id: session.id },
      mode: ctx.mode as Mode,
      permissions: settings.permissions,
      hooks,
      approval: async (toolName, _input, verdict) => {
        output.write(`\n  ⏸ Approve ${toolName}?  Reason: ${verdict.reason}\n`);
        const answer = (await rl.question('     [y]es / [n]o: ')).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
      },
      onEvent: (e: AgentEvent) => formatEvent(output, e),
    });
    history = result.history;
    ctx.usage.inputTokens += result.usage.inputTokens;
    ctx.usage.outputTokens += result.usage.outputTokens;
    ctx.usage.reasoningTokens += result.usage.reasoningTokens;
    output.write('\n');
    if (result.stopReason === 'error') {
      output.write('  ✕ Error during agent loop. Try again or /status to inspect.\n\n');
    }
  }

  rl.close();
  return 0;
}

function formatEvent(out: Writable, e: AgentEvent): void {
  switch (e.type) {
    case 'text_delta':
      out.write(e.text);
      return;
    case 'thinking_delta':
      return;
    case 'tool_use':
      out.write(`\n  ● ${e.name}  ${formatToolInput(e.input)}\n`);
      return;
    case 'tool_result':
      if (e.result.isError) out.write(`    ✕ ${truncate(e.result.content, 200)}\n`);
      else out.write(`    ✓ ${truncate(e.result.content, 200)}\n`);
      return;
    case 'usage':
      return;
    case 'error':
      out.write(`\n  ✕ ${e.error}\n`);
      return;
    case 'turn_complete':
      return;
  }
}

function formatToolInput(input: Record<string, unknown>): string {
  for (const key of ['file_path', 'command', 'pattern', 'path']) {
    const v = input[key];
    if (typeof v === 'string') return v;
  }
  return JSON.stringify(input).slice(0, 80);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
