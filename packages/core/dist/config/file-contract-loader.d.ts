import { type FileContract } from './file-contract.js';
/**
 * Outcome of looking for a contract.
 *
 * `invalid` exists because the two obvious alternatives are both wrong: falling
 * back to "no contract" silently drops every `deny` the author wrote, and
 * refusing to start turns a typo into a broken install. Reporting it lets the
 * caller keep working under the tool rules alone while saying so loudly.
 */
export type FileContractStatus = 'absent' | 'loaded' | 'invalid';
export interface LoadedFileContract {
    status: FileContractStatus;
    contract?: FileContract;
    /** Absolute path of the file used, when one was found. */
    path?: string;
    /** Parse failure detail, present only when status is `invalid`. */
    error?: string;
}
export interface LoadFileContractOpts {
    cwd: string;
    /** Override $HOME (tests). */
    home?: string;
    /** Direct DeepCode data directory (contains file-contract.yaml). */
    directory?: string;
}
/** Candidate locations, most specific first. */
export declare function fileContractPaths(opts: LoadFileContractOpts): string[];
/**
 * Load the first contract that exists.
 *
 * Project beats user rather than merging them. Merging two rule lists would
 * make precedence depend on concatenation order across files nobody sees
 * together, and "which file denied this?" is a question the user has to be able
 * to answer by opening one file.
 */
export declare function loadFileContract(opts: LoadFileContractOpts): Promise<LoadedFileContract>;
/**
 * Starter contract for `deepcode contract init`.
 *
 * Defaults stay `allow` on all three axes. A coding agent that writes code is
 * doing its job, so the useful contract denies the handful of paths that are
 * never the job, rather than asking about everything and training the user to
 * approve reflexively.
 */
export declare const RECOMMENDED_FILE_CONTRACT = "# DeepCode file contract \u2014 permission rules on the path axis.\n# Docs: https://github.com/oratis/deepcode/blob/main/docs/file-contract.md\n#\n# Decisions: allow | ask | deny. Axes: read | write | execute.\n# More specific glob wins; equal specificity means the later rule wins.\n#\n# This constrains tool calls (Read/Write/Edit/Grep/Glob). It does NOT constrain\n# what a shell command does once Bash starts \u2014 only the sandbox does that.\n\nversion: 1\n\ndefaults:\n  read: allow\n  write: allow\n  execute: allow\n\nrules:\n  # Secrets are never the job.\n  - glob: \"**/.env*\"\n    owner: human\n    read: deny\n    write: deny\n    reason: \"Secrets are human-only.\"\n\n  - glob: \"**/*.{pem,key,p12,pfx,keystore,jks}\"\n    owner: human\n    read: deny\n    write: deny\n    reason: \"Private keys are human-only.\"\n\n  - glob: \"**/{id_rsa,id_ed25519,id_ecdsa,.npmrc,.pypirc,.netrc}\"\n    owner: human\n    read: deny\n    write: deny\n    reason: \"Credential file \u2014 human-only.\"\n\n  # High impact: allowed, but worth a look before it lands.\n  - glob: \"{AGENTS.md,CLAUDE.md,DEEPCODE.md}\"\n    owner: shared\n    write: ask\n    reason: \"Agent instructions shape every future run \u2014 review before writing.\"\n\n  - glob: \".github/workflows/**\"\n    owner: human\n    write: ask\n    reason: \"CI runs with repository credentials.\"\n\n  - glob: \".deepcode/settings.json\"\n    owner: human\n    write: ask\n    reason: \"Settings hold the permission rules themselves.\"\n";
/** Decisions in this contract that only take effect while the sandbox is on. */
export declare function contractNeedsSandbox(contract: FileContract | undefined): boolean;
//# sourceMappingURL=file-contract-loader.d.ts.map