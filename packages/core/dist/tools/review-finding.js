import { isAbsolute } from 'node:path';
/** Read-only presentation tool: records a structured, line-addressable review finding. */
export const SubmitReviewFindingTool = {
    name: 'SubmitReviewFinding',
    definition: {
        name: 'SubmitReviewFinding',
        description: 'Submit one actionable code-review finding. Use once per distinct defect, with a precise workspace-relative file and tight line range. Do not use for praise or summaries. Include replacement only when an exact edit is safe.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Short actionable title.' },
                body: { type: 'string', description: 'One paragraph explaining impact and trigger.' },
                path: { type: 'string', description: 'Workspace-relative file path.' },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
                priority: { type: 'integer', enum: [0, 1, 2, 3] },
                replacement: {
                    type: 'string',
                    description: 'Optional exact replacement text for the cited line range.',
                },
            },
            required: ['title', 'body', 'path', 'startLine', 'endLine', 'priority'],
        },
    },
    async execute(input) {
        const finding = parseFinding(input);
        if (!finding)
            return { content: 'Error: invalid review finding.', isError: true };
        return {
            content: `Recorded ${finding.path}:${finding.startLine} — ${finding.title}`,
            data: { finding },
        };
    },
};
function parseFinding(input) {
    const { title, body, path, startLine, endLine, priority, replacement } = input;
    if (typeof title !== 'string' ||
        title.length === 0 ||
        title.length > 160 ||
        hasControlCharacter(title) ||
        typeof body !== 'string' ||
        body.length === 0 ||
        body.length > 4000 ||
        typeof path !== 'string' ||
        !safeRelativePath(path) ||
        !Number.isInteger(startLine) ||
        !Number.isInteger(endLine) ||
        startLine < 1 ||
        endLine < startLine ||
        endLine - startLine > 200 ||
        !Number.isInteger(priority) ||
        ![0, 1, 2, 3].includes(priority) ||
        (replacement !== undefined &&
            (typeof replacement !== 'string' || Buffer.byteLength(replacement) > 32 * 1024))) {
        return null;
    }
    return {
        title,
        body,
        path,
        startLine: startLine,
        endLine: endLine,
        priority: priority,
        ...(typeof replacement === 'string' ? { replacement } : {}),
    };
}
function safeRelativePath(path) {
    if (path.length === 0 ||
        path.length > 500 ||
        hasControlCharacter(path) ||
        isAbsolute(path) ||
        /^[a-zA-Z]:[\\/]/.test(path)) {
        return false;
    }
    return !path.split(/[\\/]/).some((part) => part === '..' || part === '');
}
function hasControlCharacter(value) {
    return [...value].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
    });
}
//# sourceMappingURL=review-finding.js.map