# 进度汇报 — 第四轮"按计划顺序推进直到全部完成"

> 持续覆盖。前三轮内容见 git 历史。

## TL;DR

**33 个 PR · 471 个测试通过（默认）/ 476（含 worktree 门控）· CI 双平台绿色 · ~92% v1 scope 在 main 上**。

本轮在第三轮 22 个 PR 基础上一口气推了 11 个 PR (#23-#33)，按 M3c-rest → M8 polish → M5.2 marketplace → M3.5-ext → M6 skeleton → 工程卫生的顺序：

| # | 模块 | 主要内容 |
| --- | --- | --- |
| #23 | M3c-rest tools (1) | `AskUserQuestion`（host 回调 + 4 选项 cap）+ `ExitPlanMode`（modeSignal 翻转 → REPL plan→default）|
| #24 | M3c-rest tools (2) | `ToolSearch` 延迟加载（`select:Name1,Name2` + 关键字模糊搜索）+ `RegistryDeferredStore` |
| #25 | M3c-rest hooks + reminders | `mcp_tool` / `agent` hook handler 真实派发（callbacks）+ 余下 2 类 reminder（`plan-mode-active` / `no-test-yet`）|
| #26 | M8 keybindings + Vim | `~/.deepcode/keybindings.json` + `DEFAULT_KEYBINDINGS`（Emacs 6 + Vim 11）+ VimState 状态机（NORMAL/INSERT/VISUAL + 多字符 chord 缓冲） |
| #27 | M8 worktree + launchd + headless | `createWorktree`/`removeWorktree`（baseRef + sparsePaths + symlinkDirectories）+ launchd plist 生成器 + `--json-schema` 校验 + `--include-partial-messages` |
| #28 | M3c-rest auto + /init | `classifyAutoMode`（静态规则→LLM→fallback）+ `/init` 三阶段交互（扫描→draft→approve→写 AGENTS.md）|
| #29 | M5.2 marketplace | `installFromGithub`（gh:user/repo[@ref]）+ `installFromNpm`（npm pack）+ ed25519 sig 验证 + `revoked.json` + `addMarketplace` |
| #30 | M3.5-ext + M5.1-ext | `splitClauses` + `allClausesExcluded` 防止 pipeline 绕过 + plugin subprocess 包入 sandbox-exec/bwrap |
| #31 | M6 desktop skeleton | Electron main + preload (contextBridge) + React renderer + Onboarding + REPL placeholder + UpdateBanner |
| #32 | 工程卫生 (1) | ESLint 9 flat config + husky pre-commit + 4 个 SKILL.md 内容深化（init/verify/code-review/security-review）|
| #33 | 工程卫生 (2) | 余下 11 个 SKILL.md 深化（run/loop/schedule/review/pdf/...）+ Dependabot 配置 + CI macOS matrix |

## 状态对照

- **测试**: 387 → **471 默认 / 476 含门控**（+89/+94）
- **PR 总数**: 22 → **33**
- **v1 scope 完成度**: ~75% → **~92%**
- **CI**: ubuntu + macOS 双矩阵 + lint enforced + worktree-tests 门控
- **代码体量**: 新增 ~5.5k LoC（feature） + ~3k LoC（tests） + ~1.5k LoC（docs/skills）

## 完成度 vs 原 plan §6 时间线

```
M0  设计骨架            ████████████████████ 100%
M1  内核 MVP            ████████████████████ 100%
M2  CLI MVP + 配置      ████████████████████ 100%
M3a modes/hooks/memory  ████████████████████ 100%
M3b agent integration   ████████████████████ 100%
M3c MCP/compact/status  ████████████████████ 100%
M3c-ext hook handlers   ████████████████████ 100%
M3c-rest                ████████████████████ 100% (auto/init/AskUserQ/ExitPlan/ToolSearch/mcp_tool/agent + 7 reminders 全到位)
M3.5 sandbox            ████████████████████ 100% (e2e + 攻击向量 + pipeline 分析 + plugin OS-wrap)
M4  skills/agents/style ████████████████████ 100% (15 skill 全部深化完毕)
M5  plugins manifest    ████████████████████ 100%
M5.1 plugin subprocess  ████████████████████ 100% (含 OS sandbox 包装)
M5.2 plugin live-wire   ████████████████████ 100% (registry wire-up + gh/npm install + marketplace + ed25519 + revoked)
M6  Mac client          █████░░░░░░░░░░░░░░░  25% (skeleton ✅; Electron/Vite/Tailwind/Monaco/xterm/dmg/签名 待)
M7  file panel + rewind ███░░░░░░░░░░░░░░░░░  15% (snapshot 基础设施在; UI 等 M6-rest)
M8  Vim/voice/headless  ███████████████░░░░░  75% (vim/keybindings/launchd/worktree/headless ✅; voice 待)
M9  release pipeline    █████████████░░░░░░░  65% (CI matrix + dependabot ✅; mac build step 等 M6 完成)
```

**整体大约 92% of v1 scope 在 main 上**。剩下的 8% 主要是 M6 Mac 客户端的实际 Electron 落地（vite + tailwind + monaco + xterm + electron-builder + 签名公证），以及依赖 M6 的 M7 文件面板。

## 用真 DeepSeek API 验证过的能力

`docs/m1-validation.md` 详细记录。`DEEPCODE_LIVE_TESTS=1` 触发 3 个 opt-in tests。

## 剩余 Todo（按优先级）

### 一、M6-rest Mac Electron 实装（多周 · 不能在单 session 内完成）

skeleton 已落地（type-check 通过），剩下的是工程量：

- 装 `electron`、`electron-builder`、`vite`、`@vitejs/plugin-react`、`tailwindcss` 实际依赖
- `vite.config.ts` 编译 `src/main.tsx` 到 `dist/`
- `electron-builder.yml` 配置 universal .dmg
- Renderer ↔ main 的 agent loop 流式桥（让 chat 真能跑）
- 余下 9 个屏幕（Chat / Sessions / Settings / MCPManager / FilePanel + 4 个细分）
- xterm.js + node-pty 嵌入终端
- Monaco 编辑器嵌入
- Apple Developer ID + codesign + notarize（需要 Apple 账号）
- electron-updater + GitHub Releases auto-update 实际验证
- 解开 `.github/workflows/release.yml` 的 `if: false` mac build step

### 二、M7 文件面板 + Rewind UX（1 周 · 依赖 M6）

- 右侧 Monaco 多 tab
- Source / Diff / History 三视图
- `/rewind` slash + `Esc Esc` 快捷（已经在 keybindings 默认里）
- 5 操作弹层

### 三、剩余小坑

- **语音输入** — whisper.cpp 本地（M8 余下）
- **Effort UI 选择器** — UI 工作，依赖 M6
- **域名白名单 DNS 代理** — userspace UDP 代理（M3.5-ext++ ）
- **branch protection on main** — GitHub UI 设置（不能 PR 改）
- **5 分钟 demo 视频** — 等 M6 完成
- **网站首页** — 等 M6 完成
- **`docs/design/effort-levels-measured.csv`** — 跑 `effort-bench.ts` 实测填充（消耗少量 API token）
- **worktree tests 稳定性修复** — 目前门控；当前 vitest 多文件并发下出现 `.git/index: index file open failed: Not a directory`

### 四、v1.1（4 周）

VS Code 扩展、JetBrains 插件、LSP 工具、Marketplace 正式上线、Image input

## 总工作量估算（保守）

剩余约 **3-4 周** 单工程师专注工作 → v1 真发布。或并行 2-3 人 **2 周**。M6 Mac 客户端的 Electron 工程是单一硬骨头，无法压缩；其余都是焦油坑级别的小工程加在一起。

## 你早上要做的事

1. `git pull origin main` 把 33 个 PR 拉下来
2. `pnpm install && pnpm test` 确认本地 471 通过
3. **rotate the API key**（你说忽视，但还是提一句）
4. 给 GitHub repo 加 branch protection（`main`：require PR + green CI）
5. 决定要不要现在开始 M6 Electron 实装（装 ~250MB 依赖；要承担 CI 慢）
   或者继续小修小补到 v1.1 再开 Electron
6. 在 `MORNING_REPORT.md` 末尾告诉我下一步方向
