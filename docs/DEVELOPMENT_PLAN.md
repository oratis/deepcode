# DeepCode 开发方案 v0.5

> **一句话定位**：DeepCode 是 Claude Code 的 DeepSeek 版 —— 整体复刻 Claude Code 的全部能力（agent loop / 工具调用 / MCP / 子代理 / hooks / 沙箱 / 会话恢复 / 上下文压缩 / 审批模式 / skills / plugins / harness / 输出风格 / checkpointing），但底层 LLM 全面切换到 **DeepSeek**，提供 **Mac 客户端 + Node.js CLI** 双形态（v1.1 追加 VS Code + JetBrains IDE 扩展），用户首次启动即填入 `DEEPSEEK_API_KEY` 立即可用。Mac 客户端支持 **Claude Code 式自动更新**（后台拉新版 → "Relaunch to update vX.Y.Z" 浮层 → 一键重启升级）。所有 release 走 **GitHub Releases**。

> **变更记录**：
>
> - v0.1 初稿
> - v0.2 加入 settings.json 全集 + modes + composer + 右侧面板
> - v0.3 加入 skills + plugins + harness
> - v0.4 基于 Claude Code 全文档审计补齐 51 项缺失能力
> - **v0.5 自我 review 后修正**：image input 推迟到 v1.1（DeepSeek 无 vision 模型）/ 每个里程碑增加测试与文档行 / 明确 Windows 为非目标 / 新增自动更新机制（§4b）/ 新增 GitHub Releases 发布流程（§6a）/ 新增 3 份 M0 必须产出的设计文档（sandbox×plan×worktree 关系、plugin 安全模型、effort levels 数字核实）/ 明确团队规模假设（§0.4）。

## 0. 目标与约束

### 0.1 必须达成（MUST）

1. **能力对等**：用户在 Claude Code 中能做的事，在 DeepCode 中以完全相同的体验做到 —— 包括但不限于：
   - **基础工具**：Read / Write / Edit / Bash（含 `run_in_background` + `⌃B`）/ Grep / Glob / WebFetch / WebSearch / TodoWrite / Task（子代理）/ NotebookEdit / **AskUserQuestion** / **EnterPlanMode / ExitPlanMode** / **EnterWorktree / ExitWorktree** / **ToolSearch** / **TaskCreate** 全系 / **CronCreate** 全系 / **ScheduleWakeup** / resume sessions / context compaction
   - **配置**：`settings.json` 全集（§3.9，~50 字段；不含 managed/MDM 层 — 见 §0.2）；**permission glob 语法两种**（`Bash(git diff:*)` 子命令匹配 / `Bash(git diff *)` 前缀匹配）
   - **运行模式**：5 档 mode + **auto 分类器**（§3.8：default / acceptEdits / plan / auto / dontAsk / bypassPermissions）
   - **Hooks**：**9 类事件**（§3.6：PreToolUse / PostToolUse / Stop / SubagentStop / PreCompact / PostCompact / SessionStart / SessionEnd / UserPromptSubmit / Notification）× **5 种 handler 类型**（command / http / mcp_tool / prompt / agent）+ `if` 字段 + 结构化 JSON 输出契约
   - **Slash commands**：30+ 内置 + 用户/项目/插件自定义命令文件 `.deepcode/commands/*.md`（§3.6）
   - **Memory 系统**：双系统 — 用户写的 `DEEPCODE.md`（递归 + @-import + AGENTS.md 互操作）+ agent 写的 `~/.deepcode/projects/<repo>/memory/MEMORY.md` + `.deepcode/rules/*.md` path-scoped（§3.6a）
   - **Skills**（§3.13）：丰富 frontmatter（allowed-tools / model / effort / shell / 内嵌 hooks / disabled）；15 内置；用户 / 项目 / 插件三层
   - **Sub-agents 文件**（§3.13a）：`.deepcode/agents/*.md` + frontmatter
   - **输出风格**（§3.13b）：Default / Explanatory / Learning / Proactive + 自定义
   - **Effort levels**（§3.13c）：low / medium / high / xhigh / max → DeepSeek-R1 reasoning budget + `max_tokens` 映射
   - **插件体系**（§3.14）：7 类 contributes + marketplace（local / gh / npm / marketplace 四种安装）
   - **Harness 运行时**（§3.15）：system-reminder 注入 / plan-mode / 后台任务 / cron 调度 / worktree 隔离（含 baseRef / symlinkDirectories / sparsePaths / bgIsolation / `.worktreeinclude`）/ ToolSearch 延迟加载（含 `alwaysLoad`）/ Notification / statusLine（**JSON-on-stdin 契约**）
   - **Checkpointing / Rewind**（§3.15.9）：自动快照 + `/rewind` + `Esc Esc` + 5 种回退操作
   - **Trust dialog**（§3.15.10）：首次打开目录的信任确认
   - **Sandbox 子系统**（§3.9a）：完整 — Linux bwrap + macOS sandbox-exec + 文件/网络白名单
   - **MCP 完整能力**（§3.3）：三 scope（user / project / local）+ `/mcp` 交互命令 + OAuth + `headersHelper` 动态 auth + `alwaysLoad` opt-out + 输出 cap + `@server:proto://` 资源引用 + `mcp__server__prompt` slash 暴露 + `deepcode mcp serve` 反向暴露 + Elicitation hooks
   - **Auth**（§3.4）：`DEEPSEEK_API_KEY`（X-Api-Key）+ `DEEPSEEK_AUTH_TOKEN`（Bearer）双 header + apiKeyHelper 401 刷新 + 5min 周期 + `deepcode setup-token`（CI 长期 token）
   - **Composer**（§3.10）：`@<file>` + `@<server>:<proto>://<resource>` MCP 资源引用 + `/` + `#` + MCP prompts as slash + voice input（whisper.cpp 本地）&nbsp;|&nbsp; <span style="color:gray">~~Image paste / drag-drop / `[Image #N]` chip~~ → **推迟到 v1.1**（详见 §0.2，DeepSeek 当前无 vision 模型）</span>
   - **右侧文件面板**（§3.11，Mac 客户端独有）：Source / Diff / History 三视图 + 多 tab + 拖宽
   - **右侧 Inspector**（§3.10a）：默认收起为 48px 鸢尾条，`⌘\` 展开 320px 完整面板
   - **CLI 全套 flags**（§5）：17+ 个 flag（append-system-prompt / max-turns / bare / allowedTools / disallowedTools / permission-mode / agents / mcp-config / plugin-dir / plugin-url / json-schema / output-format / fork-session …）
   - **Headless / CI**（§5a）：`-p` 一次性 + text/json/stream-json 输出 + JSON schema 强约束 + 5 个 exit codes
   - **Vim 模式**：完整 NORMAL/INSERT/VISUAL 状态机 + `~/.deepcode/keybindings.json`
   - **`/init` 多阶段交互**：subagent 探索 → 提议产物 → 用户审阅
2. **DeepSeek 一体化**：默认且唯一的 LLM provider（`deepseek-chat` / `deepseek-reasoner`）。首启采集 API key，加密落盘。
3. **双形态、共用内核**：
   - **CLI**：`npm i -g deepcode-cli`；`deepcode` 命令进入 REPL，行为对齐 `claude` CLI
   - **Mac 客户端**：Electron + React，内嵌 PTY 视图复用 CLI 内核，加 GUI 化的设置 / 会话 / MCP / 文件面板 / Plugins / Skills 管理
4. **一键安装**：CLI 走 npm；Mac 客户端走 `.dmg`（拖入 Applications 即可，自带 Node runtime）
5. **Mac 客户端自动更新**（§4b）：Claude Code 式"Relaunch to update vX.Y.Z"浮层；electron-updater + GitHub Releases；3 通道（stable / beta / nightly）；emergency security release 走红色强制升级
6. **发布走 GitHub Releases**（§6a）：tag push 触发 GHA → 自动 `npm publish` + 出签名公证 `.dmg` + 更新 `latest-mac.yml` feed
7. **IDE 扩展**（v1.1 快跟）：M6 留 IDE Bridge stub（JSON-RPC over stdio）；v1.1 单独发 VS Code + JetBrains 扩展，支持 inline diff / @-mentions / plan review / 会话历史

### 0.2 明确不做（WON'T - v1）

- **不内置任何"自我/魂"机制**（那是 LISA 的事，不是编程工具的事）。
- **不做 Mac 之外的 GUI 客户端**（CLI 自然多平台 — macOS + Linux 是一等公民；GUI 仅 macOS）。
- **Windows 是 explicit 非目标**（v1 & v1.1）：
  - CLI 在 Windows 上理论可用但不主动测试 / 不出 Windows 安装方式 / Keychain 走 fallback 文件
  - Sandbox（bwrap / sandbox-exec）无 Windows 等价物，Windows 上 sandbox disabled
  - PowerShell tool 不实现
  - 用户需要 Windows 就用 WSL2 跑 Linux 版
- **不做图像输入**（v1 & v1.1 早期）：DeepSeek 当前无原生 vision 模型；
  - 推迟到出现以下任一时再开：(a) DeepSeek 发 vision 模型，(b) 接 Qwen-VL / 其他第三方作 fallback（要明确"违反单 provider 原则"的决策）
  - 在 v1 / v1.1 早期：`+ → Add files or photos` 只支持文件，不支持图片
- **不做多账号 / 多 provider 切换 UI**（架构留扩展点，但 v1 仅 DeepSeek）。
- **不做云同步 / 协作 / 远程会话**。
- **不做 Managed/MDM policy 配置层**（v1 非企业产品；schema 预留字段）。
- **不做 LSP 工具**（v1.1）。

### 0.3 非功能目标

- **隐私**：API key 用 macOS Keychain（GUI）/ `~/.deepcode/credentials.json` chmod 600（CLI）存储，绝不上报。
- **可观测**：所有 LLM 调用、工具调用、token 用量本地落盘，`deepcode status` 一目了然。
- **代码量**：内核（不含 GUI 壳）控制在 ~12k 行 TS，参照 LISA 的体量。

### 0.4 团队规模与工程量假设

scope 完整复刻 Claude Code 是 **ambition-level**，不是工程量-bounded：

- **团队规模假设：≥ 5 人核心** + 持续社区贡献，否则时间线无效
- 时间线 15 周（§6）假设核心团队全职推进 + 关键工程师精通 TypeScript / Electron / macOS 安全模型 / git worktree / shell sandboxing
- **不是单人项目**。如果实际只有 1-2 人，需要把以下推到 v1.1+：完整 sandbox（降级为白名单+审批）/ auto 分类器 mode / Vim 模式 / 语音输入 / IDE Bridge / 输出风格 / cron daemon / `mcp serve` 反向暴露

### 0.5 设计文档先行（M0 必出）

v0.5 review 暴露了三个"在 plan 里被一句话带过、实际是独立子系统"的设计点。M0 必须在写代码前各自出一份独立设计文档存到 `docs/design/`：

| 文档                                   | 范围                                                                                                                                                                 | 为什么独立                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `docs/design/sandbox-plan-worktree.md` | **三者关系矩阵** —— plan mode（不写盘）vs auto-edit mode（直写） vs worktree（隔离写） + sandbox（OS 级兜底）四者如何交互；状态机；冲突解决                          | plan §3.8 / §3.15.2 / §3.15.5 / §3.9a 各自独立写但没说"它们叠加时是什么行为"，这是 agent 安全的根基 |
| `docs/design/plugin-security.md`       | **plugin 执行环境** —— sandbox 进程？信任校验 / 代码签名 / hash pin / marketplace 审计 / kill switch                                                                 | plan §3.14 只写了"`gh:user/repo` 安装"，没说怎么防 RCE。这是 v1 上线第一天就会被攻击的面            |
| `docs/design/effort-levels.md`         | **effort 五档到 DeepSeek 的精确数字映射** —— 对照 DeepSeek API 的 max_tokens 上限 / `deepseek-reasoner` reasoning_content 预算上限 / 实测各档 latency-cost trade-off | plan §3.13c 写的数字（4k/8k/16k/24k/32k）是我编的，没核对 DeepSeek API spec，可能根本不可达         |

---

## 1. 参考资料

| 来源                                      | 用法                                                                                                | 关键收获                                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/Users/oratis/Projects/LISA`**（本地） | 主要参考蓝本，结构直接复用                                                                          | `src/agent.ts` 的流式 agent loop、`src/providers/openai.ts` 已能直接打 DeepSeek（设 `baseURL=https://api.deepseek.com/v1`）、`src/tools/*` 的工具实现、`src/mcp/` 的 MCP client、`src/cli/repl.ts` 的 TUI、`src/sandbox/` |
| **`anthropics/claude-code`**（GitHub）    | Fork 一份作为行为参考；阅读其 `package.json`、slash commands 清单、hooks schema、settings.json 结构 | 终端 UI 的命令面板、`/help`/`/init`/`/clear` 等命令的具体语义、`.claude/settings.json` 字段、`CLAUDE.md` 加载规则                                                                                                         |
| **DeepSeek 官方 docs**                    | API 参数、function calling、上下文窗口（128k）、推理模型（R1）特殊字段                              | `deepseek-reasoner` 的 `reasoning_content` 流式字段；`prefix_caching` 计费                                                                                                                                                |

