export interface DiffLine {
    kind: 'add' | 'del' | 'ctx';
    /** 1-based line number in the OLD revision (null for added lines). */
    oldNo: number | null;
    /** 1-based line number in the NEW revision (null for deleted lines). */
    newNo: number | null;
    text: string;
}
export declare function computeLineDiff(oldText: string, newText: string): DiffLine[];
/** True when a diff has at least one add/del (i.e. the two revisions differ). */
export declare function hasChanges(lines: DiffLine[]): boolean;
//# sourceMappingURL=diff.d.ts.map