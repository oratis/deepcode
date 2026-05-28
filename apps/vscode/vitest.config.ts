// No tests yet (extension runs in VS Code host; integration tests need
// @vscode/test-electron which is heavy).
export default {
  test: { include: ['src/**/*.test.ts'] },
  configFile: false,
} as const;
