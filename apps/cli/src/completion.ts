// Shell completion scripts for `deepcode completion <bash|zsh|fish>` (Codex
// parity: `codex completion`). Emits a script to stdout that the user installs,
// e.g. `deepcode completion zsh > ~/.zfunc/_deepcode` or
// `eval "$(deepcode completion bash)"`.
//
// The flag/subcommand lists are kept here deliberately (not derived from the
// parser) so the script is a self-contained string; keep them in sync with
// parse-args.ts when the flag set changes.

import type { Writable } from 'node:stream';

export type CompletionShell = 'bash' | 'zsh' | 'fish';

export const COMPLETION_SHELLS: CompletionShell[] = ['bash', 'zsh', 'fish'];

/** Top-level flags `deepcode` accepts (see parse-args.ts). */
const FLAGS = [
  '--help',
  '--version',
  '--print',
  '--resume',
  '--continue',
  '--fork-session',
  '--mode',
  '--permission-mode',
  '--model',
  '--effort',
  '--max-turns',
  '--bare',
  '-C',
  '--cd',
  '--system-prompt',
  '--append-system-prompt',
  '--append-system-prompt-file',
  '--allowedTools',
  '--disallowedTools',
  '--output-format',
  '--json-schema',
  '--include-partial-messages',
  '--verbose',
  '--json',
  '--settings',
  '--agents',
  '--mcp-config',
  '--plugin-dir',
  '--plugin-url',
  '--no-plugins',
  '--strict',
];

/** Positional subcommands (see cli.ts dispatch). */
const SUBCOMMANDS = [
  'doctor',
  'upgrade',
  'mcp',
  'trust',
  'plugins',
  'skills',
  'cron',
  'scheduler',
  'setup-token',
  'completion',
];

export function isCompletionShell(value: string | undefined): value is CompletionShell {
  return value === 'bash' || value === 'zsh' || value === 'fish';
}

/** Return the completion script for `shell`. */
export function completionScript(shell: CompletionShell): string {
  const words = [...FLAGS, ...SUBCOMMANDS].join(' ');
  if (shell === 'bash') {
    return `# deepcode bash completion — eval "$(deepcode completion bash)"
_deepcode() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=( $(compgen -W "${words}" -- "\${cur}") )
}
complete -F _deepcode deepcode
`;
  }
  if (shell === 'zsh') {
    return `#compdef deepcode
# deepcode zsh completion — deepcode completion zsh > "\${fpath[1]}/_deepcode"
_deepcode() {
  local -a words
  words=(${[...FLAGS, ...SUBCOMMANDS].map((w) => `'${w}'`).join(' ')})
  compadd -- $words
}
compdef _deepcode deepcode
`;
  }
  // fish
  const lines = [
    '# deepcode fish completion — deepcode completion fish > ~/.config/fish/completions/deepcode.fish',
  ];
  lines.push('complete -c deepcode -f');
  for (const f of FLAGS) {
    if (f.startsWith('--')) lines.push(`complete -c deepcode -l ${f.slice(2)}`);
    else if (f.startsWith('-')) lines.push(`complete -c deepcode -o ${f.slice(1)}`);
  }
  lines.push(`complete -c deepcode -a '${SUBCOMMANDS.join(' ')}'`);
  return lines.join('\n') + '\n';
}

/** `deepcode completion <shell>` handler. Returns the process exit code. */
export function runCompletion(
  args: string[],
  io: { output: Writable; errOutput: Writable },
): number {
  const shell = args[0];
  if (!isCompletionShell(shell)) {
    io.errOutput.write(
      `Usage: deepcode completion <bash|zsh|fish>\n` +
        (shell ? `Unknown shell "${shell}".\n` : 'Missing shell argument.\n'),
    );
    return 2;
  }
  io.output.write(completionScript(shell));
  return 0;
}
