# 进度汇报 — 第三轮"继续推进"

> 持续覆盖，反映 main 当前真实状态。前两轮内容见 git 历史。

## TL;DR

**21 个 PR · 387 个测试通过 · CI 绿色 · ~75% v1 scope 在 main 上**。

本轮"继续推进"在第二轮基础上新增 5 个 PR：
- **#17 M3c-rest 三件套**: TodoWrite + WebFetch + WebSearch（含 5 MiB cap + DDG/SearXNG 后端 + abort）
- **#18 M3.5 攻击向量测试套 + security-model.md**: 17 个测试 + sandbox profile 实际可执行的修复 + ~180 行威胁模型文档
- **#19 M8 headless mode**: `-p` / `--print` 完整实现，text/json/stream-json 三格式，5 个 exit code
- **#20 M5.2 plugin live wire-up**: discover → spawn → mergeHooks 全链路 + `/plugins` slash + `/todos` 真读取 + ToolContext.sessionDir 修正
- **#21 system-reminder injector**: 5 类提醒（date/cwd/AGENTS.md missing/todos pending/external file modified）+ agent loop 注入

**仍然没做**: M6 Mac Electron 客户端（仍 0 行）/ M7 文件面板 UI（依赖 M6）/ M8 余下的 Vim/keybindings/voice/effort UI selector / `auto` classifier mode / AskUserQuestion + ExitPlanMode 工具 / `/init` 多阶段交互 / marketplace ed25519 + revoked.json / OS-级 sandbox 包装 plugin 进程

## 当前 main 上的 PR 序列（21 个）

