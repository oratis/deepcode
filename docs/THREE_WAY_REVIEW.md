# DeepCode vs Claude Code vs Codex — 三方综合 Review

> 基线：`main@a8d3cb7`（0.2.0，app-server 架构落地后）· 日期 2026-08-02
> 核查方式：逐项对源码验证（不采信 `BEHAVIOR_PARITY.md`，该表历史上多次落后于代码）
> 实跑验证：`pnpm install` → `pnpm typecheck` 通过 → `pnpm test` exit 0，无失败用例

本文是一次性的现状评估，用于确定下一阶段优先级。它不替代
[`CODEX_ALIGNMENT_PLAN.md`](CODEX_ALIGNMENT_PLAN.md)（架构路线的事实源），
也不替代 [`BEHAVIOR_PARITY.md`](BEHAVIOR_PARITY.md)（Claude 兼容矩阵的历史快照）。

---

## 0. 结论先行

DeepCode 已经不缺"功能"。**内核层（工具、hooks、skills、plugins、MCP、sessions、sandbox、
sub-agent、cron）与 Claude Code 基本同级**，0.2.0 又补上了 Codex 式的 **app-server +
Thread/Turn/Item 协议 + 瘦客户端 + 凭证边界**——这是最贵、最不显眼、也最难补的一层，已经做完了。

真正的差距集中在三处，且**都不是"再加一个功能"能解决的**：

| #     | 差距                          | 一句话                                                                                                                                                             |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | **终端交互层落后一代**        | readline 行式 REPL vs Claude Code 的 Ink TUI / Codex 的 ratatui TUI。无颜色、无 diff、无 reasoning 展示、审批只有 `y/n/a`。用户 90% 时间在这里。                   |
| **B** | **安全默认姿态与 Codex 相反** | Codex：沙箱默认开 + 审批策略是**独立轴**。DeepCode：沙箱默认关，一个 `mode` 同时表达权限档位与审批策略——alignment plan §5.5 已判定要拆，尚未做。                   |
| **C** | **能力建成了但没有出口**      | `workspace/diff` + review apply/revert 在 protocol 和 VS Code 有，**桌面端 0 个 UI 入口**；桌面端 **0 个 slash 命令**（PlusMenu 仍写着 "palette lands in v0.2"）。 |

一句话：**后端已经是 Codex 级，前端还是 v0.1 级。下一阶段的 ROI 几乎全在 UI 出口，而不在功能清单。**

---

## 1. 三方定位差异（先说清，避免比错）

|          | DeepCode                                                | Claude Code                    | Codex                 |
| -------- | ------------------------------------------------------- | ------------------------------ | --------------------- |
| 模型     | DeepSeek 单一供应商（chat/reasoner/v4-flash/v4-pro）    | Claude 全家族 + Bedrock/Vertex | GPT-5.x-Codex 家族    |
| 实现     | TypeScript monorepo + Tauri(Rust) 外壳                  | TypeScript/Ink                 | Rust (`codex-rs`)     |
| 商业面   | 个人/OSS，无云端                                        | 云端账号、团队、Enterprise/MDM | 云端账号、Codex Cloud |
| 定价意识 | **深**（cache-hit 计价、reasoner 分档、`/cost` 命中率） | 有 `/cost`                     | 有用量视图            |

> **不要按"功能清单对齐"来做规划**。DeepCode 的护城河是"DeepSeek 上最好的本地 agent"，
> 竞品的一半功能（云端任务、团队、MDM）在这个定位下没有价值。

---

## 2. 能力矩阵

图例：`✅` 有且可用 · `🟡` 有但受限 · `⚠️` 有实现但无用户出口 · `❌` 无

### 2.1 Agent 内核