> Fork 步骤：`gh repo fork anthropics/claude-code --clone=false`，作为只读参考挂在 `reference/claude-code-upstream`（gitignored）。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        DeepCode 用户入口                         │
├──────────────────────────────┬──────────────────────────────────┤
│   Mac 客户端 (Electron)       │   CLI (终端)                      │
│   apps/desktop/              │   apps/cli/                      │
│   - 主窗口 (React + Tailwind)│   - 入口 bin: deepcode           │
│   - Onboarding (API Key)     │   - 进入 REPL / 接收 -p 一次性    │
│   - 嵌入 xterm.js + node-pty │   - --resume / --continue        │
│   - 设置 / MCP / 会话面板    │   - slash commands               │
└──────────────┬───────────────┴───────────────┬──────────────────┘
               │                               │
               └──────────────┬────────────────┘
                              ▼
              ┌────────────────────────────────┐
              │   @deepcode/core (内核)        │   packages/core/
              │   ─────────────────────────    │
              │   • agent.ts (agent loop)      │
              │   • providers/                 │
              │     └── deepseek.ts (OpenAI 兼容) │
              │   • tools/ (read/write/edit/   │
              │     bash/grep/glob/webfetch/   │
              │     websearch/task/todowrite)  │
              │   • mcp/ (client + config)     │
              │   • sandbox/ (bash 白名单/审批)│
              │   • sessions/ (resume/jsonl)   │
              │   • hooks/ (Stop/PreToolUse/…) │
              │   • slash-commands/            │
              │   • compaction/                │
              │   • approval/ (ask/auto/yolo) │
              └────────────────────────────────┘
                              │
                              ▼
              ┌────────────────────────────────┐
              │   DeepSeek API                 │
              │   /chat/completions (stream)   │
              │   tools=function_call          │
              │   model=deepseek-chat /        │
              │         deepseek-reasoner      │
              └────────────────────────────────┘
```

### 2.1 monorepo 布局

```
deepcode/
├── package.json            # workspaces 根
├── pnpm-workspace.yaml
├── packages/
│   ├── core/               # @deepcode/core - 内核（无 UI 依赖）
│   │   ├── src/
│   │   │   ├── agent.ts
│   │   │   ├── providers/deepseek.ts
│   │   │   ├── tools/
│   │   │   ├── mcp/
│   │   │   ├── sessions/
│   │   │   ├── sandbox/
│   │   │   ├── hooks/
│   │   │   ├── slash-commands/
│   │   │   ├── compaction/
│   │   │   ├── credentials/   # Keychain + 文件后备
│   │   │   └── index.ts
│   │   └── package.json
│   └── shared-ui/          # Mac 客户端 + CLI 共享的 TS 类型/常量
├── apps/
│   ├── cli/                # @oratis/deepcode  - npm 包
│   │   ├── src/
│   │   │   ├── cli.ts          # bin 入口
│   │   │   ├── repl.ts         # 交互式 TUI（ink 或裸 readline）
│   │   │   ├── onboarding.ts   # 首启 API key 引导
│   │   │   └── commands/       # /help /init /clear /resume …
│   │   └── package.json
│   └── desktop/            # Mac 客户端 (Electron)
│       ├── electron/           # 主进程
│       │   ├── main.ts
│       │   ├── preload.ts
│       │   └── ipc/            # 桥接到 @deepcode/core
│       ├── src/                # 渲染进程 (React)
│       │   ├── App.tsx
│       │   ├── screens/
│       │   │   ├── Onboarding.tsx    # 首启 API key
│       │   │   ├── Chat.tsx          # 主对话视图
│       │   │   ├── Sessions.tsx
│       │   │   ├── Settings.tsx
│       │   │   └── MCPManager.tsx
│       │   ├── components/
│       │   └── styles/
│       ├── build/                # electron-builder 配置
│       └── package.json
├── docs/
│   ├── DEVELOPMENT_PLAN.md     # 本文件
│   ├── VISUAL_DESIGN.html      # 视觉方案
│   └── …
└── reference/
    └── claude-code-upstream/   # 只读 fork，gitignored
```

**核心原则**：所有"能力"都在 `@deepcode/core`，CLI 和 Mac 客户端都是它的薄壳。这样任何能力升级在两端自动同步。

---

## 3. 关键模块设计

### 3.1 Provider：DeepSeek 适配

DeepSeek API 与 OpenAI 兼容，可以直接复用 LISA 的 `OpenAIProvider` 模板，只换三件事：

```typescript
// packages/core/src/providers/deepseek.ts
import OpenAI from 'openai';

export class DeepSeekProvider implements Provider {
  readonly name = 'deepseek';
  private client: OpenAI;

  constructor(opts: { apiKey: string; baseURL?: string }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL ?? 'https://api.deepseek.com/v1',
    });
  }

  async runTurn(opts: ProviderRunOpts): Promise<ProviderResult> {
    // 1) 把 Anthropic-shape 历史转 OpenAI chat messages
    // 2) tools → functions
    // 3) stream=true, stream_options.include_usage=true
    // 4) deepseek-reasoner 时透传 reasoning_content 到 onThinkingDelta
    // 5) 把 OpenAI 的 tool_calls 增量拼回 Anthropic-shape 抛给 agent loop
  }
}

export const DEEPSEEK_MODELS = {
  chat: { id: 'deepseek-chat', ctx: 128_000, label: 'DeepSeek-V3' },
  reasoner: { id: 'deepseek-reasoner', ctx: 128_000, label: 'DeepSeek-R1', thinking: true },
} as const;
```

**Agent loop 内部数据结构沿用 Anthropic 形态**（`content blocks`、`tool_use` / `tool_result`），provider 层负责双向转换。这样将来增加新 provider（如 Qwen、本地 ollama）不动 agent。

### 3.2 工具集（与 Claude Code 对齐）

| 工具                                                                                         | 优先级   | 备注                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Read`                                                                                       | P0       | 行号 + 限制；图片直传 base64                                                                                                                                                                                      |
| `Write`                                                                                      | P0       | 必先 Read 才能 Write 已存在文件（行为对齐 Claude Code）                                                                                                                                                           |
| `Edit`                                                                                       | P0       | exact-string 替换；`replace_all` 选项                                                                                                                                                                             |
| `Bash`                                                                                       | P0       | 走 sandbox（白名单 / 审批模式 / 超时）                                                                                                                                                                            |
| `Grep`                                                                                       | P0       | 走 ripgrep；返回 file:line:content                                                                                                                                                                                |
| `Glob`                                                                                       | P0       | fast-glob                                                                                                                                                                                                         |
| `WebFetch` / `WebSearch`                                                                     | P1       | DeepSeek 无内置 search → 走 Brave / Tavily / Bing 之一，可配                                                                                                                                                      |
| `TodoWrite`                                                                                  | P0       | 内存 list + 渲染到 UI                                                                                                                                                                                             |
| `Task`                                                                                       | P1       | 子代理：独立上下文窗口跑一个隔离 agent                                                                                                                                                                            |
| `NotebookEdit`                                                                               | P1       | Jupyter `.ipynb`；三种模式 `insert` / `replace` / `delete`；定位 cell 用 `cell_id` 或 cell index；`cell_type` 区分 `code` / `markdown`                                                                            |
| `AskUserQuestion`                                                                            | P0       | 结构化让 agent 在循环中向用户问选择题（不打断 agent loop）；用于澄清意图、让用户拍方向                                                                                                                            |
| `ExitPlanMode` / `EnterPlanMode`                                                             | P0       | Plan mode 状态机切换（§3.15.2）                                                                                                                                                                                   |
| `EnterWorktree` / `ExitWorktree`                                                             | P0       | Worktree 隔离（§3.15.5）                                                                                                                                                                                          |
| `TaskCreate` / `TaskList` / `TaskGet` / `TaskOutput` / `TaskStop` / `TaskUpdate` / `Monitor` | P0       | 后台任务（§3.15.3）                                                                                                                                                                                               |
| `ScheduleWakeup` / `PushNotification`                                                        | P0       | Loop/wake 机制（§3.15.4 中的本地 cron 子集）                                                                                                                                                                      |
| `CronCreate` / `CronList` / `CronDelete`                                                     | P0       | 定时任务（§3.15.4）                                                                                                                                                                                               |
| `ToolSearch`                                                                                 | P0       | Deferred loading（§3.15.6）                                                                                                                                                                                       |
| `LSP`                                                                                        | **v1.1** | 语言服务集成（jump-to-def / find-refs / type errors / call hierarchy）；通过 `vscode-languageserver` protocol 接入 typescript-language-server、gopls、pyright 等；agent 每次 Edit 后自动跑类型检查并把 error 喂回 |
| `mcp__*`                                                                                     | P0       | 动态从 MCP server 注册                                                                                                                                                                                            |

**Bash 工具特殊参数**：

- `run_in_background: true` — 把命令丢后台跑；用 `⌃B` 快捷键可在前台命令运行时把它丢后台；产出写到 `~/.deepcode/sessions/<sid>/bg/<id>.log`，用 `Read` 读那个文件取最新输出（与 §3.15.3 TaskCreate 共享底层基础设施）
- `timeout: <ms>` — 工具级超时
- `description` — 给用户看的命令解释（在审批弹窗里显示）

### 3.3 MCP 客户端

直接移植 `LISA/src/mcp/`：

- 解析 `~/.deepcode/mcp.json`（与 Claude Code 配置同 schema）
- 支持 `stdio` / `http` / `sse` 三种 transport
- 每个 server 暴露的工具自动加前缀 `mcp__<server>__<tool>`

**三种 scope（对齐 Claude Code）**：

- `user` — 用户级 `~/.deepcode/mcp.json`，所有项目可用
- `project` — 项目级 `.deepcode/mcp.json`，入 git，团队共享
- `local` — `.deepcode/mcp.local.json`，gitignore，仅本机生效

**`/mcp` 交互命令**：列出已连 server、看每个的工具数、reconnect、disconnect、看错误日志、触发 OAuth 重授权。

**OAuth 流**：transport 为 `http` / `sse` 的 server 若返回 401，自动跳出 OAuth 流程（系统浏览器开授权页 → callback 回本地端口 → 写 token 到 keychain）。

**`headersHelper`** —— 非 OAuth 的动态 auth（Kerberos / SSO / 公司 SSO）：

```jsonc
{
  "mcpServers": {
    "company": {
      "url": "https://mcp.company.com/sse",
      "transport": "sse",
      "headersHelper": "company-auth-cli get-headers --output-json", // 每次请求前跑这个命令拿 headers
    },
  },
}
```

**`_meta["anthropic/maxResultSizeChars"]` 输出上限**：MCP server 可在 tool 返回结果的 `_meta` 字段声明本次输出的字符上限，避免炸 context。也可通过环境变量 `MAX_MCP_OUTPUT_TOKENS` 全局兜底。

**Elicitation hooks**：MCP server 可主动要求用户输入（"请提供数据库连接串"）—— DeepCode 把这个请求包装成 `Elicitation` 事件，通过 hook 链可拦截 / 改写 / 自动应答。

**`deepcode mcp serve`（反向暴露）**：把 DeepCode 自己作为 MCP server 暴露给其他 agent（如 Claude Desktop）调用。这样可以"在 Claude Desktop 里用 DeepCode 的工具集"。

### 3.4 Onboarding（首启 API Key 流程）

**触发条件**：`@deepcode/core` 启动时调用 `credentials.load()`，若返回空则触发 onboarding。

**CLI 行为**（`apps/cli/src/onboarding.ts`）：

```
$ deepcode

  ╭─ DeepCode ────────────────────────────────────╮
  │                                               │
  │  Welcome. Let's connect to DeepSeek.          │
  │                                               │
  │  1) Get a key:  https://platform.deepseek.com │
  │  2) Paste it below (input hidden):            │
  │                                               │
  │  API Key: ████████████████                    │
  │                                               │
  │  ✓ Validating... 200 OK · balance $4.21       │
  │  ✓ Saved to ~/.deepcode/credentials.json      │
  │                                               │
  ╰───────────────────────────────────────────────╯

  Default model: deepseek-chat   [enter to confirm]
  >
```

**Mac 客户端行为**：全屏 onboarding 卡片，三步式（介绍 → 输入 key → 选模型），点完成后写 Keychain 并进入主视图。

**验证逻辑**：调用 `GET https://api.deepseek.com/user/balance` 用 key，HTTP 200 即认为有效；同时拿到余额，首页可显示。

**安全**：

- macOS GUI → Keychain（`security add-generic-password -s deepcode -a deepseek`）
- CLI → `~/.deepcode/credentials.json`，chmod 600
- 同机器上 CLI 和 GUI **共享同一份 credentials**（GUI 写入时同时镜像到文件，反之亦然），所以用户填一次两边都用。

**双 header（对齐 Claude Code 的 `ANTHROPIC_AUTH_TOKEN` vs `ANTHROPIC_API_KEY`）**：

- `DEEPSEEK_API_KEY` → 走 `X-Api-Key` header（直连 DeepSeek 官方 / 国内中转）
- `DEEPSEEK_AUTH_TOKEN` → 走 `Authorization: Bearer ...`（用于自建 gateway、需要 OAuth/JWT 的场景）
- 同时设置时 `DEEPSEEK_AUTH_TOKEN` 优先

**`apiKeyHelper` 刷新语义**：

- 配置：`settings.json` 中 `"apiKeyHelper": "op read op://Personal/DeepSeek/credential"`（任意能输出 key 到 stdout 的命令）
- 触发刷新：① 首次请求；② 任何请求返回 HTTP 401 时立即重试；③ 每 5 分钟主动刷新一次
- 刷新周期可调：环境变量 `DEEPCODE_API_KEY_HELPER_TTL_MS`（默认 300_000）

