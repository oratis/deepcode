# @deepcode/desktop

DeepCode Mac 客户端（**Tauri 2 + React 18 + Vite**）。

> M6 从 Electron 切到了 Tauri（见 #58）。如果你看到任何提到 Electron /
> Tailwind / `*.template.*` 的旧资料，那是历史包袱，以本文为准。

## 架构

```
src/                 renderer（React + Vite，无 Tailwind，手写设计系统）
  main.tsx           入口
  App.tsx            Onboarding gate + 屏幕路由 + 更新 banner
  index.css          设计系统（tokens + 组件样式，镜像 docs/VISUAL_DESIGN.html）
  screens/           About / MCPManager / Onboarding / Permissions /
                     Plugins / Repl / Sessions / Settings / Skills
  components/        Sidebar / InspectorRail / ToolCard / UpdateBanner …
  lib/               tauri-api（renderer↔Rust IPC 封装）· mac-agent ·
                     mac-tools · repl-stream · updater …
src-tauri/           Rust 主进程
  src/commands.rs    #[tauri::command] —— renderer 通过 invoke() 调用
  src/credentials.rs 凭据读写（原子写入）
  src/settings.rs    设置持久化
  src/tools.rs       工具实现
  src/lib.rs         Tauri builder / 插件注册
  tauri.conf.json    窗口 + 构建 + 打包配置
  capabilities/      权限能力声明
  Entitlements.plist hardened-runtime entitlements（公证用）
```

renderer ↔ Rust 的 IPC 边界由 `src/lib/tauri-api.ts` 封装，契约测试见
`src/lib/tauri-api.test.ts`（#84）。

## 开发

依赖在 monorepo 根 `pnpm install` 一次装好；Rust 工具链 + Tauri CLI 见下。

| 命令                         | 作用                                               |
| ---------------------------- | -------------------------------------------------- |
| `pnpm dev`                   | 仅 Vite dev server（5173）—— 一般由 Tauri 自动拉起 |
| `pnpm tauri:dev`             | 完整 app：Tauri 启 dev server + 原生窗口，热重载   |
| `pnpm build`                 | `tsc -b` + `vite build` → `dist/`（renderer 产物） |
| `pnpm tauri:build`           | 当前架构的 .app / .dmg                             |
| `pnpm tauri:build:universal` | universal-apple-darwin 通用二进制                  |
| `pnpm typecheck`             | `tsc -b`                                           |
| `pnpm test`                  | `vitest run`（lib 单测 + IPC 契约测试）            |

`tauri.conf.json` 里 `beforeDevCommand` / `beforeBuildCommand` 分别接
`pnpm dev` / `pnpm build`，所以平时只跑 `pnpm tauri:dev` 即可。

### 前置工具

- Node ≥ 22、pnpm
- Rust 工具链（`rustup`）—— Tauri 主进程是 Rust
- 通用构建需 `rustup target add aarch64-apple-darwin x86_64-apple-darwin`

## 打包 / 签名

- 产物配置在 `src-tauri/tauri.conf.json`，公证 entitlements 在
  `src-tauri/Entitlements.plist`。
- 签名 + 公证需要 Apple Developer ID 证书，以及 `APPLE_ID` /
  `APPLE_APP_SPECIFIC_PASSWORD` 等环境变量（CI 走 secrets）。

详见 `docs/DEVELOPMENT_PLAN.md` §4 / §4a / §4b。
