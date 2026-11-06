// Trigger profile — the permission posture a scheduled job runs under.
// Plan: docs/FLOATBOAT_ADOPTION_PLAN.md §2.E
//
// A cron job reads the same settings.json you use interactively, so a
// `defaultMode: bypassPermissions` chosen for REPL convenience silently becomes
// the posture of every job that fires at 3am with nobody watching. The
// convenience choice and the unattended choice are different decisions and
// should not share one switch.
//
// Floatboat's version of this idea is "permission scopes set per calendar
// event, not per account". The mechanism is right even though the product
// around it is not: a trigger is a bounded, temporary grant, not a standing one.
import { isPermissiveMode } from '../modes/index.js';
import { SANDBOX_MODES } from '../sandbox/policy.js';
/** Strictest first — used to make "only tighten" decidable for the sandbox. */
const SANDBOX_STRICTNESS = ['read-only', 'workspace-write', 'danger-full-access'];
/**
 * The mode an unattended run should use.
 *
 * An explicit `profile.mode` always wins, including a permissive one. Otherwise
 * a permissive ambient mode is clamped to `default`: inheriting "never ask me"
 * into a context where nobody could be asked is not what the user chose, it is
 * what they forgot to reconsider.
 */
export function resolveTriggerMode(profile, ambient) {
    if (profile?.mode)
        return { mode: profile.mode, clamped: false, ambient };
    if (isPermissiveMode(ambient))
        return { mode: 'default', clamped: true, ambient };
    return { mode: ambient, clamped: false, ambient };
}
/**
 * Combine ambient rules with a profile's, tightening only.
 *
 * Denies and asks union — either source can add a restriction. Allows
 * intersect, so a profile can narrow what is auto-approved but never widen it.
 * This is the same one-way property the file contract has, for the same reason:
 * a mechanism that can only tighten cannot reduce existing safety, whatever the
 * user writes.
 */
export function tightenPermissions(ambient, profile) {
    if (!profile)
        return ambient;
    const base = ambient ?? {};
    const out = {};
    const deny = [...(base.deny ?? []), ...(profile.deny ?? [])];
    if (deny.length > 0)
        out.deny = [...new Set(deny)];
    const ask = [...(base.ask ?? []), ...(profile.ask ?? [])];
    if (ask.length > 0)
        out.ask = [...new Set(ask)];
    if (profile.allow) {
        const allowed = new Set(profile.allow);
        out.allow = (base.allow ?? []).filter((rule) => allowed.has(rule));
    }
    else if (base.allow) {
        out.allow = [...base.allow];
    }
    return out;
}
/** The stricter of the two sandbox modes; a profile can never loosen it. */
export function tightenSandbox(ambient, profile) {
    if (!profile)
        return ambient;
    if (!ambient)
        return profile;
    if (!SANDBOX_MODES.includes(profile))
        return ambient;
    const rank = (m) => SANDBOX_STRICTNESS.indexOf(m);
    return rank(profile) <= rank(ambient) ? profile : ambient;
}
/** Human-readable note for the job log when a clamp happens. */
export function describeClamp(resolved) {
    if (!resolved.clamped)
        return undefined;
    return (`Permission mode "${resolved.ambient}" was not applied to this unattended run — ` +
        `it is inherited from settings and nobody is present to approve. Running as "${resolved.mode}". ` +
        `Set the job's profile.mode explicitly to opt back in.`);
}
//# sourceMappingURL=profile.js.map