// CLI REPL — readline-based interactive loop.
// Spec: docs/DEVELOPMENT_PLAN.md §5

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
  appendAllowMatcher,
  applyStyle,
  buildSkillsDescriptionBlock,
  closeAllMcpServers,
  connectAllMcpServers,
  expandMcpResourceRefs,
  getMcpPrompt,
  mcpPromptCommands,
  resolveMcpPromptInvocation,
  type McpElicitHandler,
  expandCommandBody,
  findCustomCommand,
  findStyle,
  installToolSearch,
  loadMemory,
  rememberFact,
  loadOutputStyles,
  loadSettings,
  gateUntrustedSettings,
  loadSkills,
  loadSlashCommands,
  contextWindowFor,
  makeSkillTool,
  resolveCredentials,
  runAgent,
  settingsPaths,
  wirePlugins,
  collectPluginContributions,
  type Effort,
  type McpClientHandle,
  type Mode,
  type AgentEvent,
  type SessionMeta,
  type StoredMessage,
  type WireResult,
} from '@deepcode/core';
import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
import { CommandRegistry, type SessionContext } from './commands.js';
import { resolveEffort } from './parse-args.js';
import { TrustStore } from './trust.js';
import { resolveBuiltinSkillsDir } from './builtin-skills.js';

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
  // M3c CLI flag wiring
  /** Replace the default system prompt entirely. */
  systemPromptOverride?: string;
  /** Append text to the system prompt. */
  appendSystemPrompt?: string;
  /** Path to a file whose contents are appended to system prompt. */
  appendSystemPromptFile?: string;
  /** Whitelist of tool names — only these are loaded. */
  allowedTools?: string[];
  /** Blacklist of tool names — these are removed. */
  disallowedTools?: string[];
  /** Cap on agent loop turns. */
  maxTurns?: number;
  // Session resume (--resume / --continue / --fork-session)
  /** `--resume` with no id → pick a session interactively. */
  resume?: boolean;
  /** `--resume <id>` → resume this specific session (append to it). */
  resumeId?: string;
  /** `--continue` → resume the most recently updated session in this cwd. */
  continueSession?: boolean;
  /** `--fork-session` → resume into a NEW session, leaving the source intact. */
  forkSession?: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `You are DeepCode, an AI coding assistant powered by DeepSeek. Help the user with their codebase using the available tools (Read, Write, Edit, Bash, Grep, Glob). Be concise and accurate. When you modify files, briefly explain what you changed and why.`;

export interface SessionResolution {
  session: SessionMeta;
  /** Prior messages to seed into the agent's context (empty for a fresh session). */
  seededHistory: StoredMessage[];
  /** One-line status to print (resumed / forked / fell back to fresh). */
  notice?: string;
}

/**
 * Decide which session a REPL launch should use:
 *   - `resumeId`        → resume that exact session (append to it)
 *   - `continueSession` → resume the most-recently-updated session in `cwd`
 *   - `forkSession`     → resume into a NEW session seeded with a copy of the
 *                         source history, leaving the original untouched
 *   - otherwise         → a fresh session
 * Pure over a `SessionManager`, so it's unit-testable without a live REPL.
 */
