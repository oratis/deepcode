// `deepcode setup-token` — provision a long-lived DeepSeek auth token for CI /
// headless use, persisted to the credential store (Keychain or chmod-600 file).
// Spec: docs/DEVELOPMENT_PLAN.md §3.4
//
// DeepSeek has no OAuth device flow (unlike Claude Code's `setup-token`), so the
// token is supplied directly: as an argument, via $DEEPSEEK_AUTH_TOKEN, or piped
// on stdin (the CI-friendly path: `echo "$TOK" | deepcode setup-token`).
import { CredentialsStore, redact } from '@deepcode/core';
async function readStdin(stream) {
    const chunks = [];
    for await (const chunk of stream)
        chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}
export async function runSetupToken(deps = {}) {
    const out = deps.output ?? process.stdout;
    const err = deps.errOutput ?? process.stderr;
    const env = deps.env ?? process.env;
    const stdin = deps.stdin ?? process.stdin;
    let token = deps.token?.trim() || env.DEEPSEEK_AUTH_TOKEN?.trim();
    if (!token && stdin && !stdin.isTTY) {
        token = (await readStdin(stdin)).trim();
    }
    if (!token) {
        err.write('Usage: deepcode setup-token <token>\n' +
            '  or set $DEEPSEEK_AUTH_TOKEN, or pipe it:  echo "$TOKEN" | deepcode setup-token\n');
        return 2;
    }
    const store = new CredentialsStore({ home: deps.home, forceFile: deps.forceFile });
    const existing = await store.load();
    await store.save({ ...existing, authToken: token });
    out.write(`✓ Stored DeepSeek auth token (${redact(token)}). It will be sent as the Bearer credential on future runs.\n`);
    return 0;
}
//# sourceMappingURL=setup-token.js.map