| 能力                      | DeepCode   | Claude Code            | Codex | 备注                          |
| ------------------------- | ---------- | ---------------------- | ----- | ----------------------------- |
| Read/Write/Edit/Glob/Grep | ✅         | ✅                     | ✅    | Edit 语义对齐（唯一匹配）     |
| Bash + 真取消             | ✅         | ✅                     | ✅    | 0.2.0 补了 POSIX 进程组       |
| NotebookEdit              | ✅         | ✅                     | ❌    |                               |
| WebFetch / WebSearch      | ✅         | ✅                     | 🟡    | DDG/SearXNG，无付费搜索       |
| TodoWrite                 | ✅         | ✅                     | ✅    |                               |
| Sub-agent (Task)          | 🟡 深度 1  | ✅ 多层 + 自定义 agent | ✅    | 深度 1 是刻意的安全上限       |
| 后台任务                  | ✅         | ✅                     | 🟡    | session 级持久                |
| 定时任务                  | ✅ launchd | ✅                     | ❌    | **DeepCode 独有**             |
| Plan mode                 | ✅         | ✅                     | ✅    |                               |
| Worktree 隔离             | ✅         | ✅                     | ✅    | 0.2.0 修了强删 branch 丢工作  |
| 自动 compaction           | ✅         | ✅                     | ✅    | 0.8 阈值                      |
| Rewind / checkpoint       | ✅ 5 操作  | ✅                     | 🟡    |                               |
| **图片输入**              | ❌ 仅骨架  | ✅                     | ✅    | `vision/index.ts` 无 provider |
| **推理链展示**            | ❌ 被丢弃  | ✅                     | ✅    | 见 F9                         |

### 2.2 安全与权限

|                    | DeepCode                                                  | Claude Code     | Codex                                   |
| ------------------ | --------------------------------------------------------- | --------------- | --------------------------------------- |
| 沙箱默认           | ❌ **默认关**（`sandbox.enabled` 未设 → 裸 `/bin/sh -c`） | 🟡 可选         | ✅ **默认开**（Seatbelt / Landlock）    |
| 沙箱能力           | ✅ seatbelt + bwrap + **DNS 级域名白名单**                | 🟡              | ✅                                      |
| 权限档 vs 审批策略 | ❌ 一个 `mode` 混表达 6 档                                | 🟡 mode + rules | ✅ **两条正交轴**（sandbox × approval） |
| 目录信任门禁       | ✅ 逐叶 provenance + trust gate                           | ✅              | ✅                                      |
| hook 命令逐条审核  | ✅ `deepcode hooks trust <hash>`                          | 🟡              | —                                       |
| 凭证不入 renderer  | ✅ 0.2.0 已做                                             | ✅              | ✅                                      |
| 审批时看 diff      | ❌ 纯文本 y/n/a                                           | ✅              | ✅                                      |

### 2.3 扩展生态

|                              | DeepCode                                      | Claude Code    | Codex          |
| ---------------------------- | --------------------------------------------- | -------------- | -------------- |
| MCP client                   | ✅ stdio/http/sse/OAuth/elicitation/resources | ✅             | ✅             |
| 自身作为 MCP server          | ✅ `deepcode mcp serve`                       | ✅             | ✅             |
| Hooks（10 事件 × 5 handler） | ✅                                            | ✅             | 🟡             |
| Skills                       | ✅                                            | ✅             | ✅             |
| Plugins + marketplace        | ✅                                            | ✅             | ❌             |
| 自定义 slash 命令            | ✅                                            | ✅             | ✅             |
| 记忆文件                     | ✅ `DEEPCODE.md` + `AGENTS.md` 层级 + @import | ✅ `CLAUDE.md` | ✅ `AGENTS.md` |
| **读 Claude Code 原有资产**  | ❌ 需手动 `mv ~/.claude → ~/.deepcode`        | —              | —              |

### 2.4 客户端与协议

|            | DeepCode                   | Claude Code      | Codex            |
| ---------- | -------------------------- | ---------------- | ---------------- |
| CLI 交互   | 🟡 readline 行式           | ✅ Ink 全屏 TUI  | ✅ ratatui TUI   |
| Headless   | ✅ text/json/stream-json   | ✅               | ✅ `exec --json` |
| 桌面 App   | ✅ Tauri（macOS）          | ✅ Mac/Win + Web | 🟡 Web/IDE       |
| VS Code    | 🟡 7 命令，无 chat 侧栏    | ✅ 深度集成      | ✅ 深度集成      |
| 其他编辑器 | ✅ LSP bridge              | 🟡 JetBrains     | 🟡               |
| 统一协议   | ✅ 13 method + capability  | 内部 SDK         | ✅ app-server    |
| 跨端恢复   | 🟡 消息级可以，item 级不行 | ✅               | ✅               |
| 云端/团队  | ❌                         | ✅               | ✅               |

---

## 3. 界面差异

### 3.1 CLI —— 最大短板