export async function resolveSession(
  sessions: SessionManager,
  cwd: string,
  model: string,
  opts: { resumeId?: string; continueSession?: boolean; forkSession?: boolean },
): Promise<SessionResolution> {
  let sourceId = opts.resumeId;

  if (!sourceId && opts.continueSession) {
    // Most recent session in THIS directory (list() is updatedAt-desc).
    const inCwd = (await sessions.list()).filter((m) => m.cwd === cwd);
    if (inCwd.length === 0) {
      return {
        session: await sessions.create(cwd, { model }),
        seededHistory: [],
        notice: 'No previous session in this directory — starting a new one.',
      };
    }
    sourceId = inCwd[0]!.id;
  }

  if (sourceId) {
    const loaded = await sessions.load(sourceId);
    if (!loaded) {
      return {
        session: await sessions.create(cwd, { model }),
        seededHistory: [],
        notice: `Session ${sourceId} not found — starting a new one.`,
      };
    }
    const n = loaded.messages.length;
    const plural = n === 1 ? '' : 's';
    if (opts.forkSession) {
      const forked = await sessions.create(cwd, {
        model: loaded.meta.model ?? model,
        title: loaded.meta.title,
      });
      for (const m of loaded.messages) await sessions.append(forked.id, m);
      return {
        session: forked,
        seededHistory: loaded.messages,
        notice: `⎇ Forked ${sourceId} → ${forked.id} (${n} message${plural} copied).`,
      };
    }
    return {
      session: loaded.meta,
      seededHistory: loaded.messages,
      notice: `↻ Resumed ${sourceId} (${n} message${plural}).`,
    };
  }

  return { session: await sessions.create(cwd, { model }), seededHistory: [] };
}

/**
 * Interactive `--resume` with no id: list recent sessions and read a choice.
 * Returns the chosen session id, or undefined to start fresh.
 */
async function pickSessionId(
  sessions: SessionManager,
  input: Readable,
  output: Writable,
): Promise<string | undefined> {
  const list = (await sessions.list()).slice(0, 20);
  if (list.length === 0) {
    output.write('  No sessions to resume — starting a new one.\n');
    return undefined;
  }
  output.write('\n  Resume which session?\n');
  list.forEach((m, i) => {
    const when = m.updatedAt.slice(0, 16).replace('T', ' ');
    const label = m.title?.trim() ? m.title.trim() : m.id;
    output.write(`    ${String(i + 1).padStart(2)}. ${label}  ·  ${when}\n`);
  });
  const picker = createInterface({ input, output, terminal: false });
  const answer = (await picker.question('  Number (blank = new session): ')).trim();
  picker.close();
  const n = Number(answer);
  if (!Number.isInteger(n) || n < 1 || n > list.length) {
    if (answer) output.write('  No match — starting a new one.\n');
    return undefined;
  }
  return list[n - 1]!.id;
}

