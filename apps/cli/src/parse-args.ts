// CLI argv parser — minimal, dependency-free, designed for the flag set in
// docs/DEVELOPMENT_PLAN.md §5.
// Returns a strongly-typed shape. Unknown flags are collected into `unknown` for
// graceful "did you mean..." errors.

import type { Effort, Mode } from '@deepcode/core';

export interface ParsedArgs {
  // Action triggers (mutually exclusive — first match wins)
  showHelp: boolean;
  showVersion: boolean;
  doctor: boolean;
  upgrade: boolean;

  // Mode of execution
  prompt?: string; // -p / --print, one-shot
  resume: boolean; // --resume (interactive picker)
  resumeId?: string; // --resume <sessionId>
  continue: boolean;
  forkSession: boolean;

  // Session shaping
  mode?: Mode;
  permissionMode?: Mode;
  model?: string;
  effort?: Effort;
  maxTurns?: number;
  bare: boolean;

  // System prompt overrides
  systemPrompt?: string;
  appendSystemPrompt?: string;
  appendSystemPromptFile?: string;

  // Tool allow/deny lists
  allowedTools?: string[];
  disallowedTools?: string[];

  // Output (headless mode)
  outputFormat: 'text' | 'json' | 'stream-json';
  jsonSchema?: string;
  includePartialMessages: boolean;
  verbose: boolean;

  // Settings overrides
  settingsFile?: string;
  agentsDir?: string;
  mcpConfig?: string;
  pluginDir?: string;
  pluginUrl?: string;
  noPlugins: boolean;
  strict: boolean;

  // Diagnostics
  unknownFlags: string[];

  // Positional args (rarely used)
  positional: string[];
}

const VALID_MODES: Mode[] = [
  'default',
  'acceptEdits',
  'plan',
  'auto',
  'dontAsk',
  'bypassPermissions',
];
const VALID_EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    showHelp: false,
    showVersion: false,
    doctor: false,
    upgrade: false,
    resume: false,
    continue: false,
    forkSession: false,
    bare: false,
    outputFormat: 'text',
    includePartialMessages: false,
    verbose: false,
    noPlugins: false,
    strict: false,
    unknownFlags: [],
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string | undefined => argv[++i];

    switch (true) {
      case a === '-h' || a === '--help':
        out.showHelp = true;
        break;
      case a === '-v' || a === '--version':
        out.showVersion = true;
        break;
      case a === 'doctor':
        out.doctor = true;
        break;
      case a === 'upgrade':
        out.upgrade = true;
        break;
      case a === '-p' || a === '--print':
        out.prompt = next();
        break;
      case a === '--resume': {
        const maybeId = argv[i + 1];
        if (maybeId && !maybeId.startsWith('-')) {
          out.resumeId = maybeId;
          i++;
        }
        out.resume = true;
        break;
      }
      case a === '--continue':
        out.continue = true;
        break;
      case a === '--fork-session':
        out.forkSession = true;
        break;
      case a === '--mode': {
        const v = next();
        if (v && (VALID_MODES as string[]).includes(v)) out.mode = v as Mode;
        else out.unknownFlags.push(`--mode ${v ?? ''}`);
        break;
      }
      case a === '--permission-mode': {
        const v = next();
        if (v && (VALID_MODES as string[]).includes(v)) out.permissionMode = v as Mode;
        else out.unknownFlags.push(`--permission-mode ${v ?? ''}`);
        break;
      }
      case a === '--model':
        out.model = next();
        break;
      case a === '--effort': {
        const v = next();
        if (v && (VALID_EFFORTS as string[]).includes(v)) out.effort = v as Effort;
        else out.unknownFlags.push(`--effort ${v ?? ''}`);
        break;
      }
      case a === '--max-turns': {
        const v = next();
        const n = v ? Number.parseInt(v, 10) : NaN;
        if (Number.isFinite(n) && n > 0) out.maxTurns = n;
        else out.unknownFlags.push(`--max-turns ${v ?? ''}`);
        break;
      }
      case a === '--bare':
        out.bare = true;
        break;
      case a === '--system-prompt':
        out.systemPrompt = next();
        break;
      case a === '--append-system-prompt':
        out.appendSystemPrompt = next();
        break;
      case a === '--append-system-prompt-file':
        out.appendSystemPromptFile = next();
        break;
      case a === '--allowedTools': {
        const v = next();
        if (v)
          out.allowedTools = v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        break;
      }
      case a === '--disallowedTools': {
        const v = next();
        if (v)
          out.disallowedTools = v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        break;
      }
      case a === '--output-format': {
        const v = next();
        if (v === 'text' || v === 'json' || v === 'stream-json') out.outputFormat = v;
        else out.unknownFlags.push(`--output-format ${v ?? ''}`);
        break;
      }
      case a === '--json-schema':
        out.jsonSchema = next();
        break;
      case a === '--include-partial-messages':
        out.includePartialMessages = true;
        break;
      case a === '--verbose':
        out.verbose = true;
        break;
      case a === '--settings':
        out.settingsFile = next();
        break;
      case a === '--agents':
        out.agentsDir = next();
        break;
      case a === '--mcp-config':
        out.mcpConfig = next();
        break;
      case a === '--plugin-dir':
        out.pluginDir = next();
        break;
      case a === '--plugin-url':
        out.pluginUrl = next();
        break;
      case a === '--no-plugins':
        out.noPlugins = true;
        break;
      case a === '--strict':
        out.strict = true;
        break;
      case a.startsWith('--'):
        out.unknownFlags.push(a);
        break;
      case a.startsWith('-'):
        out.unknownFlags.push(a);
        break;
      default:
        out.positional.push(a);
        break;
    }
  }

  return out;
}

