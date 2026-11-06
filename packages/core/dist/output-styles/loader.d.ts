export interface OutputStyleFrontmatter {
    name: string;
    description?: string;
    /** Whether to keep the default "how to write code" instructions in the system prompt. */
    'keep-coding-instructions'?: boolean;
}
export interface OutputStyle {
    name: string;
    frontmatter: OutputStyleFrontmatter;
    /** Markdown body — appended to the system prompt when style is active. */
    body: string;
    source: 'builtin' | 'user' | 'project';
}
export interface LoadOutputStylesOpts {
    cwd: string;
    home?: string;
    /** Direct DeepCode data directory (contains output-styles/). */
    directory?: string;
}
/** Built-in styles (M4 ships 4 — matches §3.13b table). */
export declare const BUILTIN_STYLES: OutputStyle[];
export declare function loadOutputStyles(opts: LoadOutputStylesOpts): Promise<OutputStyle[]>;
export declare function findStyle(styles: OutputStyle[], name: string): OutputStyle | undefined;
/**
 * Append a style's body to a base system prompt.
 * If the style has `keep-coding-instructions: false`, the caller is expected
 * to omit the default "how to write code" boilerplate.
 */
export declare function applyStyle(basePrompt: string, style: OutputStyle | undefined): string;
//# sourceMappingURL=loader.d.ts.map