export async function startRepl(opts: ReplOpts): Promise<number> {
  const { output, cwd } = opts;

  // Load config + creds. Trust-gate first: in an untrusted directory, project
  // /local hooks·mcpServers·apiKeyHelper·statusLine are stripped (the user-global
  // layer is always trusted) so a freshly-cloned repo can't run code on launch.
  const loaded = await loadSettings({ cwd, home: opts.home });
  const trustStore = new TrustStore({ home: opts.home });
  const trustStatus = await trustStore.statusFor(cwd);
  const { settings, gated } = gateUntrustedSettings(loaded, trustStatus);
  if (gated.length > 0) {
    output.write(
      `  ⚠ Untrusted directory — ignoring project ${gated.join(', ')} (can execute code).\n` +
        `    Run \`deepcode trust\` here to enable them.\n`,
    );
  }
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
  // Precedence: --effort flag → DEEPCODE_EFFORT_LEVEL env → settings.effortLevel → default.
  // Spec: docs/DEVELOPMENT_PLAN.md §3.13c. (/effort runtime switch and skill
  // frontmatter override happen later in the loop, not at construction time.)
  const effort = resolveEffort({
    cliFlag: opts.effort,
    envVar: process.env.DEEPCODE_EFFORT_LEVEL,
    settingsLevel: settings.effortLevel,
  });
  const { maxTokens, temperature } = EFFORT_PARAMS[effort as Effort] ?? EFFORT_PARAMS.medium;

  const sessions = new SessionManager();
  // Resolve which session to use: resume an explicit id, continue the most
  // recent in this cwd, fork either into a new session, or start fresh.
  let resumeId = opts.resumeId;
  if (opts.resume && !resumeId && !opts.continueSession) {
    resumeId = await pickSessionId(sessions, opts.input, output);
  }
  const resolved = await resolveSession(sessions, cwd, model, {
    resumeId,
    continueSession: opts.continueSession,
    forkSession: opts.forkSession,
  });
  const session = resolved.session;
  if (resolved.notice) output.write(`  ${resolved.notice}\n`);

  const provider = new DeepSeekProvider({
    apiKey: creds.apiKey ?? '',
    authToken: creds.authToken,
    baseURL: creds.baseURL ?? settings.baseURL,
  });
  // M3c: --allowedTools / --disallowedTools filtering BEFORE registry construction
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
  const commands = new CommandRegistry();
  // Trusted+enabled plugins contribute skills / sub-agents / commands (their
  // dirs) + MCP servers. Hooks are merged separately by wirePlugins.
  const pluginContrib = await collectPluginContributions({
    home: opts.home,
    disabled: settings.disabledPlugins,
  });
  // Custom prompt-template commands from plugin + user + project commands dirs.
  const customCommands = await loadSlashCommands({
    cwd,
    home: opts.home,
    pluginDirs: pluginContrib.dirs,
  });

  // M5: load memory, skills, output style — assemble final system prompt
  const memory = await loadMemory({
    cwd,
    home: opts.home,
    maxBytes: (settings.memoryLoadCapKB ?? 100) * 1024,
  });
  // Locate built-in skills dir (packaged with @deepcode/core)
  const builtinSkillsDir = await resolveBuiltinSkillsDir();
  const skills = await loadSkills({
    cwd,
    home: opts.home,
    builtinDir: builtinSkillsDir,
    pluginDirs: pluginContrib.dirs,
    overrides: settings.skillOverrides,
  });
  const styles = await loadOutputStyles({ cwd, home: opts.home });
  const activeStyle = findStyle(styles, settings.outputStyle ?? 'default');

  // Register Skill tool (M5)
  if (skills.length > 0) {
    tools.register(makeSkillTool(skills));
  }

  // M3c: connect MCP servers (best-effort; individual failures don't abort)
  let mcpServers: McpClientHandle[] = [];
  let mcpErrors: Array<{ serverName: string; error: string }> = [];
  // Elicitation handler holder — filled once the readline interface exists
  // (below). Until then (and there's nothing to elicit at connect time) it
  // cancels. Servers see the `elicitation` capability via this passthrough.
  const elicitHolder: { fn?: McpElicitHandler } = {};
  const elicitForServers: McpElicitHandler = (req) =>
    elicitHolder.fn ? elicitHolder.fn(req) : Promise.resolve({ action: 'cancel' });
  // Plugin-contributed MCP servers + the user's settings (user wins on a clash).
  const allMcpServers = { ...pluginContrib.mcpServers, ...(settings.mcpServers ?? {}) };
  if (Object.keys(allMcpServers).length > 0) {
    const enabled = settings.enabledMcpjsonServers;
    const disabled = settings.disabledMcpjsonServers ?? [];
    const result = await connectAllMcpServers(allMcpServers, {
      enabledOnly: enabled,
      disabled,
      elicit: elicitForServers,
    });
    mcpServers = result.handles;
    mcpErrors = result.errors;
    // Register MCP tools. Servers default to eager; a server with
    // `alwaysLoad: false` (the opt-out) has its tools deferred behind ToolSearch
    // so a large toolkit doesn't bloat the tool list — the agent loads them on
    // demand. The servers are already connected, so expand() just returns the
    // already-built handler.
    const deferredMcpTools = [];
    for (const handle of mcpServers) {
      const defer = settings.mcpServers?.[handle.serverName]?.alwaysLoad === false;
      for (const tool of handle.tools) {
        if (defer) {
          deferredMcpTools.push({
            name: tool.name,
            description: tool.definition.description,
            expand: () => tool,
          });
        } else {
          tools.register(tool);
        }
      }
    }
    const deferredNames = installToolSearch(tools, deferredMcpTools);
    if (mcpServers.length > 0) {
      const eager = mcpServers.reduce((n, h) => n + h.tools.length, 0) - deferredNames.length;
      const resourceCount = mcpServers.reduce((n, h) => n + h.resources.length, 0);
      const promptCmds = mcpPromptCommands(mcpServers);
      output.write(
        `  ⊞ MCP: ${mcpServers.length} server(s) connected (${eager} tools` +
          (deferredNames.length > 0 ? `, ${deferredNames.length} deferred behind ToolSearch` : '') +
          (resourceCount > 0 ? `, ${resourceCount} resources` : '') +
          (promptCmds.length > 0 ? `, ${promptCmds.length} prompts` : '') +
          `)\n`,
      );
      if (promptCmds.length > 0) {
        output.write(`  ⊞ MCP prompts: ${promptCmds.map((c) => c.command).join(', ')}\n`);
      }
    }
    if (mcpErrors.length > 0) {
      output.write(`  ⊞ MCP: ${mcpErrors.length} server(s) failed (see /mcp)\n`);
    }
  }

  // Build the composite system prompt
  // M3c: honor --system-prompt (replaces default) + --append-system-prompt /
  // --append-system-prompt-file (appended after memory/skills/style).
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
      output.write(`⚠ Could not read --append-system-prompt-file: ${(err as Error).message}\n`);
    }
  }

  // Hook dispatcher (M3 + M3c-ext)
  const hooks = new HookDispatcher({
    hooks: settings.hooks,
    disableAllHooks: settings.disableAllHooks,
    allowedHttpHookUrls: settings.allowedHttpHookUrls,
  });

  // M5.2: wire installed plugins (discover + spawn + merge contributed hooks)
  let pluginsWire: WireResult | null = null;
  try {
    pluginsWire = await wirePlugins({
      home: opts.home,
      disabled: settings.disabledPlugins,
      hooks,
      capabilities: buildPluginCapabilities(cwd),
      sandbox: settings.sandbox,
      log: (s) => output.write(s + '\n'),
    });
  } catch (err) {
    output.write(`  ⊞ Plugins: wire-up failed — ${(err as Error).message}\n`);
  }

  let history: StoredMessage[] = resolved.seededHistory;
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
    mcpServers,
    mcpErrors,
    wiredPlugins: pluginsWire?.plugins.map((p) => ({
      name: p.plugin.manifest.name,
      version: p.plugin.manifest.version,
      contributedHookEvents: p.contributedHookEvents,
    })),
    pluginWarnings: [
      ...(pluginsWire?.hashMismatches ?? []),
      ...(pluginsWire?.spawnFailures.map((n) => `${n}: failed to start`) ?? []),
    ],
    initFlow: () => runInitFlow({ cwd, output, rl, provider, model, maxTokens, temperature }),
    // M7: /rewind needs access to history + provider.
    provider,
    history,
  };

  output.write(`\n  ▎ DeepCode  ·  ${ctx.model}  ·  mode: ${ctx.mode}  ·  effort: ${ctx.effort}\n`);
  output.write(`  Working in ${cwd}\n`);
  output.write(`  Type /help for commands, /exit to quit.\n\n`);

  const rl = createInterface({ input: opts.input, output, terminal: true });

  // Now that readline exists, let MCP servers elicit structured input from the
  // user: print the server's message, prompt for each requested field.
  elicitHolder.fn = async (req) => {
    output.write(`\n  ⊞ ${req.server} requests input: ${req.message}\n`);
    const props = (req.requestedSchema.properties ?? {}) as Record<
      string,
      { description?: string }
    >;
    const content: Record<string, string> = {};
    for (const [key, spec] of Object.entries(props)) {
      const label = spec.description ? `${key} (${spec.description})` : key;
      const ans = (await rl.question(`     ${label}: `)).trim();
      if (ans) content[key] = ans;
    }
    return Object.keys(content).length > 0 ? { action: 'accept', content } : { action: 'cancel' };
  };

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

  // Session-lifecycle hooks (the agent loop fires the per-turn ones).
  const fireLifecycle = async (
    event: 'SessionStart' | 'SessionEnd' | 'Notification',
    payload: Record<string, unknown> = {},
  ): Promise<void> => {
    try {
      await hooks.dispatch({
        event,
        cwd: ctx.cwd,
        triggeredAt: new Date().toISOString(),
        payload,
      });
    } catch {
      /* hook failure must not break the REPL */
    }
  };
  await fireLifecycle('SessionStart', { sessionId: session.id, source: 'cli' });

  while (true) {
    let userInput: string;
    try {
      userInput = await rl.question('› ');
    } catch {
      break;
    }
    ctrlCCount = 0;

    if (!userInput.trim()) continue;

    // `#<text>` — remember a fact to project memory (no agent turn).
    if (userInput.trim().startsWith('#')) {
      const fact = userInput.trim().slice(1).trim();
      if (fact) {
        try {
          const path = await rememberFact(ctx.cwd, fact, opts.home);
          output.write(`  ✓ Remembered to ${path}\n\n`);
        } catch (e) {
          output.write(`  ⚠ Could not save memory: ${(e as Error).message}\n\n`);
        }
      }
      continue;
    }

    // Slash command?
    const match = commands.match(userInput);
    if (match) {
      // Refresh ctx.history snapshot before running — /rewind reads it.
      ctx.history = history;
      const lines = await Promise.resolve(match.cmd.run(match.args, ctx));
      for (const line of lines) output.write(line + '\n');
      output.write('\n');
      if (ctx.clearHistory) {
        history = [];
        ctx.clearHistory = false;
      }
      if (ctx.newHistory) {
        history = ctx.newHistory;
        ctx.newHistory = undefined;
      }
      if (ctx.exitRequested) break;
      continue;
    }

    // MCP prompt command (`/mcp__<server>__<prompt> [args]`)? Fetch the rendered
    // prompt from the server and submit it as the user prompt.
    if (userInput.trim().startsWith('/mcp__') && mcpServers.length > 0) {
      const inv = resolveMcpPromptInvocation(userInput, mcpServers);
      if (inv) {
        try {
          userInput = await getMcpPrompt(inv.handle, inv.prompt, inv.args);
          output.write(`  ▸ /mcp__${inv.handle.serverName}__${inv.prompt} (MCP prompt)\n\n`);
        } catch (err) {
          output.write(`  ⚠ MCP prompt failed: ${(err as Error).message}\n`);
          continue;
        }
      }
    }

    // Custom prompt-template command (.deepcode/commands/<name>.md)? Expand its
    // body with the args and submit it to the agent as the user prompt.
    if (userInput.trim().startsWith('/')) {
      const parts = userInput.trim().split(/\s+/);
      const custom = findCustomCommand(customCommands, parts[0]!);
      if (custom) {
        userInput = expandCommandBody(custom.body, parts.slice(1));
        output.write(`  ▸ ${custom.name} (${custom.source} command)\n\n`);
      }
    }

    // Expand `@server:scheme://path` MCP resource references — read each resource
    // and append its content as a tagged block the model can use.
    if (mcpServers.length > 0) {
      const { text, resolved, errors } = await expandMcpResourceRefs(userInput, mcpServers);
      userInput = text;
      for (const r of resolved) output.write(`  ⊞ resource @${r.server}:${r.uri}\n`);
      for (const e of errors) {
        output.write(`  ⚠ resource @${e.ref.server}:${e.ref.uri} — ${e.error}\n`);
      }
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
      maxTurns: opts.maxTurns,
      cwd: ctx.cwd,
      session: { manager: sessions, id: session.id },
      mode: ctx.mode as Mode,
      permissions: settings.permissions,
      hooks,
      pluginDirs: pluginContrib.dirs,
      autoCompact: { contextWindow: contextWindowFor(ctx.model), threshold: 0.8 },
      autoMode: settings.autoMode,
      sandboxConfig: settings.sandbox,
      approval: async (toolName, _input, verdict) => {
        output.write(`\n  ⏸ Approve ${toolName}?  Reason: ${verdict.reason}\n`);
        const answer = (await rl.question('     [y]es / [n]o / [a]lways: ')).trim().toLowerCase();
        if (answer === 'a' || answer === 'always') {
          // Persist a bare-tool matcher to project-local settings so the next
          // run of this tool from this project skips the prompt.
          try {
            const { localPath } = settingsPaths({ cwd: ctx.cwd });
            await appendAllowMatcher(localPath, toolName);
            output.write(`     ✓ Added "${toolName}" to ${localPath} permissions.allow\n`);
          } catch (err) {
            output.write(`     ⚠ Could not persist always-allow: ${(err as Error).message}\n`);
          }
          return 'always';
        }
        return answer === 'y' || answer === 'yes';
      },
      askUser: async (req) => {
        output.write(`\n  ❓ ${req.question}\n`);
        const opts = req.options ?? [];
        opts.forEach((o, i) => {
          output.write(`     ${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ''}\n`);
        });
        if (opts.length === 0) {
          return (await rl.question('     Answer: ')).trim();
        }
        const reply = (
          await rl.question(`     Pick 1-${opts.length} (or type free text): `)
        ).trim();
        const n = Number(reply);
        if (Number.isInteger(n) && n >= 1 && n <= opts.length) {
          return opts[n - 1]!.label;
        }
        return `Other: ${reply}`;
      },
      onEvent: (e: AgentEvent) => formatEvent(output, e),
    });
    history = result.history;
    ctx.usage.inputTokens += result.usage.inputTokens;
    ctx.usage.outputTokens += result.usage.outputTokens;
    ctx.usage.reasoningTokens += result.usage.reasoningTokens;
    // M3c-rest: honor ExitPlanMode tool signal — flip plan → default
    if (result.modeSignal?.exitPlanMode && ctx.mode === 'plan') {
      ctx.mode = 'default';
      output.write('\n  ▶ Exited plan mode (agent will now execute).\n');
    }
    // Honor EnterPlanMode tool signal — flip into plan mode (writes blocked).
    if (result.modeSignal?.enterPlanMode && ctx.mode !== 'plan') {
      ctx.mode = 'plan';
      output.write('\n  ◐ Entered plan mode (write tools blocked until you exit).\n');
    }
    output.write('\n');
    if (result.stopReason === 'error') {
      output.write('  ✕ Error during agent loop. Try again or /status to inspect.\n\n');
    }
    // Notification hook — the turn finished and control returns to the user.
    await fireLifecycle('Notification', {
      message: 'DeepCode finished responding — awaiting your input.',
      stopReason: result.stopReason,
    });
  }

  await fireLifecycle('SessionEnd', { sessionId: session.id });
  rl.close();
  // Clean up MCP server connections
  if (mcpServers.length > 0) {
    await closeAllMcpServers(mcpServers);
  }
  // Shut down plugin subprocesses
  if (pluginsWire) await pluginsWire.shutdown();
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

