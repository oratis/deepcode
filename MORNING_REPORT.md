# 进度汇报 — 第五轮"继续推进"

> 持续覆盖。前四轮内容见 git 历史。

## TL;DR

**48 个 commits / 38+ feature PRs · 508 个测试通过 · CI 双平台绿色 · ~95% v1 scope 在 main 上**。

本轮在第四轮 33 PR 基础上又推了 4 个 feature PR + 几个 dependabot 合并：

| # | 标题 | 主要内容 |
| --- | --- | --- |
| #46 | fix: worktree git env-var leak | husky pre-commit 上下文里 `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` 泄漏给子进程；strip GIT_* env 在 runGit 和 runOrFail 里；worktree 测试不再 gated（5 个测试回到默认套件） |
| #47 | feat: M9 + M3.5-ext + M8 三件套 | gen-release-notes 脚本（conventional-commit 分桶）+ DNS proxy (UDP NXDOMAIN scaffold) + `/effort` 交互选择器表格 |
| #48 | feat(desktop): M6-rest part 1 | vite.config + tailwind.config + postcss.config + electron-builder.yml + entitlements.plist + index.html (CSP) — 全部 build 配置就位，`.template` 后缀避免依赖未装时的 vitest 故障 |
| #49 | feat: M6-rest part 2 + M8 voice | WhisperCppProvider + VoiceProvider 接口 + parseWhisperOutput（CLI spawn, 没有 binary 依赖） + Sessions/Settings/MCPManager/Chat 4 个屏幕 + Nav 顶栏 |

## 状态对照

- **测试**: 471 默认 / 476 含 worktree gated → **508 默认**（worktree 解 gate；voice +7；DNS +9；release-notes +16）
- **PR 总数**: 33 → **38 feature PRs（+ dependabot 维护 PRs）**
- **v1 scope 完成度**: ~92% → **~95%**
- **CI**: ubuntu + macOS 双矩阵 + lint enforced + 无 gated tests

## 完成度 vs 原 plan §6 时间线

```
M0-M5.2 + M3.5 + M4   ████████████████████ 100%
M3c-rest              ████████████████████ 100%
M8 polish             ████████████████████ 100% (vim/keybindings/voice scaffold/headless/worktree/launchd 全部 ✅)
M6 Mac client         █████████████░░░░░░░  65% (skeleton + 6/11 屏幕 + 全部 build 配置就位 ·
                                                   剩下: 安装 ~250MB 依赖 + Vite/Tailwind 激活 +
                                                   余下 5 屏 + agent loop 流式 IPC + 签名公证)
M7 文件面板           ███░░░░░░░░░░░░░░░░░  15% (依赖 M6 完成)
M9 release            ███████████████░░░░░  75% (CI matrix + dependabot + release-notes 脚本 ✅;
                                                   mac build step 等 M6 ship)
```

整体大约 **95% of v1 scope** 已经在 main 上。真正剩下的是 M6 Mac 客户端
"装依赖 + 写最后 5 屏 + 流式 IPC + Apple 签名公证 + .dmg" 这一段工程量；
代码骨架、构建配置、所有上游 hook 都在了。

## 用真 DeepSeek API 验证过的能力

`docs/m1-validation.md` 详细记录。`DEEPCODE_LIVE_TESTS=1` 触发 3 个 opt-in tests。

## 剩余 Todo（按优先级）

### 一、M6-rest 余下工程（2-3 周 · 单一最大块）

具体步骤已在 `apps/desktop/README.md` 列出。一句话：

```bash
pnpm add -D --filter @deepcode/desktop \
  electron electron-builder electron-updater \
  vite @vitejs/plugin-react \
  tailwindcss postcss autoprefixer \
  concurrently wait-on

mv apps/desktop/vite.config.template.ts apps/desktop/vite.config.ts
mv apps/desktop/postcss.config.template.js apps/desktop/postcss.config.js
```

然后：
1. `pnpm dev` 验证 vite + electron 联调
2. 写 renderer ↔ main 的 agent loop 流式桥（让 chat 真能跑）
3. 写余下 5 个屏幕（FilePanel / Plugins / Skills / Permissions / About — 视觉稿在 `docs/VISUAL_DESIGN.html`）
4. 嵌 xterm.js + node-pty 实现终端
5. 嵌 Monaco 实现 file panel（M7 实质）
6. Apple Developer ID + APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD 写入 CI secrets
7. `electron-builder.yml` 已配置好；`.github/workflows/release.yml` 的 mac build step 解开 `if: false`
8. 真录 5 分钟 demo 视频
9. 网站首页

### 二、跨里程碑遗留小坑

- `docs/design/effort-levels-measured.csv` — 跑 `effort-bench.ts` 实测填充（消耗少量 API token，看用户决定）
- **branch protection on main** — GitHub UI 设置（不能 PR 改）
- whisper.cpp binary + 模型下载文档（已有 wrapper，没有装包指引）
- DNS proxy 与 sandbox-exec / bwrap 的 resolv.conf 集成（现在是独立 UDP 服务器）

### 三、v1.1（4 周）

VS Code 扩展、JetBrains 插件、LSP 工具、Marketplace 正式上线、Image input

## 总工作量估算（保守）

剩余约 **2-3 周** 单工程师专注 → v1 真发布。Mac 客户端是单一硬骨头；
其余基本是配置 + 文档。

## 你早上要做的事

1. `git pull origin main` 把 48+ commits 拉下来
2. `pnpm install && pnpm test` 确认本地 508 通过
3. **rotate the API key**（一直提一句）
4. 给 GitHub repo 加 branch protection（`main`：require PR + green CI）
5. 决定 Mac 客户端依赖什么时候装（M6-rest 启动信号）
6. 准备 Apple Developer 账号 + APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD 写到 CI secrets
