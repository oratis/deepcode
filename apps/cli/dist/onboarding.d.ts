import { CredentialsStore, type Credentials } from '@deepcode/core';
import { type Interface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';
export interface OnboardingResult {
    creds: Credentials;
    skipped: boolean;
}
export interface OnboardingIO {
    input: Readable;
    output: Writable;
}
export interface OnboardingOpts extends OnboardingIO {
    store: CredentialsStore;
}
export declare function runOnboarding(opts: OnboardingOpts): Promise<OnboardingResult>;
export declare function looksLikeDeepSeekKey(value: string): boolean;
/**
 * Prompt for input with character masking (★) to keep secrets off-screen.
 * Implemented via stdin raw-mode + ★ echo per keystroke.
 */
export declare function promptHidden(rl: Interface, output: Writable, question: string): Promise<string>;
//# sourceMappingURL=onboarding.d.ts.map