**`deepcode setup-token`（CI 用长期 token）**：

```bash
deepcode setup-token            # 交互式生成一份"DeepCode-only"的长期凭证
                                # 实际是把 API key 包一层短指纹 + 滚动续约
                                # 写到 ~/.deepcode/long-token.json
                                # 用 DEEPCODE_LONG_TOKEN 注入 CI 环境
```

等价于 Claude Code 的 `claude setup-token`。

### 3.5 会话与 resume

会话存于 `~/.deepcode/sessions/<uuid>.jsonl`，每行一条 `StoredMessage`，与 Claude Code 一致。

- `deepcode --resume` → 弹列表选会话
- `deepcode --continue` → 继续最近一条
- Mac 客户端左侧侧栏列出所有会话，可重命名 / 删除 / 导出 markdown

### 3.6 Hooks & Slash Commands

**Hooks** — 9 类事件 × 5 种 handler 类型，完全对齐 Claude Code：

| 事件               | 触发时机                     |
| ------------------ | ---------------------------- |
| `PreToolUse`       | 工具调用前；可改写参数或阻断 |
| `PostToolUse`      | 工具调用后；可改写结果       |
| `Stop`             | 主 agent 完成一轮回复        |
| **`SubagentStop`** | Task 子代理完成时            |
| **`PreCompact`**   | 上下文压缩前                 |
| **`PostCompact`**  | 上下文压缩后                 |
| `SessionStart`     | 新会话或 resume              |
| **`SessionEnd`**   | 会话退出                     |
| `UserPromptSubmit` | 用户消息送出前               |
| `Notification`     | 系统通知触发时               |

**5 种 handler 类型**：

```jsonc
{ "type": "command",  "command": "./hook.sh",                "timeout": 60 }
{ "type": "http",     "url": "https://hooks.company.com/x",  "headers": {...} }
{ "type": "mcp_tool", "server": "myserver", "tool": "log" }
{ "type": "prompt",   "prompt": "Summarize what just happened" }   // 喂给 LLM 当 system message
{ "type": "agent",    "agent": "auditor" }                          // 跑一个 sub-agent
```

**`if` 字段**：用 permission-rule-syntax 过滤 — 例如 `"if": "Bash(rm:*)"` 让 hook 仅在 `rm` 命令时触发。

**Hook JSON 输出契约**：handler 的 stdout 可输出 JSON 影响下游：

```jsonc
{
  "decision": "allow" | "deny" | "ask",
  "permissionDecision": "allow" | "deny" | "ask",
  "hookSpecificOutput": "...",
  "additionalContext": "插入到下一轮 LLM context",
  "systemMessage": "显示给用户的红字提示",
  "stopReason": "如果是 Stop hook，给出停止理由",
  "suppressOutput": true
}
```

**安全配置**：`disableAllHooks`（紧急关闭）/ `allowedHttpHookUrls`（http hook 域白名单）/ `httpHookAllowedEnvVars`（http hook 可见的环境变量）。

**Slash Commands · 30+ 内置**：

| 类别       | 命令                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| 会话       | `/help` · `/clear` · `/resume` · `/continue` · `/export` · `/teleport`（跳到会话中任意点）· `/recap`（总结）            |
| 模型与模式 | `/model` · `/mode` · `/effort`（low/medium/high/xhigh/max）· `/plan`                                                    |
| 上下文     | `/compact` · `/context`（显示 token 用量明细）· `/btw`（旁白问题，不污染主对话）                                        |
| 文件       | `/init`（多阶段交互，subagent 探索 → 提议 DEEPCODE.md/skills/hooks）· `/add-dir` · `/rewind` · `/todos`                 |
| 工具       | `/agents` · `/hooks` · `/skills` · `/permissions` · `/mcp` · `/tasks` · `/background`（后台任务列表）                   |
| 配置       | `/config` · `/login` · `/logout` · `/cost` · `/usage` · `/privacy-settings` · `/voice`（开关语音输入）                  |
| 健康       | `/status`（≡ doctor）· `/doctor` · `/bug`（报 bug，自动收集环境）· `/release-notes` · `/upgrade` · `/migrate-installer` |
| 评审       | `/review` · `/pr_comments` · `/security-review`                                                                         |
| 调度       | `/loop`（循环跑命令）· `/schedule`（定时任务）· `/batch`                                                                |
| 编辑器     | `/vim`（切换 vim 编辑模式）· `/terminal-setup`                                                                          |
| 桌面       | `/desktop`（在 Mac 客户端打开当前 CLI 会话）                                                                            |

**自定义 slash commands**：`.deepcode/commands/<name>.md`（项目级）或 `~/.deepcode/commands/<name>.md`（用户级），格式：

```markdown
---
name: deploy-staging
description: 把当前分支部署到 staging
allowed-tools: ['Bash']
argument-hint: '[branch-name]'
model: deepseek-chat
---

部署到 staging：

1. 跑 `npm run build`
2. 上传 ...
```

用户输入 `/deploy-staging` 即触发；与 skill 是相同机制，只是 commands 偏"单次操作"、skills 偏"多步技能"。

`DEEPCODE.md` 加载规则：项目根 + 所有父目录递归 + `~/.deepcode/DEEPCODE.md`（用户级）+ 自动 `@import AGENTS.md`（如存在）。详见 §3.6a。

### 3.6a Memory 系统（双系统 + @-import + rules 目录）

DeepCode 有 **两套 memory**，与 Claude Code 完全对齐：

| 系统                             | 写入方        | 位置                                                                 | 用途                                                     |
| -------------------------------- | ------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| **用户 memory（DEEPCODE.md）**   | 人类          | 项目根 `DEEPCODE.md` + 父目录递归 + `~/.deepcode/DEEPCODE.md`        | 项目规约、代码风格、必读约定                             |
| **自动 memory（agent-written）** | DeepCode 自己 | `~/.deepcode/projects/<repo-hash>/memory/MEMORY.md` + 同目录主题文件 | agent 跨会话累积的项目知识（如"该项目用 yarn 不用 npm"） |

**`#` 触发符**：用户在 composer 输入 `# 这个项目用 pnpm`，自动写入 `~/.deepcode/projects/<repo>/memory/`，下次会话自动 inject。

**@-import 递归**：`DEEPCODE.md` 内 `@path/to/file.md` 自动展开为目标文件正文，最多 4 跳。支持 `@~/.deepcode/personal-prefs.md` 让团队配置与个人偏好分离。

**`AGENTS.md` 自动 import**：项目根若存在 `AGENTS.md`，DeepCode 在加载 `DEEPCODE.md` 时自动 prepend，与 Cursor/Cline/其他 agent 工具实现跨工具 memory 共享。

**`.deepcode/rules/*.md`**：把 `DEEPCODE.md` 拆分的推荐方式。每个 rule 文件可带 frontmatter `paths: ["src/api/**"]`，**仅当 agent 触碰到匹配路径时**才把 rule 注入上下文 — 节省 token。

**加载上限**：单个 memory 文件 200 行 / 25 KB 上限，超出截断；累计上限由 settings.json 的 `memoryLoadCapKB` 控制（默认 100 KB）。

### 3.7 上下文压缩

DeepSeek 上下文窗口 128k，触发阈值 80%。压缩策略：

1. 保留 system + 最近 N 条消息 + 用户标"重要"的消息
2. 把中段塞给 `deepseek-chat` 请它输出摘要
3. 拼回新历史并继续

### 3.8 Modes（运行模式 · 5 档 + auto 分类器）

修正自 v0.3 的 4 档版本 —— Claude Code 实际有 5 档，且 `auto` 是个 LLM-judged 分类器（非简单白名单），DeepCode 完整对齐：

| Mode                | 含义                   | 写操作    | Bash        | WebFetch  | 备注                                                                                                    |
| ------------------- | ---------------------- | --------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `default`（≡ ask）  | 每步确认               | ask       | ask         | ask       | 系统默认                                                                                                |
| `acceptEdits`       | 文件编辑自动放行       | auto      | ask         | ask       | Claude Code 称 `acceptEdits`（v0.3 错写成 `auto-edit`）                                                 |
| `plan`              | 只读规划               | deny      | 仅 readonly | ask       | 出计划等批准                                                                                            |
| **`auto`**          | **LLM 分类器自动判定** | LLM       | LLM         | LLM       | 每次工具调用前先用 `deepseek-chat` 跑一个轻量分类，按 `autoMode` 规则给出 allow / soft_deny / hard_deny |
| `dontAsk`           | 只放行明确 allow 列表  | deny 其他 | deny 其他   | deny 其他 | 严格白名单，适合不熟悉的项目                                                                            |
| `bypassPermissions` | 跳过全部权限           | auto      | auto        | auto      | 等价 `--dangerously-skip-permissions`；UI 橙色高亮                                                      |

**`auto` 分类器子系统**：settings.json 配置 —

```jsonc
{
  "autoMode": {
    "allow": ["any read", "any test command", "edits inside ./src"],
    "soft_deny": ["network calls to unfamiliar domains"],
    "hard_deny": ["any write to .env", "any rm -rf"],
    "model": "deepseek-chat",
    "fallback": "ask",
  },
}
```

分类器对每个工具调用打三选一标签：`allow` 直接放行 / `soft_deny` 弹审批 / `hard_deny` 直接拒绝并不再询问。

**插件可注册自定义 mode**：通过 `contributes.modes`（§3.14），policy 同样支持上述结构。

**settings.json 默认 mode**：`{ "permissions": { "defaultMode": "default" } }`。

### 3.9 settings.json 全集（与 Claude Code 对齐）

DeepCode 解析以下层级配置并按优先级合并（后覆盖前）：

1. `~/.deepcode/settings.json`（用户级）
2. `<project>/.deepcode/settings.json`（项目级，纳入 git）
3. `<project>/.deepcode/settings.local.json`（本地覆盖，gitignore）

> **不实现**：Claude Code 还有最高优先级的 **managed/policy 层**（MDM 推送 `/Library/.../managed-settings.json`），用于企业部署。DeepCode v1 不是企业产品，跳过；schema 中预留字段名以便日后兼容。

**Permission rule glob 语法（两种都实现）**：

| 写法                 | 匹配                                              | 例                                                                 |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| `Tool(arg:*)`        | 子命令精确匹配（解析 arg 第一段为子命令）         | `Bash(git diff:*)` 仅匹配 `git diff *` 系列，**不**匹配 `git push` |
| `Tool(arg *)`        | 前缀匹配                                          | `Bash(npm test *)` 匹配任何 `npm test ...`                         |
| `Tool(domain:x.com)` | 域名匹配（WebFetch / WebSearch 专用）             | `WebFetch(domain:github.com)`                                      |
| `Skill(name *)`      | skill 名前缀                                      | `Skill(deploy *)`                                                  |
| `Agent(name)`        | sub-agent 精确名                                  | `Agent(Explore)`                                                   |
| `MCP(server)`        | MCP server 精确名（匹配该 server 暴露的所有工具） | `MCP(github)`                                                      |

字段集（v1 实现）：

```jsonc
{
  // 默认模型
  "model": "deepseek-chat", // 或 "deepseek-reasoner"

  // DeepSeek endpoint（兼容国内中转）
  "baseURL": "https://api.deepseek.com/v1",

  // 动态获取 API key 的命令（优先级高于 keychain）
  "apiKeyHelper": "op read op://Personal/DeepSeek/credential",

  // 权限策略：allow / ask / deny 模式 + 工具/路径 matcher
  "permissions": {
    "defaultMode": "ask",
    "allow": ["Bash(npm test:*)", "Read(./**)", "Edit(./src/**)"],
    "ask": ["WebFetch", "Bash(git push:*)"],
    "deny": ["Read(./.env*)", "Read(./**/secrets/**)"],
    "additionalDirectories": ["~/Projects/shared-libs"],
  },

  // 环境变量（注入到 Bash 与 hooks 的子进程）
  "env": {
    "NODE_ENV": "development",
    "DEEPCODE_DEBUG": "0",
  },

  // Hooks — 完全对齐 Claude Code schema
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": ".deepcode/hooks/log-bash.sh", "timeout": 60 }],
      },
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "prettier --write \"$DEEPCODE_FILE\"" }],
      },
    ],
    "Stop": [{ "hooks": [{ "type": "command", "command": ".deepcode/hooks/notify-done.sh" }] }],
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "echo 'session started'" }] }],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": ".deepcode/hooks/sanitize.sh" }] },
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"$1\" with title \"DeepCode\"'",
          },
        ],
      },
    ],
  },

  // MCP servers — schema 完全对齐 Claude Code
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["@modelcontextprotocol/server-filesystem", "/tmp"] },
    "github": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." },
    },
    "company": {
      "url": "https://mcp.company.com/sse",
      "transport": "sse",
      "headers": { "Authorization": "Bearer ..." },
    },
  },

  // 项目级 MCP 启用/禁用
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": ["filesystem"],
  "disabledMcpjsonServers": ["github"],

  // 状态栏自定义命令（输出注入到 CLI / GUI 状态栏）
  "statusLine": {
    "type": "command",
    "command": "git branch --show-current && git status --porcelain | wc -l",
  },

  // 杂项
  "includeCoAuthoredBy": true, // commit 时附 Co-Authored-By
  "cleanupPeriodDays": 30, // 会话历史保留天数
  "alwaysThinkingEnabled": false, // 强制开启 reasoner 模式
  "forceLoginMethod": "apiKey", // v1 仅支持 apiKey
  "effortLevel": "medium", // low/medium/high/xhigh/max - 影响 max_tokens 和 R1 reasoning budget
  "outputStyle": "default", // default/explanatory/learning/proactive/<custom>
  "language": "zh-CN", // UI 语言
  "viewMode": "compact", // compact/expanded
  "tui": { "vim": false, "spinnerVerbs": true, "spinnerTipsEnabled": true },
  "memoryLoadCapKB": 100,
  "deepcodeMdExcludes": ["**/node_modules/**", "**/dist/**"],
  "attribution": true, // PR / commit 标 DeepCode 来源
  "prUrlTemplate": "https://github.com/{owner}/{repo}/pull/new/{branch}",
  "includeGitInstructions": true, // system prompt 是否注入 git 协作指引
  "feedbackSurveyRate": 0, // 0~1，反馈调查弹出频率
  "awaySummaryEnabled": true, // 用户回来时给"你不在的时候我做了..."摘要
  "preferredNotifChannel": "system", // system/terminal/none
}
```