DeepCode CLI 是 `node:readline` 的**行式 REPL**（`apps/cli/src/repl.ts`），没有任何 TUI 框架。

| 交互         | DeepCode                               | Claude Code        | Codex         |
| ------------ | -------------------------------------- | ------------------ | ------------- |
| 渲染         | 纯文本，无 ANSI 颜色                   | 全屏 Ink，语法高亮 | 全屏 ratatui  |
| 工具调用展示 | 一行 + 结果**截断 200 字符**           | 折叠卡片 + diff    | 结构化 + diff |
| 编辑 diff    | ❌ 完全不显示                          | ✅ 彩色 diff       | ✅            |
| 推理内容     | ❌ `thinking_delta` 直接丢弃           | ✅                 | ✅ reasoning  |
| 审批 UI      | `[y]/[n]/[a]` 单行，**看不到要改什么** | 菜单 + diff 预览   | `/approvals`  |
| 模式切换     | 只能 `/mode xxx`                       | `Shift+Tab` 循环   | `/approvals`  |
| `@` 文件补全 | ❌（`@` 仅用于 MCP resource）          | ✅ 模糊补全        | ✅ `/mention` |
| 图片粘贴     | ❌                                     | ✅                 | ✅            |
| 转录回看     | ❌                                     | ✅ `Ctrl+R`        | ✅            |
| statusline   | 🟡 core 有模块，CLI 未渲染             | ✅                 | ✅            |

**影响**：DeepSeek reasoner 是本项目的核心卖点，而 CLI 把它的思考过程整个丢掉了；同时
"agent 改了什么"在批准前后都看不见——两点合起来让**可信度感知**比竞品低一档，与功能多少无关。

### 3.2 桌面端 —— 骨架完整，出口缺失

已有：三栏 shell、会话侧栏（搜索/重命名/归档/删除）、聊天流 + ToolCard、内联审批、
AskUserQuestion、模式/模型/effort 下拉、Inspector、FilePanel（Source/Diff/History）、
右侧活动栏、语音输入、设置族屏、更新横幅。

缺口（按影响排序）：

1. **0 个 slash 命令**。`PlusMenu` 的 "Slash command" 只往输入框插一个 `/`，描述写着
   "palette lands in v0.2"——而现在就是 v0.2.0。CLI 的 38 个命令桌面端一个都用不了。
2. **Review 工作流没有 UI**。`protocol-agent.ts` 已实现 `diff()` / `applyFindings()` /
   `revertAction()`，但 `screens/` + `components/` 里没有任何调用。有引擎没有方向盘。
3. **恢复会话丢结构**。resume 会调 `resumeProtocolThread()`，但 UI 转录是从 canonical
   session 的 role/content 消息重建的——协议持久化的 tool_call / approval / review_finding
   item 恢复后不显示。
4. 无 Projects 两级概念；无长任务状态机（只有 `busy` 布尔）。

### 3.3 IDE

- **VS Code**：7 个命令（Open Panel / Run on selection / Review current diff / Apply
  finding / Apply all / Revert / Diagnostics）。已是协议瘦客户端，**review 闭环只有这里最完整**，
  但缺持续的 chat 侧栏。
- **LSP**：12 个 `workspace/executeCommand` + `deepcode/protocolEvent`。作为编辑器兼容层合理，
  且**是三方里唯一提供通用 LSP 桥的**（Neovim/Emacs 用户的差异化优势）。

---

## 4. 审计发现清单

### P0 — 用户可见的错误信息 / 承诺落空

- **F1. `--help` 宣传了 5 个不生效的 flag。** `--agents` / `--mcp-config` / `--plugin-dir` /
  `--plugin-url` / `--strict` 在 `parse-args.ts` 被解析进 `ParsedArgs`，但全仓无任何消费点，
  而 `helpText()` 的 OVERRIDES 段把它们当成可用功能列出。与已修的 `--permission-mode` 同一类坑。
- **F2. `--bare` 的 help 文案描述的是另一个功能。** help 写 "No plugins / MCP / skills"，
  实现只是跳过启动 banner。真正"关插件"的是 `--no-plugins`。
- **F3. 版本号与发布状态不一致。** `CHANGELOG.md` 已写 `[0.2.0]`，但 cli / desktop /
  `tauri.conf.json` 都还是 `0.1.6`。
