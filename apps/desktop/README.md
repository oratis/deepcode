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
  lib/               tauri-api（renderer↔Rust IPC 封装）· protocol-client ·
                     protocol-agent · repl-stream · updater …
src-tauri/           Rust 主进程
  src/app_server.rs  bundled runtime 启停、stdio 与 crash event
  src/commands.rs    #[tauri::command] —— renderer 通过 invoke() 调用
  src/credentials.rs 凭据保存与无密钥状态查询
  src/settings.rs    设置持久化
  src/tools.rs       legacy native helpers（renderer 仅暴露只读 file read）
  src/lib.rs         Tauri builder / 插件注册
  tauri.conf.json    窗口 + 构建 + 打包配置
  capabilities/      权限能力声明
  Entitlements.plist hardened-runtime entitlements（公证用）
```

renderer ↔ Rust 的 IPC 边界由 `src/lib/tauri-api.ts` 封装，契约测试见
`src/lib/tauri-api.test.ts`（#84）。

app-server 由 Tauri 作为 target-specific sidecar 监督。`apps/server` 会被打成单个
`app-server.cjs` resource，Node runtime 通过 `bundle.externalBin` 进入 `.app`；renderer 只能通过
Rust commands 与版本化协议通信，不能直接使用 shell plugin。provider、agent loop、tools、权限、
session materialization 和凭证明文都只存在于 sidecar；renderer 不再带有第二套运行时。

## 开发

依赖在 monorepo 根 `pnpm install` 一次装好；Rust 工具链 + Tauri CLI 见下。

| 命令                         | 作用                                               |
| ---------------------------- | -------------------------------------------------- |
| `pnpm dev`                   | 仅 Vite dev server（5173）—— 一般由 Tauri 自动拉起 |
| `pnpm tauri:dev`             | 完整 app：Tauri 启 dev server + 原生窗口，热重载   |
| `pnpm build`                 | `tsc -b` + `vite build` → `dist/`（renderer 产物） |
| `pnpm tauri:build`           | 构建包含 runtime + app-server 的 `.app`            |
| `pnpm tauri:build:universal` | universal-apple-darwin 通用二进制                  |
| `pnpm typecheck`             | `tsc -b`                                           |
| `pnpm test`                  | `vitest run`（lib 单测 + IPC 契约测试）            |

`tauri.conf.json` 的 dev/build hooks 会先生成 app-server bundle 和目标 runtime，再启动 Vite 或
Tauri release build，所以平时只跑 `pnpm tauri:dev` 即可。

### 前置工具

- Node ≥ 22、pnpm
- Rust 工具链（`rustup`）—— Tauri 主进程是 Rust
- 通用构建需 `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- 通用构建还要求 `DEEPCODE_NODE_RUNTIME` 指向同时含 arm64/x86_64 的通用 Node binary

## 打包 / 签名

- 产物配置在 `src-tauri/tauri.conf.json`，公证 entitlements 在
  `src-tauri/Entitlements.plist`。
- 签名 + 公证需要 Apple Developer ID 证书，以及 `APPLE_ID` /
  `APPLE_APP_SPECIFIC_PASSWORD` 等环境变量（CI 走 secrets）。
- release CI 固定 Node 22.23.1，校验官方 SHA256 后才进入 Tauri 打包；nested runtime 先签，outer
  `.app` 后签，再做 strict deep verification 与 notarization。

详见 `docs/DEVELOPMENT_PLAN.md` §4 / §4a / §4b。
