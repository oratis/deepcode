import type { ToolHandler } from '../types.js';
export interface ReviewFinding {
    title: string;
    body: string;
    path: string;
    startLine: number;
    endLine: number;
    priority: 0 | 1 | 2 | 3;
    replacement?: string;
}
/** Read-only presentation tool: records a structured, line-addressable review finding. */
export declare const SubmitReviewFindingTool: ToolHandler;
//# sourceMappingURL=review-finding.d.ts.map