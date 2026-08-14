# DeepSeek Harness (`dsh`) 调研报告

> 调研对象：[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
> 基线：`47f94385`（2026-08-13）· 版本 `0.1.0-rc.5` · MIT
> 方式：**一手克隆通读**源码树与 `docs/`，不采信第三方转述
> 对照基线：DeepCode `main@4d56f44`（0.3.0）
> 配套文档：[采纳方案与辩论](../DSH_ADOPTION_PLAN.md)

---

## 0. 证据分级

沿用 [Floatboat 调研](floatboat.md)确立的分级，**只有 A/B 级可作为设计依据**：

| 级别 | 含义                                                 |
| ---- | ---------------------------------------------------- |
| A    | 亲自读过该仓库的源码或规范文本，可指出文件路径       |
| B    | 该仓库自己的文档明确声明，但未跑通验证               |
| C    | 第三方转述、发布稿、社区讨论 —— **不得作为设计依据** |

本报告未运行 `dsh`（需要 `DEEPSEEK_API_KEY` 与完整 `pnpm build`），因此**所有关于运行时行为的
结论均为 B 级**；关于代码组织、接口形状、包边界的结论为 A 级。凡 B 级结论，本文在采纳时
一律要求 DeepCode 侧**自己重新设计并测试**，而不是照抄实现。

---

## 1. 它是什么

DeepSeek 官方的开源 agent harness，与 DeepCode 属于**同一生态位的直接对照物**：都是驱动
DeepSeek 模型的 coding agent 运行时。这使它比 Claude Code / Codex 更值得逐项比对 —— 后两者的
一半功能（云端任务、团队、MDM）在 DeepCode 的定位下没有价值，而 dsh 的取舍面对的是同一组约束。

规模（A 级）：

| 维度         | 数字                                         |
| ------------ | -------------------------------------------- |
| workspace 包 | **219** 个（`packages/<组>/<包>/`）          |
| 模型可见工具 | **52** 个（`docs/tool-catalog.md` 逐个列出） |
| 前端 UI 包   | 40 个（`packages/client/ui-*`）              |
| 应用         | `apps/cli`、`apps/web`                       |
| 状态         | developer preview，**明示会破坏兼容**        |

### 1.1 架构：一切皆插件

核心主张是 **everything is a plugin**（A 级，`docs/architecture.md`）：模型适配器、工具注册表、
session 日志、**乃至 agent loop 本身**都是插件，全部可从配置替换。没有"特权内核"可打补丁 ——
扩展方式是在插件树旁边挂一个新插件。

底座是 [Cordis](https://github.com/cordiverse/cordis)（vendored 进仓库）：插件向共享 context
贡献 service、类型化事件与**可逆 effect**；`register()` 返回 disposer，插件卸载时注册自动回滚。

组合方式是三层：

- **profile** —— 一个命名组合（`web` / `headless`），列出它叠的 bundle
- **bundle** —— Cordis 配置行的分发格式
- **patch** —— 按 id 覆盖某一行的整份 config

`dsh --profile web --dump-config` 打印实际启动的树，任何一行都能被自己的 patch 换掉。

### 1.2 capability seam（能力缝）

贯穿全仓的组织纪律（A 级，`docs/capability-seams.md`）：一条 seam 由**三个角色**构成 ——

| 角色               | 职责               | 例                                  |
| ------------------ | ------------------ | ----------------------------------- |
| Service Definition | 声明接口           | `dsh-spill` 定义 `ctx.spillStore`   |
| Service Provider   | 实现它             | `dsh-spill-local` 存本地文件        |
| Consumer           | 使用它（常为工具） | `dsh-spill-policy` 在后置钩子上应用 |

规则是"**一条 seam 是完整的三者，绝不是其中之一**"。收益不是抽象洁癖：文件系统与子进程
provider 共享同一个执行世界，于是**把它们指向远程沙箱，Bash / PTY / LSP 会一起搬过去**，
不需要给每个工具各写一份远程分支。这是本次调研里最值得学的一条纪律。

### 1.3 turn 流水线

```text
turn/start
  claim 输入 → 装配 prompt sections + tool schemas
  → agent/pre-step            (waterfall: 可改写或拒绝这一步要送给模型的消息)
     step/start
     agent/request → llm/stream → assistant/chunk* → assistant/message
     tool/call* → tools/pre-execute → tools/execute → tools/post-execute → tool/result*
     step/end
  → agent/turn-stopping
turn/end
```

**model-visible ⟺ logged**（A 级）：任何进入模型请求的东西都必须能从 session 日志重建，且有
runtime invariant 断言这一点。这条不变量比它听起来重要 —— 它把"注入上下文"从一个随手能加的
后门，变成一个必须先扩展事件表的动作。

---

## 2. 能力差异矩阵

图例：`✅` 有 · `🟡` 有但形态不同/受限 · `❌` 无

| 能力                      | dsh                                                   | DeepCode 0.3.0                                                    | 差距判定             |
| ------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------- |
| **工具输出溢出（spill）** | ✅ 超限输出落盘，模型拿到预览 + 定位符                | ❌ Bash 30 KB 硬截断，尾部**永久丢失**                            | **真差距 · 高价值**  |
| **重复调用护栏**          | ✅ 连续同参调用达阈值注入升级式提醒                   | ❌ 无                                                             | **真差距 · 低成本**  |
| **逐工具超时**            | ✅ 部署策略层统一武装 deadline                        | 🟡 仅 Bash 自带 timeout                                           | **真差距 · 低成本**  |
| **持久 shell / PTY**      | ✅ `terminal_open/send/read/signal/close/list`        | ❌ 仅一次性 Bash；后台命令写日志文件                              | **真差距 · 中成本**  |
| **session 检索**          | ✅ `session_search` / `session_trace` + SQLite FTS    | ❌ JSONL 在盘上，无检索                                           | **真差距 · 中成本**  |
| **后台作业注册表**        | ✅ 统一 `ctx.jobs`：list/output/kill + 完成通知       | 🟡 sub-agent 有 TaskManager；后台 Bash 走日志文件（**两套机制**） | 中差距               |
| **持久目标（goal）**      | ✅ 事件溯源的 goal + 续跑驱动                         | 🟡 TodoWrite（每 session 文件，无续跑）                           | 中差距 · 需产品取舍  |
| **Ralph 循环**            | ✅ 一个不可变目标喂给一串全新子 agent                 | ❌ 无                                                             | 中差距 · 需产品取舍  |
| **模型无关的结果剪枝**    | ✅ compaction-tool-result-pruner                      | 🟡 只有 LLM 摘要式 compaction                                     | 中差距 · 低成本      |
| **workflow 引擎**         | ✅ 模型编写脚本，worker thread 执行                   | 🟡 Task/sub-agent 覆盖多数场景                                    | 弱差距               |
| **工具渲染意图**          | ✅ 每个工具声明 `generic`/`terminal`/`diff`+locations | ❌ ToolCard 一律通用卡片                                          | **真差距 · UI 杠杆** |
| **UI 可扩展性**           | ✅ 40 个 `ui-*` 包 + Chat 节点注册表                  | 🟡 Repl.tsx 单体                                                  | 中差距               |
| **ACP（编辑器协议）**     | ✅ 自动化用 ACP server                                | 🟡 自有 app-server 协议 + LSP + VS Code                           | 弱差距               |
| 沙箱                      | ✅ landlock(Linux) / seatbelt                         | ✅ + 选择性网络白名单                                             | **DeepCode 更强**    |
| 文件契约 / 变更账本       | ❌                                                    | ✅ File Contract + Change Ledger + rollback                       | **DeepCode 更强**    |
| 计价意识                  | ❌（未见 cache-hit 计价）                             | ✅ cache-hit 分档 + `/cost` 命中率                                | **DeepCode 更强**    |
| cron / 定时               | ✅ `schedule_*`                                       | ✅ cron + 日历/文件触发                                           | 持平                 |
| hooks                     | ✅ 桥接 Claude Code / Codex 钩子协议                  | ✅ 原生 hooks                                                     | 持平                 |
| skills / plugins / MCP    | ✅                                                    | ✅                                                                | 持平                 |

### 2.1 顺带查实的两处 DeepCode 缺陷

调研过程中对照代码查实（A 级，指向本仓库源码）：

1. **`WebFetch` 把整个响应体灌进模型上下文**
   [`web-fetch.ts:149`](../../packages/core/src/tools/web-fetch.ts) 直接 `content: body`，
   上游只有 5 MiB 的**字节**上限（`DEFAULT_MAX_BYTES`），**没有模型可见文本上限**。
   一个 5 MiB 的 HTML 页面约合 150 万 token —— 远超任何上下文窗口，等于一次调用即毁掉整个 session。
   这不是"可优化"，是 bug。

2. **`Bash` 截断即丢失**
   [`bash.ts:43-52`](../../packages/core/src/tools/bash.ts) 在 30 KB 处 `slice` 并追加
   `... [stdout truncated]`。被切掉的部分**不写任何地方**，模型没有任何手段取回 —— 一次
   `npm test` 的完整失败输出就这样消失了。

两者都由同一个能力修复：spill。

---

## 3. 值得抄与不值得抄

### 3.1 值得抄的：纪律与具体能力

- **capability seam 的三角色纪律** —— 但只在真有第二个 provider 的地方用（见方案文档的辩论）
- **spill** —— 直接修复上面两个缺陷
- **重复调用护栏** —— DeepCode 已有 `reminders/` 子系统，这是现成的落点
- **逐工具超时策略**
- **持久 shell 会话**
- **session 检索**
- **工具渲染意图** —— 前端最大的单点杠杆

### 3.2 不值得抄的：Cordis 化重写

**这是本次调研最重要的否定结论。** 详细辩论见[方案文档 §2.1](../DSH_ADOPTION_PLAN.md)，此处只记事实：

- dsh 用 **219 个包**表达 DeepCode 用 **4 个包**表达的东西。这个倍率不是浪费，是它的产品前提
  （对外分发插件生态、`dsh-plugin` topic、第三方 bundle）造成的必要成本。**DeepCode 没有这个
  产品前提**，抄成本不抄收益。
- dsh 自己标注 developer preview 且**明示会破坏兼容**；DeepCode 已发 0.3.0 且有下游（npm、VSIX、
  DMG、update feed）。拿一个自称会破坏兼容的框架去重写一个已发布产品的地基，风险与收益完全不对称。
- Cordis 是 vendored 进 dsh 的；采纳它意味着 DeepCode 要么也 vendor 一份（多一个需要跟进的上游），
  要么依赖一个 0.x 的外部框架。

### 3.3 不确定、留待观察

- **workflow 引擎**（模型编写编排脚本，worker thread 执行）—— 概念上强，但 DeepCode 的
  Task/sub-agent 已覆盖多数场景，且它引入"模型写代码然后我们执行"的新攻击面。**暂不采纳**，
  等有真实用例再说。
- **goal + Ralph** —— 是产品取舍而非补齐差距：它们改变的是"agent 什么时候停"，属于需要用户
  拍板的方向，不宜由实现方单方面决定。**列入 backlog，不进本轮。**

---

## 4. 对方的不利事实

按调研纪律，同时记录不支持采纳的证据：

- 版本 `0.1.0-rc.5`，README 首屏即为 **"THERE WILL BE COMPATIBILITY-BREAKING CHANGES"**（A 级）。
- 219 个包中大量是三角色拆分的产物（如 spill 拆 3 包、goal 拆 4 包、terminal 拆 3 包）。这套
  纪律在 219 包的规模下自洽，**在 4 包的仓库里照搬会变成纯粹的目录噪声**。
- 文档密度极高（`docs/config-catalog.md` 3151 行、`tool-catalog.md` 1873 行）且大量为生成物 ——
  说明其可配置面已经大到必须靠生成器维护。这是能力的证据，也是复杂度的证据。
- 未能验证运行时行为（无 key、未 build），所有行为结论均为 B 级。

---

## 5. 结论

dsh 与 DeepCode 在**内核能力上互有胜负**：DeepCode 在治理（文件契约、变更账本、沙箱网络白名单）
与计价意识上更强；dsh 在**上下文经济学**（spill、剪枝、检索）与**执行形态**（持久终端、作业注册表）
上更强，并且在**前端可扩展性**上领先一代。

采纳应当是**能力级的，不是架构级的**：取它的 spill、护栏、持久 shell、session 检索、渲染意图，
拒绝它的 Cordis 化重写。逐项辩论与 PR 拆分见[采纳方案](../DSH_ADOPTION_PLAN.md)。