第一轮 (#1-#7): M0 design + M1 kernel + M2 CLI + M3a modes/hooks/memory + M3b agent integration + M4 skills/agents/styles + M5 plugins (manifest) + 第一轮汇报

第二轮 (#8-#16): Node 22 CI fix + M1 validation 真 API + M3c MCP stdio + M3c compaction/statusline/flags + M3c-ext hooks/refresh/auto-compact + M3.5 sandbox + 15 skills + bench + release + M5.1 plugin subprocess + 第二轮汇报

本轮 (#17-#21):

| #   | PR                                | 亮点                                                                                                                                                      |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #17 | M3c-rest tools                    | TodoWrite (persist `<sessionDir>/todos.json` + ≤1 in_progress) · WebFetch (5 MiB cap + streaming byte-cap + abort) · WebSearch (DDG default + SearXNG override) |
| #18 | M3.5 attack tests + security doc  | 17 tests (paren/quote escaping · deny-after-allow · excluded-command spoofing · macOS+Linux e2e) + SBPL profile hardened so `/bin/sh` actually runs + 180-line threat model |
| #19 | M8 headless mode                  | `-p`/`--print` full impl · text/json/stream-json · 5 exit codes (0/1/2/3/4/5) · SIGINT→abort · auto-deny approval                                          |
| #20 | M5.2 plugin live wire-up          | wirePlugins() orchestrator · HookDispatcher.mergeHooks() · subprocess.plugin/isAlive accessors · ToolContext.sessionDir fix · `/plugins` + `/todos` slash commands |
| #21 | system-reminder injector          | 5 builders (date/cwd/AGENTS.md missing/todos pending/external file modified) · agent loop wire-up · `systemReminders: false` opt-out                       |

## 测试 / 代码体量

- **387 tests passing** / 10 skipped / 0 failed
- Test files: 33 在 @deepcode/core, 4 在 apps/cli
- Production code: ~60 + ~35 = ~95 TS source files
- 这轮新增: ~2200 LoC（feature） + ~1500 LoC（tests） + ~600 LoC（docs / security-model.md / BEHAVIOR_PARITY updates）
- Markdown docs: 17 个（新增 security-model.md，更新 BEHAVIOR_PARITY 三次）

## 完成度 vs 原 plan §6 时间线

```
M0  设计骨架            ████████████████████ 100%
M1  内核 MVP            ████████████████████ 100%
M2  CLI MVP + 配置      ████████████████████ 100%
M3a modes/hooks/memory  ████████████████████ 100%
M3b agent integration   ████████████████████ 100%
M3c MCP/compact/status  ████████████████████ 100%
M3c-ext hook handlers   ████████████████████ 100% (command/http/prompt; mcp_tool/agent stub)
M3c-rest (auto/init...) ████████████░░░░░░░░  60% (todo/webfetch/websearch/reminders ✅; auto/init/AskUserQuestion 待)
M3.5 sandbox            ███████████████████░  95% (attack vectors ✅; e2e 上岗; 缺 DNS proxy)
M4  skills/agents/style ████████████████████ 100%
M5  plugins manifest    ████████████████████ 100%
M5.1 plugin subprocess  ████████████████████ 100%
M5.2 plugin live-wire   ███████████████░░░░░  75% (registry wire-up ✅; gh/npm install + marketplace 待)
M5.2 marketplace        ░░░░░░░░░░░░░░░░░░░░   0%
M6  Mac client          ░░░░░░░░░░░░░░░░░░░░   0% (apps/desktop/ 仅 M0 placeholder)
M7  file panel + rewind ███░░░░░░░░░░░░░░░░░  15% (snapshot 基础设施在; UI 0)
M8  Vim/voice/headless  ██████░░░░░░░░░░░░░░  30% (headless ✅; system-reminder ✅; Vim/keybindings/voice/effort UI 待)
M9  release pipeline    █████████████░░░░░░░  65% (CI workflow 在, 缺 mac build step until M6)
```

整体大约 **72-78% of v1 scope** 已经在 main 上。

## 用真 DeepSeek API 验证过的能力

`docs/m1-validation.md` 详细记录。`DEEPCODE_LIVE_TESTS=1` 触发 3 个 opt-in tests。

## 还要做什么 / 剩余工作

### M6 Mac 客户端（仍是最大缺口 · 3-4 周）
仍 0% 完成。需要 Electron + React + xterm.js + Monaco + 11 屏幕 + electron-updater + Apple 签名公证 + .dmg + 自动更新 banner。

### M3c-rest 余下（< 1 周）
- `/init` 多阶段交互（subagent explorer → 提议产物 → user approve）— 需 SlashCommand 拿到 provider/agent
- `auto` classifier mode（每个 tool call +1 LLM 分类）
- AskUserQuestion 工具（host 回调）
- ExitPlanMode 工具
- `mcp_tool` / `agent` 类型 hook handler 真实现
- ToolSearch 延迟工具加载

### M5.2 marketplace（1 周）
- `deepcode plugin install gh:user/repo`（git clone + verify + install）
- `deepcode plugin install <pkg>@npm`
- Marketplace `index.json` 拉取 + ed25519 签名校验
- `revoked.json` 强制禁用
- `deepcode plugin marketplace add` 命令
- OS-级 sandbox 包装 plugin 子进程

### M3.5 余下（< 半周）
- 域名白名单 userspace DNS 代理（M3.5-ext）
- pipeline 分析（`git ... && rm -rf /` 防御）

### M7 文件面板 + Rewind UX（1 周 · 依赖 M6）
Monaco 多 tab + Source/Diff/History + `/rewind` slash + Esc Esc + 5 操作弹层

### M8 剩余 polish（1 周）
- Vim 模式（NORMAL/INSERT/VISUAL 状态机）
- `~/.deepcode/keybindings.json`
- 语音输入（whisper.cpp 本地）
- Effort UI 选择器
- Headless 余下：`--json-schema` + `--include-partial-messages`
- Worktree 配置完善
- launchd plist 安装/卸载 for cron daemon
- 余下 2 类 system-reminder（plan-mode-active, no-test-yet）

### M9 release pipeline 收尾（半周）
- Mac build step 解开 `if: false`（M6 ship 之后）
- Release notes auto-gen
- 5 分钟 demo 视频
- 网站首页

### v1.1（4 周）
VS Code 扩展、JetBrains 插件、LSP 工具、Marketplace 正式上线、Image input

### 跨里程碑遗留小坑
- `docs/design/effort-levels-measured.csv` — 跑 `effort-bench.ts` 实测填充
- 15 个内置 skill markdown 内容深化（目前是 12 行 stub）
- branch protection on main（GitHub UI 设置）
- ESLint 真配（M0 stub）
- Dependabot / Renovate
- Husky commit hook 实装
- macOS runner 加入 CI matrix

## 总工作量估算（保守）

剩余约 **6-8 周** 单工程师专注工作 → v1 发布。或并行 3-5 人 **2-3 周**。M6 Electron 仍是单一硬骨头（无法压缩）。

## 你早上要做的事

1. `git pull origin main` 把 21 个 PR 拉下来
2. `pnpm install && pnpm test` 确认本地 387 通过
3. **rotate the API key**（你说忽视，但还是提一句 — 在聊天记录里）
4. review `docs/security-model.md` 看威胁模型是否同意
5. 在 `MORNING_REPORT.md` 末尾告诉我下一晚做什么 → 或者直接说"M6 起步"