- **F4. 定位叙事自相矛盾。** README 已改为不承诺 1:1 parity，但 `helpText()` 首行仍是
  `(Claude Code parity)`、cli package description 是 `parity with Claude Code`、
  `MIGRATION_FROM_CLAUDE_CODE.md` 开头仍是 "targets Claude Code parity" 且 `/login` 标注
  "n/a"（实际已实现）。

### P1 — 既定架构决策未落地

- **F5. 沙箱默认关闭。** `sandbox/index.ts` 在 `!config?.enabled` 时直接裸 `/bin/sh -c`，
  且配置无默认值。seatbelt + bwrap + DNS 白名单都已实现并有测试，默认关是纯粹的浪费。
- **F6. `mode` 仍混表达权限档位与审批策略。** alignment plan §5.5 明确要拆，但 `VALID_MODES`
  仍是 6 个混合值，CLI 也没有 `--sandbox`。这是与 Codex 最本质的差距，并损害可解释性。
- **F7.** 桌面端 review 能力无出口（见 §3.2-2）。
- **F8.** 恢复会话丢失结构化 item（见 §3.2-3）。

### P2 — 体验与一致性

- **F9.** CLI/桌面均丢弃 reasoning。
- **F10.** CLI 工具结果硬截断 200 字符，大输出无法查看。
- **F11.** 审批无 diff 预览。
- **F12.** `deepcode upgrade` 输出泄漏内部文档编号（"see §4b"）。
- **F13.** 图片输入是空壳（DeepSeek 无 vision 模型，接口已定义但无 provider、无 UI）。
- **F14.** `CLAUDE.md` 不被 memory loader 读取，仅在"缺失提醒"里判断存在性；迁移靠手动 `mv`。
  对"从 Claude Code 迁移"这个主要获客路径，这是最大的一颗砂子。
- **F15.** 协议缺 `thread/list` / `fork` / `archive` / `search`，客户端回落 legacy session API，
  形成两套读路径。

---

## 5. 建议路线（按 ROI 排序）

### 第一梯队 —— 直接决定"用起来像不像一线工具"

1. **CLI 渲染层**。不必上 Ink，三件事拉平大半差距：工具卡片着色 + Edit/Write **彩色 diff**；
   审批时打印将要发生的 diff / 命令全文，选项扩为 `y / n / a / d(iff)`；reasoning 灰色折叠流。
   改动集中在 `repl.ts` 的 `formatEvent` + 审批回调，**小改动、大观感**。
2. **桌面 slash 命令面板**。CLI 已有 38 个命令的纯函数实现，桌面缺的只是"输入 `/` → 弹出过滤
   列表 → 走 SessionContext"。
3. **桌面 Changes/Review 面板**。协议侧全部就绪，只需一个右栏 tab：`workspace/diff` 列文件 →
   看 hunk → Apply/Revert。这是 Codex 的招牌体验，DeepCode 是三方里唯一"有引擎无方向盘"的。

### 第二梯队 —— 把已定的架构决策做完

4. **沙箱默认开 + `--sandbox` 正交轴**：`read-only / workspace-write / danger-full-access`，
   与 `mode`（审批策略）正交；`bypassPermissions` 降级为"不问但仍沙箱"，另设显式的
   `--dangerously-*` 才彻底放开。一次消化 F5 + F6。
5. **恢复时重放结构化 item**：resume 走 `thread/read` 的 items 而非 session 消息投影。
6. **协议补 `thread/list` / `archive` / `fork`**，消除客户端两套读路径。

### 第三梯队 —— 文档与承诺一致性

7. 一次性清掉 F1–F4。
8. **只读支持 `~/.claude/` 与 `CLAUDE.md`**：获客成本最低的一项，让 Claude Code 用户装完直接跑，
   而不是先做 5 步 `mv`。

---

## 6. 明确不建议追

| 项                                                            | 理由                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| 云端任务 / 团队协作 / MDM                                     | 与"本地 DeepSeek agent"定位无关，成本极高             |
| 图片输入                                                      | DeepSeek 无 vision 模型，接了也没有后端；保留骨架即可 |
| `/teleport` `/desktop` `/migrate-installer` `/terminal-setup` | 依赖各自专有基础设施，复刻只是空壳命令                |
| 多 provider 支持                                              | 稀释定位，并让 effort/pricing/cache 差异化失效        |
| 追 Codex 每周变化                                             | alignment plan §8 已写明只对齐稳定原则，正确          |

