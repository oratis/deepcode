import { resolve } from 'node:path';
import { loadSettings } from './loader.js';
import { validateSettingsShallow } from './validation.js';
import { gateUntrustedSettings } from './trust-gate.js';
import { HookTrustStore } from './hook-trust.js';
/** Build a value-free diagnostic report suitable for protocol/UI/log export. */
export async function diagnoseSettings(options) {
    const loaded = await loadSettings(options);
    const gate = gateUntrustedSettings(loaded, options.trustStatus);
    const issues = validateSettingsShallow(loaded.merged).map((message) => ({ severity: 'error', code: 'schema_validation', message }));
    for (const field of gate.gated) {
        const pointer = `/${field}`;
        issues.push({
            severity: 'warning',
            code: 'untrusted_setting_gated',
            message: `Ignored project setting ${pointer} until this directory is trusted`,
            pointer,
            source: sourceForPrefix(loaded.provenance, pointer),
        });
    }
    if (options.trustStatus === 'trusted') {
        const hookReview = await new HookTrustStore({
            home: options.home,
            directory: options.directory,
        }).review(options.cwd, loaded, gate.settings.hooks);
        for (const review of hookReview.reviews.filter((item) => !item.trusted)) {
            issues.push({
                severity: 'warning',
                code: 'hook_review_required',
                message: `Project command hook ${review.event} (${review.hash}) is disabled until reviewed`,
                pointer: `/hooks/${review.event}`,
                source: review.source,
            });
        }
    }
    const layerPaths = {
        user: loaded.sources.userPath,
        project: loaded.sources.projectPath,
        local: loaded.sources.localPath,
        override: loaded.sources.overridePath,
    };
    return {
        cwd: resolve(options.cwd),
        trustStatus: options.trustStatus,
        layers: ['user', 'project', 'local', 'override']
            .filter((layer) => layerPaths[layer] !== undefined)
            .map((layer) => ({
            layer,
            path: layerPaths[layer],
            present: loaded.layers[layer] !== undefined,
            trusted: layer === 'user' || layer === 'override' || options.trustStatus === 'trusted',
        })),
        provenance: loaded.provenance,
        gated: [...gate.gated],
        issues,
    };
}
function sourceForPrefix(provenance, pointer) {
    return Object.entries(provenance).find(([candidate]) => candidate === pointer || candidate.startsWith(`${pointer}/`))?.[1];
}
//# sourceMappingURL=diagnostics.js.map