export function helpText(version: string): string {
  return `DeepCode v${version} — DeepSeek-powered AI coding agent (Claude Code parity)

USAGE
  deepcode                              Interactive REPL
  deepcode -p "<prompt>"                Headless one-shot
  deepcode --resume [<id>]              Resume a session
  deepcode --continue                   Continue most recent session
  deepcode doctor                       Diagnostic checks
  deepcode upgrade                      Self-update (CLI; Mac client auto-updates)

MODE
  --mode <name>                         default / acceptEdits / plan / auto / dontAsk / bypassPermissions
  --permission-mode <name>              Alias for --mode (Claude Code parity)
  --bare                                No plugins / MCP / skills — just kernel + tools

MODEL & EFFORT
  --model <id>                          deepseek-chat | deepseek-reasoner
  --effort <tier>                       low | medium | high | xhigh | max
  --max-turns <n>                       Cap agent loop turns

SYSTEM PROMPT
  --system-prompt "<text>"              Replace default system prompt
  --append-system-prompt "<text>"       Append to default
  --append-system-prompt-file <path>    Append from a file

TOOLS
  --allowedTools "Tool,..."             Whitelist
  --disallowedTools "Tool,..."          Blacklist

HEADLESS / CI (-p mode only)
  --output-format text|json|stream-json Default text. json = single object at exit; stream-json = NDJSON events.
  --json-schema <path>                  Constrain final output to a JSON schema
  --include-partial-messages            Stream partial deltas
  --verbose                             Print LLM/tool call traces

Exit codes (headless): 0 ok · 1 generic · 2 bad-input · 3 api/auth · 4 max-turns · 5 aborted

OVERRIDES
  --settings <path>                     Override settings.json discovery
  --agents <dir>                        Override sub-agents dir
  --mcp-config <path>                   Override MCP server config
  --plugin-dir <dir>                    Temporarily mount a plugin dir
  --plugin-url <gh:user/repo>           Temporarily mount a remote plugin
  --no-plugins                          Disable all plugins for this run
  --strict                              Strict mode: only official-marketplace plugins, no hooks

DIAGNOSTICS
  -h, --help                            Show this
  -v, --version                         Show version

Configuration:  ~/.deepcode/settings.json  ·  <project>/.deepcode/settings.json  ·  <project>/.deepcode/settings.local.json
Credentials:    macOS Keychain (service=deepcode)  ·  ~/.deepcode/credentials.json (chmod 600)
Sessions:       ~/.deepcode/sessions/
Docs:           https://github.com/oratis/deepcode#docs
`;
}