---

---

## 7. 进展跟踪

本文 §4 的清单是 2026-08-02 的快照。已落地的部分记录在这里，**不回改上面的快照**——
让一份评估随实现悄悄变形，正是它自己批评的那种漂移。

| 发现                                          | 状态                                              | PR   |
| --------------------------------------------- | ------------------------------------------------- | ---- |
| F1 `--help` 宣传 5 个不生效的 flag            | ✅ 已从 help 移除并在使用时告警                   | #217 |
| F2 `--bare` 文案错误                          | ✅                                                | #217 |
| F3 版本号不一致                               | ✅ 全部对齐 0.2.0 + 一致性测试 + release 补 stamp | #217 |
| F4 定位叙事矛盾                               | ✅                                                | #217 |
| F5 沙箱默认关                                 | ✅ 默认 `workspace-write`                         | #226 |
| F6 `mode` 混表达两件事                        | ✅ `--sandbox` 正交轴                             | #226 |
| F7 桌面 review 能力无出口                     | ✅ Changes 面板                                   | #220 |
| F8 恢复丢结构化 item                          | 🔄 未做                                           | —    |
| F9 丢弃 reasoning                             | ✅ CLI 已流式展示（桌面仍丢）                     | #218 |
| F10 工具结果硬截断 200 字符                   | ✅ 改为中段省略                                   | #218 |
| F11 审批无 diff 预览                          | ✅                                                | #218 |
| F12 `upgrade` 泄漏内部文档编号                | ✅                                                | #217 |
| F13 图片输入空壳                              | ⚠️ 有意保留（DeepSeek 无 vision 后端）            | —    |
| F14 不读 `CLAUDE.md` / `~/.claude`            | ✅ 就地读取                                       | #227 |
| F15 协议缺 `thread/list` / `fork` / `archive` | 🔄 未做                                           | —    |
| A 桌面 0 个 slash 命令                        | ✅ 命令面板                                       | #219 |

### 实现过程中额外发现（快照里没有的）

- **`deepcode --version` 一直印 `0.1.0`**：它读 core 的 `VERSION` 常量，而 release 工作流只
  patch `apps/cli/package.json`。每个发布版的 `--version` / `--help` / `/upgrade` / `/bug`
  都是错的。（#217）
- **macOS 沙箱一旦启用就读不到工作目录**：profile 是 `(deny default)` 且没有 cwd 规则，
  Linux 侧却 bind 了 cwd 读写。没人撞上是因为默认没人开得起来。（#226）
- **桌面事件信封被 payload 覆盖**：`{ kind: 'event', ...payload }` 里 `review_action` 的
  payload 自带 `kind: 'apply'|'revert'`，把信封判别字段覆盖掉了；按文档形状过滤的消费者
  会静默丢弃这些事件。之所以没人发现，是因为在此之前根本没有消费者。（#220）
- **skills / sub-agents 同名不去重**：同名 skill 会被向模型描述两次，同名 agent 由
  `.find()` 解析到先扫到的那个。（#227）
- **`format:check` 不覆盖 `.css`**：一个 postcss 解析不了的样式表能通过格式门禁；只有
  Playwright 旅程能发现。（本 PR 已把 css 纳入 glob）

### 仍未做

- **F8 / 建议 5** —— 恢复会话时重放结构化 item（走 `thread/read` 的 items 而非消息投影）。
- **F15 / 建议 6** —— 协议补 `thread/list` / `archive` / `fork`，消除客户端两套读路径。
- 桌面端仍丢弃 reasoning（CLI 已修）。
- Linux (bwrap) 侧的沙箱模式只共享了解析逻辑，**没有在 Linux 主机上做过 #226 那样的实测**。

## 附：Codex 侧信息的可信度声明

Claude Code 侧的对照来自实际能力核对。**Codex 侧**基于其公开的稳定设计（`codex-rs` 分层、
app-server 的 thread/turn/item、`--sandbox` × `--ask-for-approval` 双轴、ratatui TUI、
worktrees、`AGENTS.md`、`config.toml`、Cloud/PR review），与 `CODEX_ALIGNMENT_PLAN.md` §2
引用的 2026-08-01 官方文档一致；**具体命令名与最新版行为请以官方文档为准**——本报告的结论不
依赖任何单条命令级细节。
