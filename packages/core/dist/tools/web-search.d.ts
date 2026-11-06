import type { ToolHandler } from '../types.js';
export interface SearchHit {
    title: string;
    url: string;
    snippet: string;
}
export declare const WebSearchTool: ToolHandler;
/**
 * Parse DDG's HTML result page. The markup uses `result__a` for titles and
 * `result__snippet` for descriptions. We're permissive: any reasonable a-tag
 * containing href= within a result block counts.
 */
export declare function parseDuckDuckGoHtml(html: string): SearchHit[];
//# sourceMappingURL=web-search.d.ts.map