/**
 * Multi-phase /init flow — scans the project, asks the LLM to draft an
 * AGENTS.md, shows the draft, and asks the user to approve. Returns the
 * path written, or null if the user said no.
 */
async function runInitFlow(args: {
  cwd: string;
  output: Writable;
  rl: { question: (q: string) => Promise<string> };
  provider: DeepSeekProvider;
  model: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string | null> {
  const { cwd, output, rl, provider, model, maxTokens, temperature } = args;
  const path = await import('node:path');
  const fsp = await import('node:fs/promises');
  const target = path.join(cwd, 'AGENTS.md');

  // Phase 1: scan
  output.write('  ▎ /init — Phase 1/3: scanning project...\n');
  const summary = await buildProjectSummary(cwd);

  // Phase 2: propose
  output.write('  ▎ /init — Phase 2/3: asking model to draft AGENTS.md...\n');
  const draft = await draftAgentsMd(provider, model, summary, maxTokens, temperature);

  // Phase 3: approve
  output.write('\n  ▎ Proposed AGENTS.md:\n');
  output.write('  ┌─────────────────────────────────────────\n');
  for (const line of draft.split('\n').slice(0, 40)) {
    output.write(`  │ ${line}\n`);
  }
  if (draft.split('\n').length > 40) output.write('  │ ... (truncated)\n');
  output.write('  └─────────────────────────────────────────\n');

  let exists = false;
  try {
    await fsp.access(target);
    exists = true;
  } catch {
    /* none */
  }
  const verb = exists ? 'Overwrite' : 'Write';
  const ans = (await rl.question(`     ${verb} ${target}? [y]es / [n]o: `)).trim().toLowerCase();
  if (ans !== 'y' && ans !== 'yes') return null;
  await fsp.writeFile(target, draft, 'utf8');
  return target;
}

async function buildProjectSummary(cwd: string): Promise<string> {
  const path = await import('node:path');
  const fsp = await import('node:fs/promises');
  const parts: string[] = [];
  // Top-level listing
  try {
    const entries = await fsp.readdir(cwd, { withFileTypes: true });
    parts.push('Top-level entries:');
    for (const e of entries.slice(0, 40)) {
      parts.push(`  ${e.isDirectory() ? 'd' : '-'} ${e.name}`);
    }
  } catch {
    /* ignore */
  }
  // Pick up to 3 well-known files
  for (const f of ['package.json', 'README.md', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    try {
      const raw = await fsp.readFile(path.join(cwd, f), 'utf8');
      parts.push(`\n=== ${f} (first 30 lines) ===`);
      parts.push(raw.split('\n').slice(0, 30).join('\n'));
    } catch {
      /* not present */
    }
  }
  return parts.join('\n');
}

async function draftAgentsMd(
  provider: DeepSeekProvider,
  model: string,
  summary: string,
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  const sys = `You are drafting an AGENTS.md (the per-project agent-instructions file). Output ONLY the Markdown — no preface, no fences. Sections to include:

1. Project name and one-line description
2. Tech stack
3. How to install / build / test
4. Code style conventions (if discernible)
5. Where the entry points / important files live
6. Any "do/don't" notes specific to this project

Keep it under 80 lines.`;
  const r = await provider.runTurn({
    model,
    systemPrompt: sys,
    tools: [],
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `Project scan:\n${summary}` }],
      },
    ],
    maxTokens: maxTokens ?? 2048,
    temperature: temperature ?? 0.3,
  });
  const text = r.content
    .filter((c) => c.type === 'text')
    .map((c) => (c as { text: string }).text)
    .join('');
  return text.trim() || '# AGENTS.md\n\n(The model returned an empty draft.)\n';
}

