# @deepcode/desktop

DeepCode Mac 客户端（Electron + React + Tailwind + xterm + monaco）。

## 当前状态 — M6 skeleton + M6-rest build pipeline

骨架 + 构建配置已就位（type-check 通过）：

- `electron/main.ts` — BrowserWindow + IPC（version / creds / settings）+
  懒加载 electron-updater 钩子
- `electron/preload.ts` — `contextBridge` 暴露 `window.deepcode` 给 renderer
- `src/main.tsx` + `src/App.tsx` — React 入口 + Onboarding gate + 更新 banner
- `src/screens/Onboarding.tsx` / `src/screens/Repl.tsx`
- `src/components/UpdateBanner.tsx`
- `src/index.html` + `src/index.css`（含 Tailwind directives）
- `vite.config.ts` — renderer 构建（dev server 5173 + prod build → dist/）
- `tailwind.config.ts` + `postcss.config.js`
- `tsconfig.json`（renderer）+ `tsconfig.electron.json`（main process）
- `electron-builder.yml` — universal .dmg + Apple 公证 + GitHub Releases
- `build-resources/entitlements.mac.plist` — hardened-runtime entitlements

## 装实际依赖（M6-rest 启动）

构建配置以 `*.template.{ts,js}` 后缀存在（避免没装依赖时被 vitest/postcss
自动加载报错）。要真正能 dev + ship 还需要装这些 ~250 MB 二进制依赖：

```bash
pnpm add -D --filter @deepcode/desktop \
  electron electron-builder electron-updater \
  vite @vitejs/plugin-react \
  tailwindcss postcss autoprefixer \
  concurrently wait-on

# 然后把 template 后缀去掉激活
mv apps/desktop/vite.config.template.ts apps/desktop/vite.config.ts
mv apps/desktop/postcss.config.template.js apps/desktop/postcss.config.js
```

之后：

| 命令             | 作用                                                  |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Vite dev server + electron 自动重载                   |
| `pnpm build:all` | 构建 renderer (dist/) + main process (dist-electron/) |
| `pnpm pack`      | 打包未签名 .app（本地测试）                           |
| `pnpm dist`      | 完整签名 + 公证 + .dmg（需要 Apple Developer ID）     |

## 还没做（M6-rest 余下任务）

- xterm.js + node-pty 嵌入终端
- Monaco 编辑器嵌入
- 余下 8 个屏幕（Chat / Sessions / Settings / MCPManager / FilePanel 等 ·
  Onboarding + REPL 已有）
- Renderer ↔ main process 的 agent loop 流式桥（让 chat 真能跑）
- Apple Developer ID 证书 + APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD 写入 CI secrets
- .github/workflows/release.yml 的 mac build step 解开 `if: false`
- `electron-updater` 真接 GitHub Releases feed（main.ts 已经有钩子）
- 11 屏的视觉稿落地（参考 docs/VISUAL_DESIGN.html）

## 为什么 skeleton 故意留小

Electron 二进制装下来 ~250 MB，CI 装包会变慢。把这个负担留给真正开始
做 M6-rest 的 PR（这一个！）—— 你可以一次安装所有依赖，开始迭代 UI。

详见 `docs/DEVELOPMENT_PLAN.md` §4 + §4a + §4b。
