// Plugin install — git clone (gh:user/repo) + npm (pkg@npm) + marketplace install paths.
// Spec: docs/DEVELOPMENT_PLAN.md §3.14 (M5.2)
//
// Three install sources:
//   1. Local path                       (M5; see installLocal in manifest.ts)
//   2. gh:user/repo                      (M5.2; git clone into staging + verify + move)
//   3. <pkg>@npm                         (M5.2; `npm pack` + extract + verify)
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLocal, pluginsDir } from './manifest.js';
/**
 * Install from a GitHub repo (`gh:owner/repo` or `gh:owner/repo@ref`).
 * Steps:
 *   1. git clone --depth 1 [--branch <ref>] into staging dir
 *   2. installLocal(staging) → copies to ~/.deepcode/plugins/<name>/
 *   3. Remove staging dir
 */
export async function installFromGithub(spec, opts = {}) {
    const m = /^gh:([\w-]+)\/([\w.-]+)(?:@(.+))?$/.exec(spec);
    if (!m)
        throw new Error(`Invalid GitHub spec: ${spec} (expected gh:owner/repo[@ref])`);
    const [, owner, repo, ref] = m;
    const url = `https://github.com/${owner}/${repo}.git`;
    const staging = await fs.mkdtemp(join(opts.stagingDir ?? tmpdir(), `dc-plug-staging-${repo}-`));
    try {
        const args = ['clone', '--depth', '1'];
        if (ref)
            args.push('--branch', ref);
        args.push(url, staging);
        await runCommand('git', args);
        return await installLocal({
            sourcePath: staging,
            home: opts.home,
            trustedBy: opts.trustedBy ?? 'user',
        });
    }
    finally {
        await fs.rm(staging, { recursive: true, force: true });
    }
}
/**
 * Install from an npm package (`<name>@npm` or `<name>@<version>@npm`).
 * Uses `npm pack <name>` to produce a tarball, extracts it, and runs the
 * local install flow. Doesn't write to the global npm registry.
 */
export async function installFromNpm(spec, opts = {}) {
    const m = /^(.+)@npm$/.exec(spec);
    if (!m)
        throw new Error(`Invalid npm spec: ${spec} (expected <name>@npm or <name>@<ver>@npm)`);
    const pkg = m[1];
    const staging = await fs.mkdtemp(join(opts.stagingDir ?? tmpdir(), `dc-plug-npm-${pkg.replace(/[@/]/g, '_')}-`));
    try {
        // npm pack <pkg> --pack-destination=staging
        await runCommand('npm', ['pack', pkg, '--pack-destination', staging]);
        // Find the tarball (one .tgz in staging)
        const entries = await fs.readdir(staging);
        const tarball = entries.find((e) => e.endsWith('.tgz'));
        if (!tarball)
            throw new Error(`npm pack produced no tarball in ${staging}`);
        // Extract to staging/extracted/
        const extracted = join(staging, 'extracted');
        await fs.mkdir(extracted, { recursive: true });
        await runCommand('tar', ['-xzf', join(staging, tarball), '-C', extracted]);
        // tar yields `package/` inside extracted/
        const pkgRoot = join(extracted, 'package');
        return await installLocal({
            sourcePath: pkgRoot,
            home: opts.home,
            trustedBy: opts.trustedBy ?? 'user',
        });
    }
    finally {
        await fs.rm(staging, { recursive: true, force: true });
    }
}
/**
 * Polymorphic entry point: detects spec format and dispatches.
 */
export async function installFromSpec(spec, opts = {}) {
    if (spec.startsWith('gh:'))
        return installFromGithub(spec, opts);
    if (spec.endsWith('@npm'))
        return installFromNpm(spec, opts);
    // Otherwise: treat as local path
    return installLocal({
        sourcePath: spec,
        home: opts.home,
        trustedBy: opts.trustedBy ?? 'user',
    });
}
function runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: 'pipe' });
        let stderr = '';
        p.stderr.on('data', (c) => (stderr += c.toString()));
        p.on('error', reject);
        p.on('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr}`));
        });
    });
}
/**
 * Uninstall — remove the plugin dir from ~/.deepcode/plugins/<name>/
 * and the trust manifest entry. Idempotent.
 */
export async function uninstallPlugin(name, home = homedir()) {
    const dir = join(pluginsDir(home), name);
    let existed = false;
    try {
        await fs.access(dir);
        existed = true;
    }
    catch {
        /* nothing to remove */
    }
    if (existed)
        await fs.rm(dir, { recursive: true, force: true });
    // Trust state cleanup
    const { loadTrustState, saveTrustState } = await import('./manifest.js');
    const state = await loadTrustState(home);
    if (state.plugins[name]) {
        delete state.plugins[name];
        await saveTrustState(home, state);
    }
    return existed;
}
//# sourceMappingURL=install.js.map