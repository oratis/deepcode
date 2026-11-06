export interface Frontmatter {
    /** All parsed key-value pairs (strings, arrays, booleans). */
    fields: Record<string, unknown>;
    /** Markdown body after the frontmatter. */
    body: string;
}
export declare function parseFrontmatter(raw: string): Frontmatter;
/**
 * Parse a small subset of YAML. Supports:
 *   key: "string"
 *   key: bare-string
 *   key: 42
 *   key: true / false
 *   key: ["a", "b", "c"]   (flow-style array)
 *   key:                    (block-style array)
 *     - item1
 *     - item2
 *   key:                    (object — single level)
 *     subkey: value
 */
export declare function parseSimpleYaml(lines: string[]): Record<string, unknown>;
//# sourceMappingURL=frontmatter.d.ts.map