**实现位置**：`packages/core/src/config/`（加载 / 合并 / 校验 / watch 热更新）。配置变更通过 `chokidar` 监听并发事件给 CLI 与 GUI。

### 3.9a Sandbox 子系统（完整实现 · 你定的方向）

Claude Code 的真沙箱：Linux 用 `bwrap`（bubblewrap）、macOS 用 `sandbox-exec`。DeepCode 完整对齐：

**配置 schema**（settings.json 内）：

```jsonc
{
  "sandbox": {
    "enabled": true, // 关闭则回到 v0.x 的"白名单 + 审批"轻量级模式
    "filesystem": {
      "allowWrite": ["./", "/tmp/deepcode-*"],
      "denyWrite": ["./.env*", "./node_modules"],
      "allowRead": ["./", "~/.deepcode/", "~/Projects/shared-libs"],
      "denyRead": ["~/.ssh", "~/.aws", "~/Library/Keychains"],
    },
    "network": {
      "allowedDomains": ["api.deepseek.com", "github.com", "npmjs.com"],
      "deniedDomains": ["*.ad-tracker.com"],
      "allowUnixSockets": true,
      "allowLocalBinding": false, // 不允许 agent 起 server
    },
    "excludedCommands": ["docker", "kubectl"], // 这些命令绕过沙箱（信任宿主行为）
  },
}
```

**实现位置**：`packages/core/src/sandbox/`

- `linux.ts` — 用 `bwrap` 把 Bash 工具的子进程包起来，通过 `--ro-bind` / `--bind` / `--unshare-net` 等参数实现 fs/net 隔离
- `macos.ts` — 生成 `sandbox-exec` 配置文件（SBPL 语言），把允许/拒绝规则翻译过去
- `fallback.ts` — Windows 或 OS 不支持时回退到路径校验（带显著警告）

**与 mode / permissions 的关系**：sandbox 是 **底盘**，permissions 是 **策略**。即使 `bypass` mode 也会被 sandbox 兜底（除非 `sandbox.enabled = false`）。这层不是给 LLM 看的，是给操作系统看的，防"提示词被注入欺骗"导致灾难。

### 3.10 输入 Composer（与 Claude Code 像素级对齐）

底部输入区是高频交互入口，必须 1:1 还原：

**触发符**：

- `@<file>` — 本地文件引用；fuzzy 列表；回车插路径 + 内容随消息发出
- `@<server>:<protocol>://<path>` — **MCP 资源引用**，例如 `@github:issue://12345`、`@filesystem:file:///tmp/x`；由对应 MCP server 解析
- `mcp__<server>__<prompt>` — MCP server 暴露的 prompt 会自动注册为 slash command，可像本地命令一样使用
- `/<command>` — slash command 弹层（内置 + 自定义 + 插件 + 自动从 skills 注册）
- `#<text>` — 写入 auto-memory（详见 §3.6a），不再是写 `DEEPCODE.md`

**图片输入**（Mac 客户端）：

- 系统粘贴板：`⌘V` 自动检测图片
- 备用 hotkey：`⌃V` / `⌥V` 强制粘贴板模式
- Drag-drop：拖图入 composer
- 渲染：composer 内显示为 `[Image #1]` 紧凑 chip（可点击预览），不直接铺图避免抢空间
- 发送时图片自动转 base64 走 vision；> 100 KB 文本走"附件"通道

**`+` 附件菜单**（截图所示，全部实现）：
| 项 | 快捷键 | 行为 |
|---|---|---|
| Add files or photos | ⌘U | 文件选择器；图片自动转 base64 走 vision；> 100KB 文本走"附件"通道（不进上下文，工具按需取） |
| Add folder | — | 把整个文件夹声明为"额外允许读"目录（写入当前会话的临时 permissions） |
| Slash commands | — | 等价输入 `/`，弹命令面板 |
| Connectors › | — | 子菜单：列出当前已配置的 MCP server，可点击"重连 / 查看工具 / 临时禁用" |
| Add plugins… | — | 打开插件市场（v1 用本地目录 `~/.deepcode/plugins/`，v1.1 上 registry） |

**右侧控件**（从左到右）：

1. **模型选择器**：显示 `deepseek-chat 128k · Standard` 或 `deepseek-reasoner 128k · High`，点击下拉切换模型 + 思考深度（`low/medium/high/extra-high`，对应 `max_tokens` 与 reasoner 的预算）
2. **Mode 指示器**：当前 mode 文字徽章（`ask` 灰 / `auto-edit` 蓝 / `plan` 紫 / `bypass` **橙色高亮**）
3. **Mic 按钮**：语音输入；走 `whisper.cpp` 本地小模型或调用系统级 `SFSpeechRecognizer`（Mac 客户端），v1 CLI 不实现
4. **Send 按钮**：⌘↵

**上下文提示**（composer 下方一行 + 状态栏）：

```
12,438 / 128,000 tokens · 9.7%       ¥ 0.018 / turn       下次压缩 @ 102k
```

- 进度条上色：< 60% 灰 / 60–80% 黄 / > 80% 红
- 鼠标 hover 显示明细：`system prompt 1.2k · history 8.4k · current msg 2.8k`
- 压缩触发时状态栏右侧出现 `⚡ compacted (3.4k → 1.1k)` 徽章

### 3.10a 右侧 Inspector · 默认收起

**默认形态**：48px 窄条（rail），垂直堆叠以下图标按钮 —

- `‹` 展开按钮（点击或 `⌘\` 展开到 320px 完整面板）
- `▤` Plan 入口（含未完成数 badge）
- `◐` 上下文用量（图标颜色随用量变化：绿/黄/红）
- `📁` 最近文件
- `ⓘ` 会话信息
- 底部：`⚙` 设置

**展开后**：320px 完整面板，含 Session / Context Window / Plan / Recent Files 四个分区（参考早期版本设计）。

**为何默认收起**：用户 90% 时间在写代码读对话，inspector 的信息属于"<i>瞄一眼</i>"型，常驻反而消耗注意力。窄条带 badge 已经能解决"<i>有没有要紧事</i>"的判断。

### 3.11 右侧文件面板（Mac 客户端独有）

**触发方式**：

1. 点击对话中任意文件名 / diff 卡片标题 → 在右侧打开
2. 点击 inspector 中 "Recent Files" 任一行
3. 拖拽文件到对话窗口
4. 快捷键 `⌘O` 打开 fuzzy 文件选择器

**面板形态**：

- 紧贴主视图右侧弹出，**插入到 chat 列与收起的 inspector 鸢尾条之间**（inspector 始终保持 48px 窄条）
- 宽度默认 520px，可拖拽 320–800px，状态持久化到 `settings.local.json`
- 顶部 tab 栏：可同时打开多个文件，关闭按钮、未保存黄点

**视图模式**（Tab 内顶部切换）：
| 视图 | 用途 |
|---|---|
| **Source** | Monaco 编辑器只读视图；行号、语法高亮；可点 ✏ 切到编辑态 |
| **Diff** | 与最近一次 Edit/Write 工具调用产生的 diff 对照；左右 split 或 inline 切换 |
| **History** | 本会话内该文件的所有版本时间轴，可点击任一历史版本回到 Source/Diff |

**键盘**：`⌘W` 关闭当前 tab；`⌘[` / `⌘]` 切换 tab；`⌘\` 切换 split / inline diff。

**实现要点**：所有文件版本快照存 `~/.deepcode/sessions/<sid>/snapshots/<file-hash>.<ts>`，Edit/Write 工具调用前后各存一份，便于 Diff & History。这套快照同时也是 §3.15.9 checkpointing/rewind 的数据源 —— File panel 的 History tab 与 `/rewind` 操作背后是同一份存储。

### 3.12 审批（approval · 受 mode 控制）

审批不是独立模式，而是 mode 与 `permissions` 字段共同作用的产物：

- 每次工具调用：先看 mode 默认策略 → 再叠加 `permissions.allow/deny/ask` matcher → 输出 `allow / ask / deny`
- `ask` 在 CLI 用 y/n/a（always-for-session）提示；GUI 用对话气泡内的按钮组（Approve / Reject / Always allow）
- 用户在审批 UI 上选 "Always allow" → 自动写入 `settings.local.json` 的 `permissions.allow`

### 3.13 Skills 系统（带 frontmatter 的 markdown 技能）

**定义**：Skill 是一个目录，包含一份 `SKILL.md`（必需）+ 任意辅助资源（脚本、模板、数据）。`SKILL.md` 的 YAML frontmatter 描述自身，正文是给模型读的"操作手册"。

**SKILL.md 格式**（完整 frontmatter）：

```markdown
---
name: code-review
description: 评审当前 diff 的正确性 bug，按 effort 等级输出（low/medium 高置信发现 · high/max 更广覆盖）。当用户说"review"、"评审"、"看看这个 PR"时触发。
allowed-tools: ['Read', 'Bash', 'Grep'] # 可选 · 限制 skill 内可调用工具集
model: deepseek-chat # 可选 · 推荐运行模型
effort: high # 可选 · 强制 effort 等级（low/medium/high/xhigh/max）
shell: bash # 可选 · 若 skill 内嵌脚本，指定 shell
hooks: # 可选 · 仅在此 skill 激活期间生效的 hooks
  PreToolUse:
    - matcher: 'Bash'
      command: 'echo audit'
disabled: false # 用户可在 settings 关闭某 skill
---

# Code Review Skill

你被加载进来是因为用户想做代码评审。流程：

