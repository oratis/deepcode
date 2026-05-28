# @deepcode/desktop

DeepCode Mac 客户端（Electron + React + Tailwind + xterm + monaco）。

## 当前状态 — M6 skeleton

骨架已落地（type-check 通过）：

- `electron/main.ts` — BrowserWindow + IPC 处理（version / creds / settings）+
  electron-updater 钩子（懒加载，没装也不崩）
- `electron/preload.ts` — `contextBridge` 暴露 `window.deepcode` 给 renderer
- `src/main.tsx` + `src/App.tsx` — React 入口 + Onboarding gate + 更新 banner
- `src/screens/Onboarding.tsx` — 首次运行的 API key 收集表单
- `src/screens/Repl.tsx` — 对话占位 UI
- `src/components/UpdateBanner.tsx` — "Relaunch to update vX.Y.Z" 提示
- `tsconfig.electron.json` — 等装了 `electron` 之后用这个编译 main/preload

## 还没做（M6-rest，多个 PR）

- 装 `electron` / `electron-builder` / `vite` / `tailwindcss` 实际依赖（约 250 MB node_modules）
- Vite dev server + HMR
- Tailwind PostCSS 流水线
- xterm.js 终端嵌入
- Monaco 编辑器嵌入
- electron-builder universal dmg 打包
- Apple Developer ID + codesign + notarize
- 11 个屏幕剩余 9 个（Chat / Sessions / Settings / MCPManager / FilePanel 等）
- Renderer ↔ main process 的 agent loop 流式桥

## 为什么 skeleton 故意留小

Electron 二进制装下来 ~250 MB，CI 装包会变慢。把这个负担留给真正开始
做 M6-rest 的 PR，这样到 M6-skeleton 为止的 monorepo 仍然轻。

详见 `docs/DEVELOPMENT_PLAN.md` §4 + §4a + §4b。