/**
 * Build the capability bridge passed to plugin subprocesses (M5.2).
 *
 * Each capability invokes the host's existing tool implementation — which
 * means plugin calls flow through the SAME read/write/exec gates as the
 * agent. (mode + permissions + sandbox come from the ToolContext we pass in.)
 *
 * NOTE: this bridge does NOT carry mode/permissions yet — that's M5.2-ext.
 * Today the plugin's `bash` calls are unsandboxed because we don't have a
 * sandboxConfig in ctx here. Callers wanting hardening should set
 * settings.sandbox.enabled and pass sandboxConfig in a later iteration.
 */
function buildPluginCapabilities(cwd: string): {
  fs_read: (path: string) => Promise<string>;
  fs_write: (path: string, content: string) => Promise<void>;
  bash: (cmd: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  fetch: (url: string, opts?: { method?: string; body?: string }) => Promise<string>;
} {
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
    fetch: async (url: string, fopts?: { method?: string; body?: string }) => {
      void fopts; // method/body deferred — WebFetch is GET-only
      const r = await WebFetchTool.execute({ url }, ctx);
      if (r.isError) throw new Error(r.content);
      return r.content;
    },
  };
}

/**
 * Find the bundled built-in skills directory.
 * In dev: <repo>/packages/core/skills/.
 * In published package: packaged inside @deepcode/core/skills/.
 * Returns undefined if not found.
 */
