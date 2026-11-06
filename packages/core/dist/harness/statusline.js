// statusLine command runner — periodically exec a user-defined command,
// pipe session JSON to its stdin, render stdout in the CLI/GUI status area.
// Spec: docs/DEVELOPMENT_PLAN.md §3.15.8
import { spawn } from 'node:child_process';
const DEFAULT_DEBOUNCE_MS = 5000;
const COMMAND_TIMEOUT_MS = 2000; // statusline commands should be quick
export class StatusLineRunner {
    opts;
    debounceMs;
    timer = null;
    lastText = '';
    running = false;
    constructor(opts) {
        this.opts = opts;
        this.debounceMs =
            opts.debounceMs ??
                (process.env.DEEPCODE_STATUS_LINE_DEBOUNCE_MS
                    ? Number.parseInt(process.env.DEEPCODE_STATUS_LINE_DEBOUNCE_MS, 10)
                    : DEFAULT_DEBOUNCE_MS);
    }
    start() {
        if (this.running)
            return;
        this.running = true;
        // Fire once immediately, then schedule periodic
        this.tick();
        this.timer = setInterval(() => this.tick(), this.debounceMs);
    }
    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    /** Force an immediate refresh (e.g. after the model changes). */
    refresh() {
        if (this.running)
            this.tick();
    }
    async tick() {
        const payload = this.opts.payload();
        const stdin = JSON.stringify(payload);
        const text = await runStatusLineCommand(this.opts.config, stdin);
        if (text !== this.lastText) {
            this.lastText = text;
            this.opts.onUpdate(text);
        }
    }
}
/**
 * Execute the statusLine command with the JSON payload on stdin.
 * Returns the trimmed stdout. On failure returns an empty string.
 */
export function runStatusLineCommand(config, stdinPayload) {
    return new Promise((resolveResult) => {
        if (config.type !== 'command' || !config.command) {
            resolveResult('');
            return;
        }
        const child = spawn('/bin/sh', ['-c', config.command]);
        let stdout = '';
        let killed = false;
        const timer = setTimeout(() => {
            killed = true;
            child.kill('SIGKILL');
            child.stdout?.destroy();
            child.stderr?.destroy();
        }, COMMAND_TIMEOUT_MS);
        child.stdout.on('data', (c) => {
            stdout += c.toString('utf8');
        });
        // Suppress unhandled EPIPE if the script doesn't read stdin
        child.stdin.on('error', () => { });
        child.on('error', () => {
            clearTimeout(timer);
            resolveResult('');
        });
        child.on('close', () => {
            clearTimeout(timer);
            if (killed) {
                resolveResult('');
                return;
            }
            // Cap output at 200 chars (matches plan-mentioned constraint)
            resolveResult(stdout.trim().slice(0, 200));
        });
        try {
            child.stdin.write(stdinPayload);
        }
        catch {
            /* pipe closed */
        }
        try {
            child.stdin.end();
        }
        catch {
            /* already ended */
        }
    });
}
//# sourceMappingURL=statusline.js.map