1. 跑 `git diff` 拿到本次改动
2. 对每个 hunk 评估…（具体步骤）
3. 输出格式：…
```

**`skillOverrides`**：settings.json 可禁用单个 skill：`{ "skillOverrides": { "code-review": { "disabled": true } } }`。

**存储位置**（按优先级合并）：

1. 内置：`packages/core/skills/*` —— DeepCode 出厂自带的"通用"技能（约 15 个，下表）
2. 用户级：`~/.deepcode/skills/<name>/SKILL.md`
3. 项目级：`<project>/.deepcode/skills/<name>/SKILL.md`
4. 插件 ship 的：`~/.deepcode/plugins/<plugin>/skills/<name>/SKILL.md`，命名空间 `<plugin>:<skill>`

**触发机制**：

- 每次新会话或新用户消息时，harness 把所有可用 skill 的 `name + description` 拼成一段清单注入到 system prompt（不注入正文，省 token）
- 模型决定调用 → 通过内置工具 `Skill({ skill: "code-review", args?: "..." })` 触发
- harness 加载 `SKILL.md` 正文 → 作为 system message 拼入下一轮 → skill 自己以"被 inline 的子程序"形式执行
- 同一会话内同名 skill 不重复加载

**内置 skills（v1 出厂带）**：
| Skill | 触发场景 |
|---|---|
| `init` | 用户说"初始化 DEEPCODE.md / 让我开始"，扫描代码库生成 `DEEPCODE.md` |
| `skill-creator` | 用户说"做个 skill / 优化这个 skill"，引导创建新 skill |
| `code-review` | 评审 diff、PR、当前改动 |
| `security-review` | 安全审查当前分支 |
| `verify` | 跑应用确认改动真的工作（不只是测试通过） |
| `run` | 启动本项目并截图 |
| `keybindings-help` | 编辑 `~/.deepcode/keybindings.json` |
| `update-config` | 编辑 `settings.json` / hooks / permissions |
| `fewer-permission-prompts` | 扫描历史会话，自动给 `.deepcode/settings.json` 添加常用工具到 allow 列表 |
| `xlsx` / `docx` / `pdf` / `pptx` | 操作对应文件类型（如果该业务场景命中） |
| `consolidate-memory` | 整理 `~/.deepcode/memory/*` 去重、修正 |
| `claude-api` | （对应 deepseek-api）调 DeepSeek API 的脚手架/迁移 |
| `loop` | 按间隔重复跑某个命令（轮询 CI 等） |
| `schedule` | 创建定时远程 agent（见 §3.15 cron） |
| `review` | 评审 PR |

**Slash command 关联**：每个 skill 自动注册同名 slash command，用户可以 `/<skill-name>` 显式调用（绕过模型自主判断）。

### 3.13a Sub-agents 作为文件（`.deepcode/agents/*.md`）

除了 §3.14 中"插件 contributes agents"的方式，DeepCode 还支持用户/项目级 sub-agent 文件 —— 这是 Claude Code 主推的扩展方式。

**位置**（三层，优先级从低到高）：

- 用户级：`~/.deepcode/agents/<name>.md`
- 项目级：`<project>/.deepcode/agents/<name>.md`
- 插件 ship：`~/.deepcode/plugins/<plugin>/agents/<name>.md`，命名空间 `<plugin>:<name>`

**文件格式**：

```markdown
---
name: explorer
description: 快速搜索代码定位文件的只读 sub-agent，不允许写
tools: ['Read', 'Grep', 'Glob'] # 该 agent 允许的工具白名单（subset of parent's tools）
model: deepseek-chat # 该 agent 用的模型，可与主 agent 不同
isolation: 'subprocess' # subprocess / worktree / none
maxTurns: 12 # 防止跑飞的硬上限
---

# Explorer sub-agent

你的任务是只读地探索代码库。你不被允许写或执行 Bash。流程：

1. 用 Grep / Glob 定位
2. 用 Read 读关键片段
3. 返回一份简报给主 agent
```

**触发**：主 agent 调用 `Task({ subagent_type: "explorer", prompt: "..." })`，harness 加载该文件作为子 agent 的 system prompt，在隔离 context 里跑。

### 3.13b Output Styles（输出风格）

**位置**：`~/.deepcode/output-styles/<name>.md`、`<project>/.deepcode/output-styles/<name>.md`、内置。

**内置 4 种**：
| Style | 用途 |
|---|---|
| `default` | 简洁、直接、最少废话 |
| `explanatory` | 解释为什么这样改，适合学习 |
| `learning` | 类教师模式 — 引导用户自己写关键代码，agent 只给出框架 |
| `proactive` | agent 主动建议下一步、提示风险点 |

**文件格式**：

```markdown
---
name: explanatory
description: 在写代码的同时解释思路
keep-coding-instructions: true # 是否保留 system prompt 中的"如何写代码"基础指令
---

# Explanatory output style

每次给出代码改动后，请同时：

1. 简述为什么这么改
2. 指出潜在的副作用
3. 给出一句"如果是新手该注意 X"

不要重复显示完整文件，diff 已经够了。
```

**生效机制**：被选中的 style 文件正文 append 到 system prompt；可通过 `outputStyle` setting 或 `/config` → output style 切换。

### 3.13c Effort Levels（思考深度）

5 档：`low / medium / high / xhigh / max`。

**生效层**（优先级从高到低）：

1. 命令行 `--effort high`
2. 会话内 `/effort high`
3. Skill frontmatter `effort: high`（仅该 skill 激活期间）
4. settings.json `"effortLevel": "medium"`
5. 系统默认 `medium`

**映射到 DeepSeek**：
| Effort | `deepseek-chat` `max_tokens` | `deepseek-reasoner` reasoning budget | UI 标签 |
|---|---|---|---|
| `low` | 4,000 | 1,500 token | Standard |
| `medium` | 8,000 | 4,000 token | Standard |
| `high` | 16,000 | 12,000 token | High |
| `xhigh` | 24,000 | 24,000 token | Extra High |
| `max` | 32,000 | unlimited | Max |

**环境变量**：`CLAUDE_CODE_EFFORT_LEVEL` → DeepCode 等价 `DEEPCODE_EFFORT_LEVEL`，CI 场景可注入。

UI 上 effort 选择器嵌在模型选择器旁（参考视觉稿 #4 屏 composer），切换不需打开 settings。

### 3.14 插件系统（contributes 多元能力）

**定义**：Plugin 是一个目录或 npm 包，通过 `plugin.json` manifest 声明自己向 DeepCode 贡献了哪些能力。

**plugin.json schema**：

```jsonc
{
  "name": "deepcode-plugin-data-tools",
  "version": "0.3.0",
  "description": "Spreadsheet / SQL / chart helpers",
  "author": "...",
  "engines": { "deepcode": ">=0.1.0" },
  "contributes": {
    "skills": ["skills/sql-explain", "skills/chart-from-csv"],
    "commands": [{ "name": "sql", "skill": "sql-explain" }],
    "hooks": {
      "PreToolUse": [{ "matcher": "Bash(psql:*)", "command": "scripts/sql-audit.sh" }],
    },
    "mcpServers": {
      "duckdb": { "command": "node", "args": ["servers/duckdb.js"] },
    },
    "agents": ["agents/sql-reviewer"], // 可作为 Task subagent_type 引用
    "statusLines": [{ "name": "db-status", "command": "scripts/db-status.sh" }],
    "modes": [
      { "name": "sql-only", "policy": { "allow": ["Bash(psql:*)", "Read"], "deny": ["*"] } },
    ],
  },
}
```

**贡献点说明**：
| contributes | 含义 |
|---|---|
| `skills` | 注册 skill，命名空间 `<plugin>:<skill>` |
| `commands` | 注册 slash command；可链接到自家 skill 或直接 inline 一段 prompt |
| `hooks` | 注册 6 类事件的 hook，与用户 settings.json 中的 hooks 共存（plugin 的先于 user 执行）|
| `mcpServers` | 注册 MCP server，默认禁用，用户在 settings 里开启 |
| `agents` | 注册 subagent 类型（带独立 system prompt + tools 白名单），可作为 `Task({ subagent_type: "<plugin>:<agent>" })` 的 type 值 |
| `statusLines` | 注册状态栏命令变体 |
| `modes` | 注册自定义 mode |

**安装方式**：

```bash
deepcode plugin install ./local-dir                  # 本地路径
deepcode plugin install gh:user/repo                 # GitHub
deepcode plugin install deepcode-plugin-foo          # npm
deepcode plugin install foo@<marketplace>            # 注册表（marketplace）安装
deepcode plugin marketplace add user/repo            # 添加自定义 marketplace（指向 GitHub repo 的 index.json）
deepcode plugin list / enable / disable / remove
```

**Marketplace 机制**：

- v1 内置官方 marketplace 索引（一份静态 JSON 托管在 oratis/deepcode-marketplace），列出审核过的插件
- 用户可 `marketplace add` 任意 GitHub repo 作为额外 marketplace 源
- Settings.json 可配 `allowedChannelPlugins` / `strictKnownMarketplaces` / `blockedMarketplaces` 控制安全策略
- `pluginTrustMessage` 字段定义首次装某 marketplace 插件时的信任提示文案

**装载流程**（harness 启动时）：

1. 扫描 `~/.deepcode/plugins/*` 与 npm global 中 `deepcode-plugin-*` 包
2. 读 manifest → 校验 schema → 检查 `enabled`（settings.json 中 `disabledPlugins` 黑名单）
3. 调用插件的 `register()` 钩子（可选，用于动态生成 skill）
4. 把 contributes 项合并到全局注册表（skill registry / command registry / mcp registry / hook chain）

**Mac 客户端的"插件市场"**：

- 设置 → Plugins 一级菜单
- 三个 tab：`Installed` / `Marketplace`（v1.1+）/ `Develop`（本地路径快速 link）
- 每个插件卡片：名字 / 版本 / 描述 / 贡献的能力数（如 "3 skills · 2 commands · 1 MCP"）
- 启用 / 禁用 / 配置 / 卸载

### 3.15 Harness 层（运行时底座）

到目前为止 §3.1–§3.14 是 _能力_ 的集合。**Harness 是把它们串起来跑的运行时**。这一节集中明确这个底座必须做的事。

**架构定位**：

```
                     ┌─────────────────────────────────────────┐
                     │             用户输入（CLI / GUI）        │
                     └────────────────────┬────────────────────┘
                                          ▼
        ┌─────────────────────────────────────────────────────────────┐
        │                          HARNESS                            │
        │  ┌──────────────────────────────────────────────────────┐   │
        │  │  事件总线 EventBus                                    │   │
        │  │  SessionStart · UserPromptSubmit · PreToolUse ·       │   │
        │  │  PostToolUse · Stop · Notification · SessionEnd       │   │
        │  └──────┬───────────────────────────────────────┬────────┘   │
        │         ▼                                       ▼            │
        │  ┌─────────────┐                       ┌──────────────────┐  │
        │  │ Context     │                       │ Hook Chain        │ │
        │  │ Curator     │                       │ (user + plugin)   │ │
        │  └─────────────┘                       └──────────────────┘  │
        │         │                                       │            │
        │         ▼                                       ▼            │
        │  ┌────────────────────────────────────────────────────────┐ │
        │  │             AGENT LOOP (provider-agnostic)              │ │
        │  └────────┬──────────────────────────────────────┬─────────┘ │
        │           ▼                                      ▼            │
        │  ┌─────────────────┐                    ┌─────────────────┐  │
        │  │ Tool Dispatcher │                    │ System-Reminder │  │
        │  │ + Permission    │                    │ Injector        │  │
        │  └────┬────────────┘                    └─────────────────┘  │
        │       │                                                       │
        │   ┌───┴────┬────────┬─────────┬──────────┬──────────┐         │
        │   ▼        ▼        ▼         ▼          ▼          ▼         │
        │ Tools   Skills   MCP      Subagents   Background  Cron       │
        │ (§3.2)  (§3.13)  (§3.3)   (Task)      (§3.15.3)   (§3.15.4)  │
        └─────────────────────────────────────────────────────────────┘
```

#### 3.15.1 System-reminder 注入器

Claude Code 经常在对话中段塞 `<system-reminder>` —— 这是 harness 主动注入的、不可见于用户但模型能看到的提示。DeepCode 必须有相同能力：

| 触发条件                              | 注入内容                                                            |
| ------------------------------------- | ------------------------------------------------------------------- |
| TodoWrite 列表 30 秒未更新且未完成    | "你的 todo 列表已 30s 未更新，考虑标记进度"                         |
| 当前文件在外部被改动（chokidar 监听） | "用户在 X 时修改了 src/foo.ts，最新内容如下…"                       |
| 上下文用量 > 70%                      | "上下文已用 70%，考虑触发 /compact 或精简对话"                      |
| 工具反复失败同一错误 ≥ 3 次           | "你已经第 4 次用同一参数调用 Bash 且失败，换思路"                   |
| MCP server 断连                       | "MCP server X 已断开，相关工具不可用"                               |
| 用户 30 分钟无输入后回来              | "用户回来了，距上次输入 30 分钟"                                    |
| 切换到 plan mode                      | "你现在在 plan mode，禁止任何写操作；输出计划后等用户 ExitPlanMode" |

实现位置：`packages/core/src/harness/reminder-injector.ts`，注册到 EventBus。

#### 3.15.2 Plan mode 状态机

- 进入：用户在 composer 切到 plan mode，或调用工具 `EnterPlanMode()`
- 状态：harness 在 EventBus 上发 `mode:plan` 事件 → tool dispatcher 把所有写工具（Write/Edit/Bash with non-readonly args）改为 `deny`
- 退出：用户点 "Approve plan" → harness 调 `ExitPlanMode()` → mode 切回上一个（通常 `ask`）
- UI：plan mode 期间，composer 边框紫色高亮，发送按钮文本变成 "Continue plan"

#### 3.15.3 后台任务（TaskCreate / Monitor / TaskGet / TaskList / TaskStop / TaskOutput / TaskUpdate）

Claude Code 的核心运行时能力。DeepCode 完整实现：

| 工具         | 功能                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `TaskCreate` | 启动一个后台 shell 或子 agent，返回 task id；agent 主线程不阻塞                                                      |
| `TaskList`   | 列出当前会话的所有 task（状态：running / completed / failed）                                                        |
| `TaskGet`    | 拿单个 task 的完整 stdout/stderr/exit code                                                                           |
| `TaskOutput` | 拿 task 的最新输出片段（增量）                                                                                       |
| `TaskStop`   | kill 该 task                                                                                                         |
| `TaskUpdate` | 修改 task 元数据（如 title）                                                                                         |
| `Monitor`    | 流式订阅 task 输出 —— 每行 stdout 作为一个 notification 推给 agent，特别适合 `until <cond>; do sleep 2; done` 类轮询 |

实现：`packages/core/src/harness/task-manager.ts`，task 状态存 `~/.deepcode/sessions/<sid>/tasks/<tid>.json`，stdout 滚动写到对应 `.log` 文件。

#### 3.15.4 调度（CronCreate / CronList / CronDelete）

用于"每天早上 9 点跑一次 lint 报告"、"PR 状态轮询"等。

- 存储：`~/.deepcode/cron.json`，schema 对齐 Claude Code 的 routines
- 执行：harness 守护进程（CLI: `deepcode daemon`；GUI: 主进程后台线程）按 cron 表达式触发，每次新拉一个隔离 agent session 跑指定 prompt
- 用户可设"通知策略"：silent / notify-on-result / notify-always

#### 3.15.5 Worktree 隔离（EnterWorktree / ExitWorktree）

支持"在隔离的 git worktree 里让 agent 改东西"，避免脏工作区。

- 进入：`EnterWorktree({ baseBranch })` → harness `git worktree add` 一个临时目录 → 切换 CWD
- 退出：`ExitWorktree()` → 若有改动，自动 commit 到临时分支，返回路径 + 分支名给主会话；若无改动，自动清理

**settings.json 配置**：

```jsonc
{
  "worktree": {
    "baseRef": "main", // worktree 从哪个 ref 切
    "symlinkDirectories": ["node_modules", ".venv"], // 不复制、软链
    "sparsePaths": ["src/", "tests/"], // sparse-checkout 仅签出这些路径
    "bgIsolation": true, // 后台 agent 默认在 worktree 跑
  },
}
```

**`.worktreeinclude`** 文件（项目根）：声明哪些路径必须 copy 而非 symlink（例如本地 dev 配置）。

#### 3.15.6 Deferred tool loading（ToolSearch）

为了在工具数量爆炸（内置 + MCP + 插件，可能 100+ 个）时不让每轮调用都把所有工具 schema 塞进 context：

- 首轮 system prompt 里只列工具**名字 + 一句描述**
- 模型决定要用哪些工具的细节 → 调 `ToolSearch({ query: "keyword" 或 "select:<name>,..."})`
- harness 返回匹配工具的完整 JSON Schema → 下一轮该工具就可直接调用
- 工具被 `Search` 出来后，schema 缓存到当前会话上下文，不需要重复 search

**`alwaysLoad` 反向 opt-out**：某些常用工具或 MCP server 可在 settings.json 标 `alwaysLoad: true`，跳过 deferred 机制，每轮都直接带 schema：

```jsonc
{
  "mcpServers": {
    "filesystem": { "command": "...", "alwaysLoad": true },
  },
  "tools": {
    "Read": { "alwaysLoad": true },
    "Bash": { "alwaysLoad": true },
  },
}
```

#### 3.15.7 通知（Notification）

跨平台桌面通知：

- macOS：`osascript -e 'display notification ...'`
- Linux：`notify-send`
- 终端兼容降级：`\a` bell + 状态栏文本

触发场景：长任务完成、审批等待、cron 命中、错误等。可被 `Notification` hook 拦截改写。

#### 3.15.8 Statusline 命令执行器

**契约**（对齐 Claude Code）：用户的 `settings.json.statusLine.command` **以 JSON 从 stdin 接收上下文**（**不是**环境变量），输出 stdout 渲染到 CLI/GUI 状态栏。

stdin JSON 字段：

```jsonc
{
  "session_id": "...",
  "model": "deepseek-reasoner",
  "cwd": "/Users/oratis/Projects/x",
  "transcript_path": "~/.deepcode/sessions/<sid>.jsonl",
  "cost": { "input_tokens": 1234, "output_tokens": 567, "estimated_yuan": 0.018 },
  "version": "0.1.0",
  "output_style": "default",
  "mode": "default",
  "effort": "medium",
}
```

**刷新周期**：默认 5s，可通过 `DEEPCODE_STATUS_LINE_DEBOUNCE_MS` 环境变量覆盖。

CLI 用 ANSI cursor save/restore；GUI 用 React 组件订阅 statusline stream。

#### 3.15.9 Checkpointing / Rewind

**自动快照**：每次 `Edit` / `Write` / `Bash`（有副作用）调用前后，harness 自动写一份快照到 `~/.deepcode/sessions/<sid>/snapshots/`。

**触发 rewind**：

- 命令：`/rewind`
- 快捷键：在空 composer 上按 `Esc Esc`
- GUI：右侧文件面板 History tab 内每个快照都有 `↶` 按钮

**5 种回退操作**（弹层让用户选）：
| 操作 | 含义 |
|---|---|
| Restore code | 文件回到该快照，对话不变 |
| Restore conversation | 对话回到该点，文件不变 |
| Restore both | 都回 |
| Summarize-from-here | 把这一点之后的所有对话压缩成一段总结接续 |
| Summarize-up-to-here | 把这一点之前的所有对话压缩成一段总结作为新会话起点（替代 `/compact`） |

**存储管理**：sessions cleanup（`cleanupPeriodDays`）连带清理快照；单会话快照硬上限 200 份（超出 LRU 淘汰）。

#### 3.15.10 Trust Dialog（首次打开目录的信任确认）

首次在某目录下启动 DeepCode（或新会话切换到未见过的目录）时，弹出信任对话框：

```
DeepCode hasn't worked in /Users/oratis/Projects/new-thing before.

Trusting this directory will allow:
  • Hooks defined in .deepcode/settings.json to run
  • MCP servers in this project to start
  • apiKeyHelper command to execute
  • Loading .deepcode/skills/* and .deepcode/agents/*

[Trust this directory]   [Open in plan mode (read-only)]   [Cancel]
```

- 用户选 "Trust" → 写入 `~/.deepcode/trusted-dirs.json`
- 选 "plan mode" → 进入只读模式查看，但 hooks/MCP/apiKeyHelper 全部不执行
- Cancel → 退出
- 跨设备同步：`trusted-dirs.json` 默认不入 git，但用户可显式 share

---

### 3.16 与 Claude Code 对照清单（基于 v0.4 完整审计）

| Claude Code 能力                                               | DeepCode 实现位置 | 说明                                                          |
| -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| `Skill` tool + 完整 frontmatter                                | §3.13             | 完整复刻（含 effort/shell/hooks/disabled）                    |
| 内置 skills（init/verify/run/code-review/...）                 | §3.13             | DeepCode 同名实现 15 个；`claude-api → deepseek-api`          |
| Sub-agents `.claude/agents/*.md`                               | §3.13a            | `.deepcode/agents/*.md`，frontmatter 同构                     |
| Output styles                                                  | §3.13b            | 4 内置 + 自定义 `.deepcode/output-styles/*.md`                |
| Effort levels（low→max）                                       | §3.13c            | 完整映射到 DeepSeek-R1 reasoning budget                       |
| Plugins（contributes 多元能力）                                | §3.14             | 完整复刻 + `modes` 贡献点；marketplace 机制完整               |
| Memory 双系统 + `#` + `@-import` + AGENTS.md                   | §3.6a             | 完整复刻；`~/.deepcode/projects/<repo>/memory/` 主题文件      |
| `.claude/rules/*.md` path-scoped                               | §3.6a             | `.deepcode/rules/*.md`                                        |
| `<system-reminder>` 注入                                       | §3.15.1           | 完整复刻                                                      |
| `EnterPlanMode` / `ExitPlanMode`                               | §3.15.2 / §3.2    | 完整复刻                                                      |
| `TaskCreate` 系列 + `Monitor`                                  | §3.15.3 / §3.2    | 完整复刻                                                      |
| `Bash(run_in_background)` + `⌃B`                               | §3.2 / §3.15.3    | 完整复刻                                                      |
| `CronCreate` / 远程 routines                                   | §3.15.4 / §3.2    | 本地实现；v1 不做云端远程                                     |
| `EnterWorktree` / `ExitWorktree` + 配置                        | §3.15.5 / §3.2    | 完整复刻 + baseRef/symlinkDirectories/sparsePaths/bgIsolation |
| `ToolSearch` + `alwaysLoad` opt-out                            | §3.15.6 / §3.2    | 完整复刻                                                      |
| `Notification` event                                           | §3.15.7           | 完整复刻                                                      |
| `statusLine.command`（JSON-on-stdin）                          | §3.15.8           | 完整复刻                                                      |
| **Checkpointing / Rewind**                                     | §3.15.9           | `/rewind` + `Esc Esc` + 5 操作                                |
| **Trust dialog**                                               | §3.15.10          | gating hooks/MCP/apiKeyHelper                                 |
| **Sandbox 子系统**（bwrap + sandbox-exec）                     | §3.9a             | 完整实现                                                      |
| `AskUserQuestion` 工具                                         | §3.2              | 完整复刻                                                      |
| `NotebookEdit` 三模式                                          | §3.2              | 完整复刻                                                      |
| MCP 三 scope / OAuth / headersHelper / Elicitation / mcp serve | §3.3              | 完整复刻                                                      |
| MCP resources `@server:proto://` + prompts as slash            | §3.3 / §3.10      | 完整复刻                                                      |
| Hooks 9 事件 × 5 handler 类型 + `if` + JSON 输出               | §3.6              | 完整复刻                                                      |
| 30+ Slash commands + 自定义命令文件                            | §3.6              | 完整复刻；`.deepcode/commands/*.md` frontmatter               |
| `/init` 多阶段交互                                             | §3.6              | 完整复刻                                                      |
| Modes 5 档 + auto 分类器                                       | §3.8              | 完整复刻                                                      |
| settings.json ~50 字段                                         | §3.9              | 完整复刻；不含 managed/MDM 层                                 |
| Permission glob 两种语法                                       | §3.9              | 完整复刻                                                      |
| Image paste / drag-drop / `[Image #N]`                         | §3.10             | 完整复刻                                                      |
| Vim 模式 + `keybindings.json`                                  | M8                | 完整复刻                                                      |
| Auth 双 header + apiKeyHelper 刷新 + setup-token               | §3.4              | 完整复刻                                                      |
| CLI 全套 17 flags + headless `-p` + stream-json + json-schema  | §5 / §5a          | 完整复刻                                                      |
| IDE 扩展（VS Code / JetBrains）                                | §4a               | v1 留 Bridge stub；v1.1 落地                                  |
| LSP 工具                                                       | §3.2              | v1.1                                                          |
| Managed/MDM policy 层                                          | —                 | **v1 不做**（非企业产品）                                     |
| 远程触发（`RemoteTrigger`） / 云端 routines / Slack / 网页端   | —                 | **不做**（v1 无云端）                                         |
| Computer-use / Chrome MCP / Preview MCP                        | —                 | **不做内置**；用户可装第三方插件                              |
| PowerShell tool                                                | —                 | **不做**（Mac/Linux 为主）                                    |
| `mcp__ccd_session__*`（章节标记 / 任务派生）                   | —                 | v1.1+ 由插件提供                                              |

---

## 4. Mac 客户端技术选型

| 选项                    | 选 / 不选 | 理由                                                                                                |
| ----------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| Electron + React + Vite | ✅        | 生态成熟、能直接 `require("@deepcode/core")` 跑同一份 Node 代码；xterm.js + node-pty 嵌入终端零成本 |
| Tauri                   | ❌        | Rust ↔ Node 的桥让"复用 core"变成大工程                                                             |
| 原生 Swift              | ❌        | 等于把 core 在 Swift 重写一遍                                                                       |

**UI 栈**：

- React 18 + TypeScript
- Tailwind CSS + shadcn/ui（深色为主）
- xterm.js（嵌终端，给 Bash 工具 / 也给一个可选的"raw shell"标签）
- monaco-editor（编辑器内嵌 diff view）
- Zustand（状态）
- electron-builder 打包 `.dmg`（universal binary，arm64 + x86_64）

**性能**：核心循环跑在主进程 Node 里，渲染进程通过 IPC 拿事件流（`onTextDelta`、`onToolUse`、`onToolResult`），这样长任务不卡 UI。

---

## 4a. IDE Bridge（v1 桩 · v1.1 落地 VS Code + JetBrains 扩展）

按你的决策（v1.1 快跟），M6 阶段在 `@deepcode/core` 暴露一个 **IDE Bridge** 接口（JSON-RPC over stdio），v1.1 阶段在此之上各自做两个扩展。

### Bridge 协议设计（v1 桩）

```typescript
// packages/core/src/ide-bridge/index.ts
export interface IDEBridge {
  // 编辑器 → DeepCode
  openSession(opts: { cwd: string; initialPrompt?: string }): Promise<SessionId>;
  sendMessage(sid: SessionId, msg: string): AsyncIterable<AgentEvent>;
  approveToolCall(sid: SessionId, callId: string, approved: boolean): Promise<void>;
  cancel(sid: SessionId): Promise<void>;
  resumeSession(sid: SessionId): Promise<void>;

  // DeepCode → 编辑器（编辑器需要订阅这些事件以更新 UI）
  on(evt: 'openFile', cb: (path: string, line?: number) => void): void;
  on(evt: 'applyDiff', cb: (path: string, oldText: string, newText: string) => void): void;
  on(evt: 'showMessage', cb: (msg: string, severity: 'info' | 'warn' | 'error') => void): void;
  on(
    evt: 'askApproval',
    cb: (toolCall: ToolCallInfo, callback: (ok: boolean) => void) => void,
  ): void;
}
```

启动方式：编辑器扩展执行 `deepcode ide-bridge --stdio`，stdin/stdout 双向 JSON-RPC。

### v1.1 扩展能力（两端共有）

| 能力                     | VS Code                                                             | JetBrains   |
| ------------------------ | ------------------------------------------------------------------- | ----------- |
| @-mention 文件 / 符号    | 自动补全编辑器打开的文件                                            | 同          |
| Inline diff 提案         | DeepCode 改一个文件 → VS Code 弹原生 diff view 让用户 accept/reject | 同          |
| Plan review              | Plan mode 输出后在 IDE 侧弹卡片，含"Approve plan"按钮               | 同          |
| 会话历史侧栏             | DeepCode panel webview                                              | tool window |
| Status bar 指示          | mode / model / token 用量                                           | 同          |
| `⌘⇧L` 唤起 DeepCode 输入 | ✅                                                                  | ✅          |

**v1.1 不做**：完整的 GUI（Mac 客户端已有）；语音输入（系统级，留给 OS）；插件管理界面（路由到 `deepcode plugin` CLI）。

## 4b. 自动更新机制（Mac 客户端 · 对齐 Claude Code "Relaunch to update" 体验）

### 4b.1 用户可见的更新流程

完全复刻 Claude Code 的更新交互（参考用户提供的截图："Relaunch to update v1.9255.2"）：

1. **后台检查**：Mac 客户端启动后每 4 小时（可配 `update.checkIntervalHours`）静默轮询 GitHub Releases API。
2. **后台下载**：如发现新版且语义版本号大于当前，立即在后台下载 `.dmg` 增量包到 `~/Library/Application Support/DeepCode/updates/`，下载完成后**不打扰用户**。
3. **就位提示**：下载完成后，主窗口右上角浮出非阻塞 **Relaunch banner**：

   ```
   ╭───────────────────────────────────────╮
   │ 🍃  Relaunch to update          →    │
   │     v0.2.1                            │
   ╰───────────────────────────────────────╯
   ```

   - 使用 DeepCode 的猫 icon（不是 Claude Code 的 leaf）
   - 显示完整 semver 版本号
   - 整个 banner 可点击 → 触发"退出并升级"
   - 右上角小 × 可暂时关闭（下次启动重弹）

4. **一键升级**：点击 → 保存当前会话状态 → 退出主进程 → 替换 .app bundle → 重启 → 自动 resume 之前的会话。
5. **强制更新**：如 release 标记了 `mandatory: true`（用于修关键安全 bug），banner 变红色无法关闭，必须升级。

### 4b.2 实现栈

| 组件     | 选型                                                                              |
| -------- | --------------------------------------------------------------------------------- |
| 更新核   | **`electron-updater`** + GitHub Releases provider                                 |
| Feed URL | `https://github.com/oratis/deepcode/releases/latest` 自动解析 `latest-mac.yml`    |
| 签名     | Apple Developer ID 代码签名 + notarization（必须，否则用户更新被 Gatekeeper 拦）  |
| 增量     | electron-updater 默认走全量 `.dmg`；后续考虑 `delta` 增量包（macOS sparkle 风格） |
| 版本号源 | `apps/desktop/package.json` 的 `version` 字段，CI 阶段从 git tag 自动注入         |

### 4b.3 settings.json 字段

```jsonc
{
  "update": {
    "channel": "stable", // stable / beta / nightly
    "checkIntervalHours": 4,
    "autoDownload": true, // false 则只通知，不后台下载
    "autoInstallOnQuit": false, // 退出时是否自动安装（默认 false，要用户点 Relaunch）
  },
}
```

### 4b.4 CLI 端（无桌面壳，但同样要能升级）

CLI 没有 banner UI，走显式命令：

```bash
deepcode upgrade                 # 拉最新 npm 包，替换全局安装
deepcode upgrade --channel beta  # 升级到 beta channel
deepcode --version               # 当前版本
```

CLI 在启动时若发现 npm 上有新版会在 banner 区单行提示一次：

```
ℹ DeepCode v0.2.0 → v0.2.1 available · run `deepcode upgrade`
```

不强制不阻塞。

### 4b.5 回滚

```bash
deepcode upgrade --to v0.2.0     # 显式降版到指定 tag
```

Mac 客户端：长按 banner 上的 → 0.5s 出菜单"Install other version..."，弹列表选历史 release。

## 5. CLI 安装路径与全套 flags

```bash
# 安装（包名: deepcode-cli，命令: deepcode）
npm i -g deepcode-cli
brew install oratis/tap/deepcode    # Homebrew tap (v1.1)

# 基础
deepcode                                  # 进入 REPL
deepcode -p "fix the bug in src/foo.ts"   # headless 一次性，见 §5a
deepcode --resume                         # 选会话
deepcode --continue                       # 继续上次
deepcode --fork-session                   # 派生分支会话（不破坏原会话）

# 模式 / 模型 / 思考
deepcode --mode plan
deepcode --permission-mode acceptEdits
deepcode --model deepseek-reasoner
deepcode --effort high

# 系统 prompt / 上下文
deepcode --system-prompt "..."             # 完全覆盖默认 system prompt（危险）
deepcode --append-system-prompt "..."      # 在默认 prompt 之后追加
deepcode --append-system-prompt-file ./prompt.md
deepcode --max-turns 12                    # 最多 12 轮自动循环
deepcode --bare                            # 极简模式：不加载 skills / 不加载 MCP / 仅核心工具

# 工具白名单
deepcode --allowedTools "Read,Grep,Edit"
deepcode --disallowedTools "Bash,WebFetch"

# 子代理与 MCP
deepcode --agents .ci/agents/             # 用此目录覆盖默认 sub-agents
deepcode --mcp-config ./custom-mcp.json   # 用此文件覆盖 MCP servers
deepcode --plugin-dir ./local-plugins/    # 临时挂载本地插件目录
deepcode --plugin-url gh:foo/bar@main     # 临时挂载远程插件

# 配置覆盖
deepcode --settings ./settings.override.json

# 调试
deepcode --verbose                         # 打印 LLM 请求 / 工具调用细节
deepcode --include-partial-messages       # stream 输出包含未完成 chunk

# 服务子命令
deepcode doctor                            # 自检
deepcode daemon                            # 启动 cron / 后台任务守护进程
deepcode mcp list / add / remove / serve
deepcode plugin list / install / enable / disable / remove
deepcode plugin marketplace add / remove
deepcode config get / set / edit
deepcode setup-token                       # CI 长期 token
```

### 5a · Headless / CI 模式（`-p`）

`deepcode -p` 是非交互一次性运行，专门给 CI / 脚本用。

```bash
# 文本输出（默认）
deepcode -p "审查 src/ 的安全问题" --output-format text

# JSON 输出（包含 token 用量、工具调用列表）
deepcode -p "..." --output-format json

# Stream-JSON（每条 message / tool call 一行 JSON，便于流式消费）
deepcode -p "..." --output-format stream-json --include-partial-messages

# 强约束输出 schema（agent 最终必须按这个 JSON schema 输出）
deepcode -p "把 README 提取成 {title, sections[]} 的 JSON" \
  --output-format json \
  --json-schema ./schemas/readme.json
```

**Exit codes**：`0` 正常完成 / `1` 一般错误 / `2` token 上限 / `3` 工具被 deny / `4` `max-turns` 触顶 / `5` API key 失效。

---

## 6. 里程碑（建议时间线 · v0.5 增加测试与文档行）

每个里程碑同时交付**实现 + 测试 + 文档**，三类产出齐头并进。M9 不再"集中补 docs"。

| 阶段                                                                       | 实现                                                                                                                                                                                               | 测试                                                                                                       | 文档                                                                                                                  |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **M0 · 周 1** · 项目骨架                                                   | monorepo / pnpm workspaces / TS / CI (GitHub Actions) / **§0.5 三份设计文档**（sandbox×plan×worktree 关系 · plugin 安全 · effort 数字核实）                                                        | CI 跑通 `pnpm typecheck` + 基础 lint                                                                       | `CONTRIBUTING.md` / `docs/design/*` 三份 / 仓库 README skeleton                                                       |
| **M1 · 周 2-3** · 内核 MVP                                                 | `@deepcode/core`：DeepSeekProvider + agent loop + 6 个 P0 工具 + sessions(jsonl) + 文件快照（与 §3.15.9 rewind / §3.11 共底层）+ trust dialog 基础                                                 | 单测：deepseek-chat 改文件；DeepSeek tool-calling 兼容性 matrix；reasoner 流式 fixture                     | `docs/core-api.md`：core 包导出符号清单                                                                               |
| **M2 · 周 4** · CLI MVP + 配置                                             | `apps/cli`：onboarding（双 header / apiKeyHelper 刷新）+ REPL + 30+ slash + settings.json 三层 + permissions matcher（两种 glob 语法）+ Trust dialog                                               | 集成测试：装包→填 key→改文件 完整链路；settings ~50 字段 schema 单测；permission glob 单测                 | `docs/cli-flags.md`：每个 flag 的完整 spec                                                                            |
| **M3 · 周 5-6** · 高级能力                                                 | Task 子代理 + Hooks 9 事件 × 5 handler + JSON 契约 + `if` 字段 + MCP 完整 + compaction + modes 5 档 + auto 分类器 + statusLine（JSON-on-stdin）+ Memory 双系统 + AGENTS.md 互操作 + `/init` 多阶段 | hook event 全部触发可验证；MCP OAuth / Elicitation e2e；auto-classifier latency benchmark                  | `docs/hooks.md` · `docs/mcp.md` · `docs/memory.md` · `BEHAVIOR_PARITY.md` 首版（slash + hooks）                       |
| **M3.5 · 周 7-8** · Sandbox（重估为 2 周）                                 | §3.9a 完整：Linux bwrap + macOS sandbox-exec + settings schema + 与 mode/permissions 集成（Windows 不实现）                                                                                        | **专项 e2e 攻击向量测试套**：fs 穿越 / net 逃逸 / 提权；fuzzer 跑常见 shell 注入                           | `docs/security-model.md`：完整威胁模型 + 防御覆盖                                                                     |
| **M4 · 周 9** · Skills + Sub-agents + Styles + Effort                      | 15 内置 skills + `.deepcode/agents/*.md` + 4 输出风格 + effort levels 全链路（数字按 §0.5 实测）                                                                                                   | 每个内置 skill e2e；frontmatter 解析单测；effort 切换 token-cost 量化                                      | `docs/skills-spec.md` · `docs/sub-agents.md` · `docs/output-styles.md` · `docs/effort-levels.md`（DeepSeek 实测数字） |
| **M5 · 周 10** · 插件体系 + Marketplace                                    | plugin.json 7 个 contributes + 4 种安装 + 示例插件 `deepcode-plugin-hello`（验 7 项 contributes）                                                                                                  | plugin sandbox 隔离测试；marketplace fetch + hash pin；恶意 plugin 拒绝                                    | `docs/plugin-author-guide.md` · `docs/marketplace.md`                                                                 |
| **M6 · 周 11-12** · Mac 客户端基础 + **自动更新** + IDE Bridge stub        | `apps/desktop`：Onboarding + Chat + Sessions + Settings + MCPManager + Plugins + Skills 管理；xterm + monaco；**§4b 自动更新（electron-updater + GitHub Releases）**；§4a IDE Bridge stub          | Electron 主/渲染 IPC；onboarding e2e；**自动更新流程在 staging release 验证**（手工触发一次 mock release） | `docs/desktop-architecture.md` · `docs/auto-update.md`                                                                |
| **M7 · 周 13** · Mac 客户端高级 + Rewind                                   | 右侧文件面板（Source/Diff/History）+ Composer（**不含 image — 推迟 v1.1**，详见 §0.2）+ Approval UI 内联 + 收起态 inspector + §3.15.9 Rewind UX                                                    | 文件面板 e2e；rewind 5 操作各自验证；快照清理验证                                                          | `docs/file-panel.md` · `docs/rewind.md`                                                                               |
| **M8 · 周 14** · Polish                                                    | Vim 模式 + keybindings.json + 语音输入（whisper.cpp 本地）+ effort UI 选择器 + 30+ slash UX 完整 + headless `-p`（stream-json / json-schema）+ Worktree 配置完善 + cron daemon 安装/卸载脚本       | Vim 状态机单测；语音延迟基准；headless 在 CI 实跑                                                          | `docs/vim-mode.md` · `docs/voice.md` · `docs/headless.md` · `BEHAVIOR_PARITY.md` 完整化                               |
| **M9 · 周 15** · 发布 v1                                                   | **GitHub Releases pipeline 上线**（§6a 自动 release）+ npm publish + 5 分钟 demo 视频 + 网站首页                                                                                                   | 全套回归在 release artifact 上跑；用户上手 ≤ 90s 体验测试                                                  | README 完整 · `docs/quickstart.md` · `docs/migration-from-claude-code.md` · `CHANGELOG.md`                            |
| **v1.1 · M10-13** · IDE + LSP + Marketplace 注册表 + **(可能) image 支持** | VS Code 扩展 + JetBrains 插件（基于 M6 Bridge）+ LSP 工具 + 中央 marketplace + 如 DeepSeek vision / Qwen-VL fallback 决策落地则补 image input                                                      | IDE 扩展 e2e；LSP 集成；image 输入回归                                                                     | IDE 扩展用户文档 · LSP 配置                                                                                           |

**总时长**：v1 = **15 周**（v0.4 → v0.5 延 1 周：sandbox 重估为 2 周，吸纳）+ v1.1 = 4 周

## 6a. 发布流程（GitHub Releases 为唯一渠道）

### 6a.1 触发与产物

```
git tag v0.X.Y → push
   ↓
GitHub Actions workflow `release.yml` 触发
   ├─→ 构建 CLI：tsc + bundling → 出 npm tarball
   │     └─→ 自动 `npm publish` 到 npm registry
   ├─→ 构建 Mac 客户端（macos-14 runner）：
   │     1. electron-builder 出 universal binary (arm64 + x86_64)
   │     2. codesign 用 Apple Developer ID（GitHub Secrets 注入）
   │     3. notarize via xcrun notarytool
   │     4. 出 `.dmg` + `latest-mac.yml`（electron-updater feed manifest）
   │     5. 出 `.zip`（备用）
   └─→ 上传所有产物到 GitHub Release
        - DeepCode-<ver>-arm64.dmg
        - DeepCode-<ver>-x64.dmg
        - DeepCode-<ver>-universal.dmg
        - latest-mac.yml          ← electron-updater 读这个判断版本
        - deepcode-cli-<ver>.tgz
        - CHANGELOG.md 节选 → release notes
```

### 6a.2 三个发布通道

通过 git tag 后缀区分通道，`latest-mac.yml` 各自独立：

| Tag 格式                  | Channel   | 受众                                 |
| ------------------------- | --------- | ------------------------------------ |
| `v0.2.1`                  | `stable`  | 默认 — 所有用户                      |
| `v0.3.0-beta.1`           | `beta`    | 设了 `update.channel: "beta"` 的用户 |
| `v0.3.0-nightly.20260605` | `nightly` | beta + 显式 opt-in                   |

### 6a.3 安全与签名

- **GitHub Secrets**：`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` / `NPM_TOKEN` / `CSC_LINK`（cert）/ `CSC_KEY_PASSWORD`
- **手动 approval gate**：workflow 设 `environment: production`，每次 release 必须有 maintainer 在 GitHub UI 点确认
- **emergency security release**：tag 后缀 `+security.X`（如 `v0.2.2+security.1`）→ workflow 自动设 `mandatory: true` 写到 `latest-mac.yml` → 触发 §4b.1 红色强制升级 banner

### 6a.4 Release notes 自动化

- PR 必须打 `release-notes:` label：`feature` / `fix` / `breaking` / `internal`
- `scripts/gen-release-notes.ts` 从上次 tag 起的所有 PR 按 label 汇总 → 注入 `CHANGELOG.md` 增量段 + GitHub Release body
- `internal` label 不出现在用户可见 release notes（保留在 CHANGELOG 完整版）

### 6a.5 与自动更新（§4b）的链路

```
开发者 push v0.2.1 tag
     ↓
GitHub Actions 构建 + 签名 + 发到 GitHub Release
     ↓
release.yml 同时更新 latest-mac.yml（stable channel 那份）
     ↓
所有已装的 Mac 客户端（默认 update.channel=stable）下次轮询命中
     ↓
后台下载 .dmg → 出 "Relaunch to update v0.2.1" banner
     ↓
用户点 banner → 退出 + 替换 + 自动恢复会话
```

整条链路 0 人工干预（除了那一次 manual approval gate）。

---

## 7. 风险与对策（v0.5 review 后扩充）

| 风险                                                              | 影响        | 对策                                                                                                                                  |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek 的 function calling 兼容性边角（多工具并发 / 长 schema） | 中          | M1 阶段写一份"工具调用兼容性 matrix" 测试套，发现差异在 provider 层补丁                                                               |
| `deepseek-reasoner` 的 `reasoning_content` 字段流式               | 低          | 单独走 `onThinkingDelta` 通道；不影响主循环                                                                                           |
| **DeepSeek 无 vision 模型**                                       | 高 → 已规避 | image input 推迟到 v1.1（§0.2）；v1.1 决策接 Qwen-VL 或等官方 vision                                                                  |
| **auto 分类器 mode 每工具调用 +1 LLM 往返**                       | 中          | M3 阶段做 latency benchmark；如延迟 > 3s 或准确率 < 90%，默认关闭 + 标"实验性"                                                        |
| **Sandbox 实现复杂度严重低估**                                    | 高 → 已规避 | M3.5 重估为 2 周（v0.4 的 1 周不现实）；M0 先出 `docs/design/sandbox-plan-worktree.md` 三者关系                                       |
| **Plugin 安装 = 任意 GitHub 代码 RCE**                            | 高          | M0 出 `docs/design/plugin-security.md`；v1 强制 plugin 在 sandbox 子进程跑；marketplace hash pin；首次装弹信任对话框                  |
| **上下文预算被 memory/skills/styles/MCP 总和吃光**                | 中          | M3 阶段做上下文预算 budget；超阈值时按优先级裁剪（skills 描述 → rules → auto-memory → 老对话）                                        |
| **Effort levels 数字与 DeepSeek API spec 不符**                   | 中 → 已规避 | M0 出 `docs/design/effort-levels.md`，实测核对 max_tokens 与 reasoning budget 上限                                                    |
| **`deepcode mcp serve` 反向暴露的线程/权限模型缺失**              | 中          | 推迟到 v1.1，v1 先实现 client；M3 出独立 design doc                                                                                   |
| **Cron daemon 在 Mac 客户端关闭后不跑**                           | 中          | M8 阶段做 launchd plist 安装；用户首次 `cron add` 时引导授权安装 daemon                                                               |
| MCP 生态依赖（用户的 server 来自 Claude 生态）                    | 低          | MCP 是协议层，client 实现一样通用                                                                                                     |
| Electron 体积大 / 用户嫌重                                        | 中          | `asar` + universal binary；CLI 用户根本不下载                                                                                         |
| API key 泄露                                                      | 高          | Keychain 优先；文件后备 chmod 600；任何日志打码（只显示前 4 / 后 4）                                                                  |
| 与 Claude Code 行为出现细节漂移 → 用户错愕                        | 中          | 维护一份 `BEHAVIOR_PARITY.md`，每个 slash command / hook 字段都标注"对齐 / 偏离 / 增强"                                               |
| **自动更新 Apple notarization 卡 review**                         | 中          | 提前申请 Apple Developer ID + notarization；M6 前确保有签名能力；备用：unsigned `.dmg` + 用户 right-click open 安装（首次需手动放行） |

---

## 8. 已敲定的决策（v0.2 锁定）

| #   | 决策点                         | 结论                                                                                                                                                                                                                   |
| --- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 品牌                           | **DeepCode**（单词、无空格、驼峰）；主色沿 DeepSeek 蓝 `#4D6BFE`                                                                                                                                                       |
| 1a  | Logo                           | **纯白大象头像** SVG（双圆耳 + 卵形头 + 弯曲象鼻），承载于品牌蓝渐变圆角方块上；所有尺寸用同一份 vector，CSS 控制大小                                                                                                  |
| 2   | CLI 包名                       | **`deepcode-cli`**（npm 包名）；命令 `deepcode`                                                                                                                                                                        |
| 3   | Base URL 配置                  | **提供**；`settings.json` 字段 `baseURL`，默认 `https://api.deepseek.com/v1`，支持国内中转                                                                                                                             |
| 4   | 项目级配置文件名               | **保留 `DEEPCODE.md`**（不换名）                                                                                                                                                                                       |
| 5   | settings.json 全集             | **完整实现**（详见 §3.9），项目级 / 用户级 / local 三层合并                                                                                                                                                            |
| 6   | Modes                          | **四档 + 插件自定义**（详见 §3.8）                                                                                                                                                                                     |
| 7   | 输入 Composer                  | **像素级对齐 Claude Code**（`@`/`/`/`#` + `+` 菜单 + 模型/Mode/mic + 上下文提示，详见 §3.10）                                                                                                                          |
| 8   | 右侧文件面板                   | **Mac 客户端实现**（Source/Diff/History 三视图，可拖宽多 tab，详见 §3.11）                                                                                                                                             |
| 9   | 右侧 inspector 默认形态        | **48px 窄条收起**，含 ▤/◐/📁/ⓘ/⚙ 五个图标按钮 + 顶部展开 ‹；`⌘\` 展开 320px 完整面板（详见 §3.10a）                                                                                                                    |
| 10  | Skills 体系                    | **完整复刻**（§3.13）；frontmatter 格式对齐 Claude Code（含 effort/shell/hooks/disabled）；15 个内置 skill；用户/项目/插件三层                                                                                         |
| 11  | 插件体系                       | **完整复刻**（§3.14）；7 个 contributes 贡献点；v1 支持 local + gh + npm + marketplace 四种安装方式                                                                                                                    |
| 12  | Harness 运行时                 | **完整复刻**（§3.15）；含 system-reminder / plan-mode / TaskCreate / cron / worktree（含 baseRef/symlinkDirectories/sparsePaths/bgIsolation）/ ToolSearch（含 alwaysLoad）/ Notification / statusLine（JSON-on-stdin） |
| 13  | Logo                           | 纯白**猫头剪影 SVG**（两尖耳 + 圆头 + 收窄下巴），前视；承载于品牌蓝渐变圆角方块（更早版本试过大象，识别度差，已换）                                                                                                   |
| 14  | Hook 事件数                    | **9 类**（§3.6）：PreToolUse / PostToolUse / Stop / **SubagentStop** / **PreCompact** / **PostCompact** / SessionStart / **SessionEnd** / UserPromptSubmit / Notification                                              |
| 15  | Hook handler 类型              | **5 种**（§3.6）：command / http / mcp_tool / prompt / agent；含 `if` 字段过滤、结构化 JSON 输出契约、安全 knobs（`disableAllHooks`/`allowedHttpHookUrls`/`httpHookAllowedEnvVars`）                                   |
| 16  | Modes 数                       | **5 + auto 分类器**（§3.8）：default / acceptEdits / plan / **auto（LLM-judged）** / dontAsk / bypassPermissions；修正 v0.3 的 4 档版本                                                                                |
| 17  | Slash commands                 | **30+ 内置**（§3.6）+ 用户/项目自定义命令文件 `.deepcode/commands/*.md`                                                                                                                                                |
| 18  | Memory 系统                    | **双系统**（§3.6a）：用户 `DEEPCODE.md`（递归 + @-import + AGENTS.md auto-import）+ agent 自动 memory `~/.deepcode/projects/<repo>/memory/`；`.deepcode/rules/*.md` path-scoped                                        |
| 19  | Sub-agents                     | **文件优先**（§3.13a）：`.deepcode/agents/*.md` + frontmatter；插件也可贡献（§3.14）                                                                                                                                   |
| 20  | 输出风格                       | **完整实现**（§3.13b）：4 内置 + 自定义 `.deepcode/output-styles/*.md`                                                                                                                                                 |
| 21  | Effort levels                  | **完整实现**（§3.13c）：5 档映射 DeepSeek-R1 reasoning budget + `max_tokens`；CLI flag / `/effort` / skill frontmatter / settings 全链路                                                                               |
| 22  | Sandbox 子系统                 | **完整实现**（§3.9a）：Linux bwrap + macOS sandbox-exec + 文件/网络白名单                                                                                                                                              |
| 23  | Checkpointing / Rewind         | **完整实现**（§3.15.9）：自动快照 + `/rewind` + `Esc Esc` + 5 种回退操作                                                                                                                                               |
| 24  | Trust dialog                   | **实现**（§3.15.10）：首次打开目录 gating hooks/MCP/apiKeyHelper                                                                                                                                                       |
| 25  | MCP 完整能力                   | **实现**（§3.3）：三 scope + `/mcp` 交互 + OAuth + headersHelper + alwaysLoad + 输出 cap + resources `@server:proto://` + `deepcode mcp serve` + Elicitation                                                           |
| 26  | Auth 双 header                 | **实现**（§3.4）：`DEEPSEEK_API_KEY`（X-Api-Key） + `DEEPSEEK_AUTH_TOKEN`（Bearer）+ apiKeyHelper 401 刷新 + 5min 周期 + `deepcode setup-token`                                                                        |
| 27  | CLI 全套 flags                 | **实现**（§5）：append-system-prompt / max-turns / bare / allowedTools / disallowedTools / permission-mode / agents / mcp-config / plugin-dir / plugin-url / json-schema / output-format / fork-session 等 17 个       |
| 28  | Headless / CI                  | **实现**（§5a）：`-p` + text/json/stream-json 输出 + JSON schema 强约束 + 5 个 exit codes                                                                                                                              |
| 29  | Image paste                    | **推迟到 v1.1**（DeepSeek 当前无 vision 模型；v1.1 决策接 Qwen-VL 或等 DeepSeek vision，详见 §0.2）                                                                                                                    |
| 30  | Vim 模式                       | **完整实现**：NORMAL/INSERT/VISUAL 状态机 + `~/.deepcode/keybindings.json`                                                                                                                                             |
| 31  | IDE 扩展                       | **v1.1 快跟**：M6 留 IDE Bridge stub（§4a），v1.1 单独发 VS Code + JetBrains                                                                                                                                           |
| 32  | LSP 工具                       | **v1.1**：jump-to-def / find-refs / 类型错误自动 surface                                                                                                                                                               |
| 33  | Managed/MDM 配置层             | **不做（v1）**：DeepCode 不是企业产品；schema 预留字段                                                                                                                                                                 |
| 34  | 云端 routines / Slack / 网页端 | **不做**：保持 §3.16                                                                                                                                                                                                   |
| 35  | Permission rule glob           | **两种语法都实现**（§3.9）：`Tool(arg:*)` 子命令匹配 + `Tool(arg *)` 前缀匹配                                                                                                                                          |
| 36  | **Mac 客户端自动更新**         | **完整实现**（§4b）：后台静默检查 + 下载 → "Relaunch to update vX.Y.Z" 浮层 → 一键重启升级；electron-updater + GitHub Releases；3 通道（stable/beta/nightly）                                                          |
| 37  | **发布渠道**                   | **GitHub Releases 唯一**（§6a）：tag push 触发 GHA → 自动 npm publish + 出签名公证 `.dmg` + 更新 `latest-mac.yml` feed；release-notes 由 PR label 自动生成                                                             |
| 38  | **Windows 支持**               | **explicit 非目标**（§0.2）：CLI 不主动测；GUI 不出；sandbox/PowerShell tool 不实现；用户走 WSL2                                                                                                                       |
| 39  | **团队规模假设**               | **≥ 5 人核心**（§0.4）：scope 是 ambition-level，不是工程量-bounded；单人 1-2 人需要砍 scope                                                                                                                           |
| 40  | **M0 必出三份设计文档**        | **强制**（§0.5）：`docs/design/sandbox-plan-worktree.md` · `docs/design/plugin-security.md` · `docs/design/effort-levels.md`；写代码前先出                                                                             |
| 41  | **测试与文档**                 | **与每个里程碑同步交付**（§6）：每个 M 自带测试 + docs 行，不再 M9 集中补                                                                                                                                              |

---

## 9. 下一步

读完这份方案 → 看同目录的 [`VISUAL_DESIGN.html`](./VISUAL_DESIGN.html)（在浏览器打开） → 反馈对架构 / 视觉 / 时间线的修订意见 → 进入 M0 拉骨架。
