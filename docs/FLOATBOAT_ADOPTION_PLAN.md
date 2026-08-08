# 用 Floatboat / Selfware 机制优化 DeepCode 的整体方案

> 状态：**提案，未实现**。等待评审后再拆 PR。
> 基线：`main@ec94748` · 日期 2026-08-08
> 调研依据：[`docs/research/floatboat.md`](research/floatboat.md)（另一独立 PR）
> 与 [`CODEX_ALIGNMENT_PLAN.md`](CODEX_ALIGNMENT_PLAN.md) 的关系：**不取代，正交补充**。alignment plan
> 收敛的是"运行时语义统一"（谁执行、怎么恢复、怎么中断）；本文收敛的是**"工作区治理"**
> （凭什么能改、改了什么、怎么撤销）。两者共用同一个 dispatcher 与协议面。

---

## 0. 结论先行

**DeepCode 现在缺的不是能力，是治理面。**

核心工具、沙箱、签名校验、凭证边界、app-server 协议都已经建成，而且在"执行的安全性"上比
Selfware 强得多（真 OS 沙箱 vs loopback + 确认；ed25519 强制校验 vs `signature_required: false`）。
但有三件事今天**在 DeepCode 里表达不出来**：

| #   | 说不出的话                                    | 今天为什么说不出（对源码核实）                                                                                                                                                                                                                      |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | "`.env` 永远不许读，`docs/**` 改动必须先问我" | 权限规则是**工具维度**的（`Bash(git diff:*)`），路径匹配只有前缀比对且 `file_path` 通常是绝对路径 —— `Read(.env*)` 匹配不到任何东西（[`config/permissions.ts`](../packages/core/src/config/permissions.ts) `parseRule` / `primaryInput`）           |
| 2   | "上一轮 agent 到底改了哪些文件、怎么撤销"     | session 是**消息流**不是变更账本（[`sessions/storage.ts`](../packages/core/src/sessions/storage.ts)）；`MEMORY.md` 存的是**事实**不是变更（[`memory/loader.ts`](../packages/core/src/memory/loader.ts)）；snapshots 有但没有"意图 + 回滚句柄"的索引 |
| 3   | "这个 runtime 能写哪里、哪些动作要确认"       | `initialize()` 的 capabilities 只声明**协议特性**（`threadResume` / `workspaceDiff`…），不声明**权限与写边界**（[`protocol/src/runtime.ts:112`](../packages/protocol/src/runtime.ts)）                                                              |

Selfware 恰好把这三件事做成了**仓库里的、人类可读的、可 diff 可 review 的声明式文件**。
这是它唯一值得抄的部分，也是本方案的全部内容。

### 采纳 / 拒绝一览

|     | 机制                                                               | 落点                                                       | 优先级                           |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------- |
| ✅  | **A. File Contract** —— 路径 × 读/写/执行 × 三态的权限契约         | `.deepcode/file-contract.yaml` + `config/file-contract.ts` | **P0**                           |
| ✅  | **B. Change Ledger** —— 带 `rollbackHint` 的 append-only 变更账本  | `~/.deepcode/projects/<key>/ledger/` + `deepcode ledger`   | **P0**                           |
| ✅  | **C. Capability Manifest** —— 运行时机器可读的写边界与确认动作声明 | protocol `runtime/capabilities`                            | **P1**                           |
| ✅  | **D. Combo** —— 把已完成的 thread 蒸馏成 `SKILL.md` 草稿           | `/combo` + `skills/distill.ts`                             | **P1**                           |
| ✅  | **E. Trigger Profile** —— 让 cron job 携带自己的权限档位           | `cron/index.ts` 扩展 `CronJob`                             | **P1**                           |
| ❌  | `.self` 自执行文件分发                                             | ——                                                         | 拒绝（供应链攻击面）             |
| ❌  | Tacit 式全局被动观察                                               | ——                                                         | 拒绝（隐私红线）                 |
| ❌  | FloatIM 跨组织 agent 网络                                          | ——                                                         | 拒绝（未审计第三方触达源码）     |
| ❌  | loopback HTTP runtime API                                          | ——                                                         | 拒绝（与 app-server 重复）       |
| ❌  | 日历接入 / Rhythm Recognition                                      | ——                                                         | 拒绝（产品方向不同）             |
| ⚠️  | IACT 内嵌可点击动作                                                | ——                                                         | 暂缓（先解决审批语义，见 §3 末） |

**一句话**：抄它的**治理声明**，不抄它的**分发模型**。

---

## 1. 设计约束（先立规矩）

本方案的每一项都必须同时满足 [`AGENTS.md`](../AGENTS.md) 的既有工程约束，这不是形式主义 ——
其中三条直接决定了下面的设计形状：

1. **"All tool execution must pass through one explicit permission policy. Never make safety
   depend on a host remembering to pass an optional argument."**
   → File Contract **不能**是一个新的、可选的门禁。它必须成为
   [`config/permissions.ts`](../packages/core/src/config/permissions.ts) 现有裁决链路的**一个额外规则来源**，
   由同一个 dispatcher 消费。四个客户端（CLI / desktop / VS Code / LSP）不需要改一行代码就应该生效。
2. **"New public behavior needs tests and user-facing documentation in the same PR."**
   → 每个 PR 的验收里都写死了测试边界。
3. **"Do not claim exact Codex or Claude parity when DeepSeek constraints differ."**
   → 同理，**不宣称 Selfware 合规**。我们借鉴机制，不实现 `.self` 规范，也不在任何文档里
   声称 DeepCode 是 Selfware 兼容实现。

额外自加一条：

4. **零配置时行为不变。** 所有新文件（`file-contract.yaml`、ledger、trigger profile）缺失时，
   系统必须退化成今天的行为。**不允许**因为引入治理层而让现有用户的会话开始报错或多出审批。

---

## 2. 采纳项详细设计

### A. File Contract —— 路径维度的权限契约（P0）

#### A.1 问题

DeepCode 的权限规则是**工具维度**的。`evaluatePermission` 按 `deny > ask > allow` 裁决，
规则形如 `Bash(git diff:*)` / `WebFetch(domain:github.com)` / 裸 `Read`。
路径相关的规则只能靠 `primaryInput()` 取出 `file_path` 再做**前缀比对**——
而 `file_path` 在实际调用里通常是绝对路径，所以 `Read(.env*)` 这条规则**匹配不到任何真实调用**。

结果是：**"项目里的 `.env` 不许读"这句话，在权限层写不出来。**

沙箱层能表达一部分：`sandbox.filesystem.denyRead` 会生成 SBPL deny 规则
（[`sandbox/profile.ts`](../packages/core/src/sandbox/profile.ts)），而且已经硬编码了一批
凭证目录（`~/.ssh`、`~/.aws`、`~/.gnupg`、`~/.netrc`、`~/.docker/config.json`、`~/.config/gh`、
`~/.deepcode/credentials.json`、`~/Library/Keychains`）的 deny。但这条路有三个问题：

- **默认不生效**：未配置时 `resolveSandboxMode` 落到 `danger-full-access`
  （[`sandbox/index.ts:69`](../packages/core/src/sandbox/index.ts)），即沙箱关闭 ——
  这与 `THREE_WAY_REVIEW.md` 差距 B 的判断一致；
- **只覆盖 home 下的凭证库**，不覆盖**项目内**的 `.env` / `secrets/` / `*.pem`；
- **是扁平路径前缀列表，不是可 review 的契约**：没有 glob、没有 `owner`、没有"可以改但要先问"的中间态。

#### A.2 设计

新增项目级 `.deepcode/file-contract.yaml`（可选，缺失即退化为今天行为），
用户级 `~/.deepcode/file-contract.yaml` 作为兜底，项目级更具体者胜。

```yaml
version: 1

defaults:
  read: allow
  write: ask # 比 Selfware 的 deny 宽一档：DeepCode 是 coding agent，写代码是本职
  execute: ask

rules:
  # ── 秘密：任何情况下都不读 ──
  - glob: '**/.env*'
    owner: human
    read: deny
    write: deny
    reason: 'Secrets are human-only.'

  - glob: '**/*.{pem,key,p12,keystore}'
    owner: human
    read: deny
    write: deny

  # ── 源码：正常工作区 ──
  - glob: 'src/**'
    owner: shared
    read: allow
    write: allow

  # ── 高影响：可以改，但必须先问 ──
  - glob: '{AGENTS.md,CLAUDE.md,DEEPCODE.md}'
    owner: shared
    write: ask
    reason: 'Agent instructions change future behavior — review before writing.'

  - glob: '.github/workflows/**'
    owner: human
    write: ask
    reason: 'CI changes execute with repository credentials.'

  - glob: '.deepcode/file-contract.yaml'
    owner: human
    write: deny
    reason: 'The contract cannot amend itself.' # ← 关键自指防护
```

**语义**：

| 决策     | 取值                                   | 说明                                                                                                                                                |
| -------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 三态     | `allow` / `ask` / `deny`               | **刻意复用 DeepCode 既有的 `PermissionVerdict`**。Selfware 的 `require_discussion` 精确对应 DeepCode 的 `ask` —— 不需要发明新词，也不需要新的裁决格 |
| 三轴     | `read` / `write` / `execute`           | 与 Selfware 一致。`execute` 用于 Bash 直接调用脚本文件的场景                                                                                        |
| `owner`  | `human` / `agent` / `shared`           | **仅用于审批文案与冲突归属，不参与访问裁决**。不要让它承担安全职责                                                                                  |
| `reason` | 字符串                                 | 命中 `ask` / `deny` 时**原样展示给用户**。这是治理层相对于沙箱层最大的体验优势：拒绝是可解释的                                                      |
| 优先级   | 更具体的 glob 胜；同具体度时后定义者胜 | 与 Selfware `rule_precedence` 一致                                                                                                                  |

**与现有裁决的合成 —— 这是本项最关键的设计决定**：

```
finalVerdict = mostRestrictive( toolVerdict , pathVerdict )
其中 deny > ask > allow，no-match 视为无意见（不参与取严）
```

即 File Contract **只会收紧，永不放宽**。用户 settings.json 里已有的 `allow: ["Write"]`
不会被契约推翻成更宽；反过来契约的 `deny` 一定生效。这条单向性让新机制**不可能降低现有安全性**，
也让"零配置行为不变"成立（无契约文件 → `pathVerdict` 恒为 `no-match` → 结果完全等于今天）。

**落点**（新增 + 改造，均在 core）：

- 新增 `packages/core/src/config/file-contract.ts`：
  `loadFileContract(cwd, home)` / `evaluatePath(contract, {path, action}): PermissionVerdict`
  —— 纯函数，无 fs 依赖的裁决部分单独导出，便于测试。
- 改造 `packages/core/src/config/permissions.ts`：新增
  `evaluatePermission(req, rules, contract?)`，在内部完成取严合成。**签名向后兼容**
  （第三参数可选，缺省即今天行为）。
- 接入点：**只改 hooks dispatcher 一处**
  （[`hooks/dispatcher.ts`](../packages/core/src/hooks/dispatcher.ts)），
  由 `RuntimeHost` 统一注入契约。四个客户端零改动。

**工具 → 轴 的映射表**（必须显式声明，不能靠猜）：

| 工具                              | 取路径的字段     | 判定轴                                   |
| --------------------------------- | ---------------- | ---------------------------------------- |
| `Read` / `NotebookRead`           | `file_path`      | `read`                                   |
| `Grep` / `Glob`                   | `path`（搜索根） | `read`（仅根目录；命中文件的过滤见 A.3） |
| `Write` / `Edit` / `NotebookEdit` | `file_path`      | `write`                                  |
| `Bash`                            | ——               | **不做静态路径推断**，见 A.3             |

#### A.3 明确的能力边界（必须写进文档，否则会给人虚假安全感）

- **Bash 不在契约的静态裁决范围内。** `cat .env` 是一个字符串，静态解析 shell 是不可靠的，
  假装能拦截比不拦截更危险。Bash 的路径边界**只能**由沙箱层保证。因此本方案的 PR 0 附带一条：
  当契约里存在任何 `read: deny` 规则、而沙箱解析为 `danger-full-access` 时，
  **启动时打印一次明确警告**："file-contract deny rules do not constrain Bash while the sandbox is off"，
  并在 `deepcode doctor` 的诊断里长期可见。**不自动开沙箱**（那是行为破坏性变更，属于 alignment plan 的范畴）。
- **Grep/Glob 的结果过滤**放到 PR 1：搜索根可以裁决，但命中结果里混入 `deny` 路径的内容需要在
  工具输出层二次过滤。第一版先做搜索根，并在文档里写明这个缺口。
- **契约不能自我修订**：`.deepcode/file-contract.yaml` 自身默认 `write: deny`，
  且这条默认值写死在 loader 里，即使用户的契约文件试图给自己开 `write: allow` 也会被忽略。

#### A.4 测试边界

`packages/core` 全套 + 以下 focused 用例（AGENTS.md 要求"权限相关改动需要针对性对抗测试"）：

- glob 具体度排序（`**/.env*` vs `src/**` vs `src/config/.env.local`）
- 取严合成矩阵：tool ∈ {allow, ask, deny, no-match} × path ∈ {同} 共 16 组
- **对抗**：契约试图给自己开写权限 → 必须仍为 deny
- **对抗**：`../` 路径穿越、符号链接、绝对路径 vs 相对路径归一化
- **对抗**：畸形 YAML / 未知 `action` 值 → 必须 fail-closed（解析失败视为契约不可信，
  退回今天行为并**告警**，而不是静默忽略）
- 无契约文件时，`evaluatePermission` 的输出与改造前**逐用例相等**（回归保证）

#### A.5 回滚

删除 `.deepcode/file-contract.yaml` 即完全退回今天行为。代码侧第三参数可选，可单独 revert。

---

### B. Change Ledger —— 可回滚的变更账本（P0）

#### B.1 问题

今天要回答"agent 刚才改了什么、怎么撤销"，只能人读 session JSONL 的消息流，
或翻 `<id>/snapshots/`。没有一个地方回答：**这次改动的意图是什么、影响了哪些文件、回滚句柄是什么。**

Selfware 把这做成强制项（`specs/memory.md` §4），最小字段里最关键的是 **`rollback_hint`** ——
每条变更都必须自带"怎么撤销"。

#### B.2 设计

**存储位置的取舍**：Selfware 写在实例内（自包含）。DeepCode **不这么做** ——
往用户仓库里每次 Edit 都追加一行会污染 `git status`，是明确的体验倒退。改为：

- **规范流**：`~/.deepcode/projects/<key>/ledger/changes.jsonl`（append-only，机器读，
  复用 [`memory/loader.ts`](../packages/core/src/memory/loader.ts) 已有的 `projectMemoryKey()` 分片规则）
- **人读视图**：`deepcode ledger export --markdown [--since <ref>]` 按需生成，
  用户自己决定要不要提交进仓库

**记录 schema**（JSONL，一行一条）：

```jsonc
{
  "id": "chg-lz4k2p-01",
  "timestamp": "2026-08-08T09:12:33.417Z",
  "actor": "agent", // agent | user | hook | plugin | subagent:<name>
  "threadId": "thread-lz4k1x-a3f9",
  "turnId": "turn-lz4k2m-77c1",
  "tool": "Edit",
  "intent": "修复 auth.ts 中过期 token 未被拒绝的分支",
  "paths": ["src/auth.ts"],
  "summary": "在 verifyToken 里补 exp 校验并返回 401",
  "rollbackHint": {
    "kind": "snapshot", // git | snapshot | manual
    "ref": "thread-lz4k1x-a3f9/snapshots/0007",
    "command": "deepcode ledger rollback chg-lz4k2p-01",
  },
}
```

**双时间线**：Selfware 拆 data / software 两个账本，理由是"软件迭代史会被数据操作淹没"。
DeepCode 的对应拆法**不是** data/software，而是：

| 账本               | 内容                                                                              | 理由                                                                     |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `changes.jsonl`    | 工作区文件变更（Write/Edit/NotebookEdit/apply-patch）                             | 高频，是"agent 干了什么"的主线                                           |
| `governance.jsonl` | 治理面变更：契约改动、权限档位切换、plugin 安装/启用、hook 信任授予、trigger 创建 | 低频、高影响，**必须不被前者淹没** —— 这正是 Selfware 拆分论证的真正内核 |

#### B.3 落点

- 新增 `packages/core/src/ledger/{index,writer,rollback}.ts`
- **写入点只有一个**：dispatcher 在工具**成功返回后**写账本。
  不在每个工具里各写一次 —— 那正是 AGENTS.md 禁止的"安全依赖调用方记得传参"的形状。
- `intent` 从何而来：优先取当前 turn 的用户请求摘要；`summary` 由工具调用参数结构化生成
  （不额外调模型 —— 账本必须在离线/失败路径下也能写成）。
- `rollbackHint` 与既有 [`sessions/snapshots.ts`](../packages/core/src/sessions/snapshots.ts) 对接：
  快照已经在拍，账本只是给它加上**可寻址的索引和意图**。
- 新增 CLI：`deepcode ledger list|show <id>|rollback <id>|export`。
  `rollback` 必须走 **No Silent Apply**（见 §2.F）：先 diff 预览 → 确认 → 执行 → **再记一条
  `actor: user` 的账本**（回滚本身也是变更）。

#### B.4 边界与非目标

- **账本不是 git 的替代品。** 有 git 时 `rollbackHint.kind` 优先取 `git`；账本的价值是
  **在同一个 commit 内部**区分"这三个文件是 agent 在 turn 5 为了修 auth 改的"。
- **账本不参与裁决。** 它是审计产物，不能反过来影响权限（对应 Selfware 的
  "Memory MUST NOT become the protocol authority"）。
- **不记录文件内容**，只记路径与摘要 —— 避免账本变成秘密的第二份副本。
- 需要**容量策略**：按项目滚动（默认保留最近 N 条 / M 天，可配），
  否则长期使用的仓库账本会无限增长。

#### B.5 测试边界

writer 幂等性、并发写（复用 `sessions/storage.ts` 的 writer lock 思路）、
损坏尾行的恢复（与 session JSONL 一致：恢复被截断的**最后一条**，但绝不隐藏中间损坏）、
`rollback` 的 dry-run 与冲突（目标文件在账本记录后又被人手动改过 → 必须停下来问）。

---

### C. Capability Manifest —— 运行时能力声明（P1）

#### C.1 问题

`initialize()` 已经返回 capabilities，但里面全是**协议特性**开关
（`threadResume` / `workspaceDiff` / `reviewActions` / `reasoningDeltas`…）。
客户端问不到：**这个 runtime 会往哪里写？哪些动作需要我弹确认？沙箱开着吗？**

这正对着 `CODEX_ALIGNMENT_PLAN.md` 的 P0 差距**"权限与工具执行不是运行时统一能力"** ——
不同 host 各自决定传什么参数，同样的 settings 在不同界面产生不同行为。
一个**可查询的能力声明**把这件事变成可断言、可测试的。

#### C.2 设计

**不动** `InitializeResult.capabilities` 的既有形状（其中若干字段是字面量类型 `true`，
改动会波及所有客户端）。新增一个协议方法：

```ts
// packages/protocol/src/types.ts
export interface RuntimeCapabilities {
  /** 工作区中运行时可写的根（已解析为绝对路径） */
  writeScope: string[];
  /** 这些动作永远需要用户确认，无论权限档位如何 */
  confirmationRequired: string[]; // e.g. ['ledger.rollback', 'plugin.install', 'contract.change', 'trigger.create']
  sandbox: { mode: SandboxMode; effective: boolean };
  permissions: { mode: Mode; fileContract: 'absent' | 'loaded' | 'invalid' };
  ledger: { enabled: boolean; path: string };
  modules: Record<string, 'enabled' | 'optional' | 'disabled'>;
}
```

对应 `runtime/capabilities` 请求方法。桌面端/VS Code 用它来**如实渲染当前姿态**
（而不是各自猜），`deepcode doctor` 用它做诊断输出，
测试用它对四个客户端做**同一份断言**——这才是这项的真正价值：
**它把"各 host 行为一致"从口号变成一条可执行的测试。**

#### C.3 落点与测试

- `packages/protocol/src/{types,runtime}.ts` 增加方法与类型（纯增量）
- `packages/core/src/runtime/host.ts` 组装声明（它已经是唯一持有 mode/permissions/sandbox 的地方）
- 测试：**四客户端一致性测试** —— 同一份 settings 下，CLI / server / VS Code / LSP 拿到的
  `RuntimeCapabilities` 必须逐字段相等。这条测试如果写不出来，说明 alignment plan 的
  P0 还没真正收敛，**这本身就是有价值的信号**。

---

### D. Combo —— 把已完成的 thread 蒸馏成 Skill（P1）

#### D.1 为什么这项性价比最高

DeepCode 的 skill 链路**已经完整**：三层来源（builtin / user / project / plugin）、
frontmatter schema（`name` / `description` / `allowed-tools` / `model` / `effort` / `shell` / `hooks` / `disabled`）、
覆盖与禁用机制，全部实现且有测试（[`skills/loader.ts`](../packages/core/src/skills/loader.ts)）。
**唯独缺生成端** —— 所有 `SKILL.md` 都得手写。

Floatboat 的 Combo 洞察是：**自动化应该在工作完成之后被提取，而不是在工作开始之前被配置。**
用户刚做完一件事的那一刻，是他对"这件事该怎么做"最清楚的时刻。

#### D.2 设计

新增 `/combo [name]` slash command（[`slash-commands/`](../packages/core/src/slash-commands)）：

1. 读当前 thread 的已完成 items（协议已有 `completedItemPersistence`）
2. 生成 `SKILL.md` 草稿：
   - `description` ← 从用户的原始请求 + 最终结果生成
   - **`allowed-tools` ← 本次 thread 实际用到的工具集合**
   - `model` / `effort` ← 本次实际使用的档位
   - body ← 步骤序列 + 关键决策点 + 踩过的坑
3. **展示完整草稿 + 目标路径，等用户 Accept**（No Silent Apply）
4. 写入 `.deepcode/skills/<name>/SKILL.md`，并记一条 `governance.jsonl` 账本

**`allowed-tools` 从实际用量推导是这里最重要的设计**：手写 skill 时，人几乎总是把
`allowed-tools` 写得比需要的宽（或者干脆不写）。从实跑记录反推，天然得到最小权限集。
这一点 Floatboat 没有宣传，但它是把 Combo 从"便利功能"变成"安全功能"的关键。

#### D.3 边界

- 产物是**草稿**，明确标注 `# TODO: review before use`，不自动启用
- 蒸馏时**不得**把 thread 里出现过的秘密/token/绝对路径带进 skill body —— 需要一遍脱敏，
  并对 File Contract 中 `read: deny` 的路径做强制剔除
- 不做 Floatboat 的"被动观察"：**只在用户显式敲 `/combo` 时读当前 thread**，
  不后台采集、不跨 thread 聚合

---

### E. Trigger Profile —— 让触发器携带自己的权限档位（P1）

#### E.1 问题

`CronJob` 今天是 `{ id, schedule, prompt, cwd, createdAt, lastRunAt, enabled }`
（[`cron/index.ts`](../packages/core/src/cron/index.ts)），由 `deepcode scheduler run` 无人值守执行。

**它不携带任何权限信息。** 也就是说，一个凌晨 3 点自动触发、无人在场审批的任务，
拿到的是与交互式会话相同的权限档位。凡是会 `ask` 的调用，在无人值守时要么被阻塞、
要么依赖 host 的默认放行——**两种结果都不该由"忘了配"来决定**。

Floatboat 那条"permission scopes set per calendar event, not per account"说的正是这件事：
**一次触发 = 一个有界的、临时的权限档位。** 这是它产品层唯一值得抄的机制。

#### E.2 设计

扩展 `CronJob`（新增字段全部可选，缺省 = 今天行为 + 一条告警）：

```ts
export interface TriggerProfile {
  /** 该 job 运行时的权限档位，独立于用户交互会话 */
  mode?: Mode;
  /** 额外收紧的权限规则（只收紧，不放宽） */
  permissions?: PermissionRules;
  /** 沙箱档位 —— 无人值守场景建议显式设为 workspace-write */
  sandbox?: SandboxMode;
  /** 无人应答时的兜底：'deny'（默认）| 'abort' */
  onApprovalRequired?: 'deny' | 'abort';
}

export interface CronJob {
  /* …既有字段… */
  profile?: TriggerProfile;
}
```

**关键默认值**：`onApprovalRequired` 默认 `'deny'`。无人值守的任务遇到需要审批的动作时
**拒绝该次调用并继续**，而不是静默放行、也不是挂起等待一个永远不会来的回答。
这个默认值本身就是一个安全修复，与 File Contract 无关，可以独立先落地。

**触发源抽象（P2，不在首批）**：把 `schedule` 泛化为 `trigger: { kind: 'cron' | 'ics' | 'watch' | 'manual', … }`。
`ics` 需要显式配置一个本地 ICS 路径或 URL，**默认关闭，且不内置任何日历厂商 SDK**——
DeepCode 不做日历集成，只接受一个标准 ICS 输入。这是刻意画的产品边界。

#### E.3 测试

profile 缺省时行为与今天逐用例相等；`onApprovalRequired: 'deny'` 下需审批调用被拒且任务继续；
profile 试图**放宽**权限时被取严逻辑忽略（与 File Contract 同一条单向性）。

---

### F. 贯穿性机制：No Silent Apply

上面 B / C / D / E 里反复出现同一个动作形状，值得抽成公共设施 ——
Selfware §6.3 的四步，映射到 DeepCode：

| Selfware 步骤                   | DeepCode 落法                                              |
| ------------------------------- | ---------------------------------------------------------- |
| 1. 解释更新逻辑                 | 来源 + 比对方式 + 应用方式 + 回滚方式，结构化返回给客户端  |
| 2. 给出摘要 / diff              | 复用既有 `workspace/diff` 能力（协议已有 `workspaceDiff`） |
| 3. 用户决策 Accept/Reject/Defer | 复用既有 approval 通道（`ApprovalRequestedEvent`）         |
| 4. 应用前建回滚点               | 复用既有 snapshots；写 ledger 记录                         |

**四步全部由既有组件拼成，没有一个是新造的。** 新增的只是
`packages/core/src/runtime/apply-ceremony.ts` 这层编排，
供 `ledger rollback` / `plugin install` / `contract change` / `combo write` 共用。

DeepCode 已有的更强项要保留：plugin 的 ed25519 签名 + 吊销列表
（[`plugins/marketplace.ts`](../packages/core/src/plugins/marketplace.ts)）比 Selfware 的
`signature_required: false` 严格得多，**不降级**。值得从 Selfware 补的只有一个字段：
制品元数据里的 **`provenance`（派生链，可含父哈希）** —— 用于回答"这个 plugin 是从哪个版本派生的"。

---

## 3. 明确拒绝清单（附理由）

写下拒绝理由和采纳理由同等重要，否则半年后会有人重新提。

| 机制                              | 拒绝理由                                                                                                                                                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`.self` 自执行文件分发**        | "文件即应用"意味着分发单元携带可执行逻辑。对办公场景是便利，对 coding agent 是**教科书式的供应链攻击面**：收到一个 `.self` 等于收到一个待运行程序。DeepCode 现有的"子进程 + OS 沙箱 + 强制签名"三层比 Selfware 的"loopback + 用户确认"强得多，**引入 `.self` 是净负** |
| **Tacit 式全局被动观察**          | 跨文件/浏览器/系统应用被动采集操作习惯，与 [`security-model.md`](security-model.md) 的既有姿态直接冲突，且对本地开发工具是隐私红线。Combo 的价值可以在**显式触发**下 100% 拿到（见 §2.D），不需要被动采集                                                             |
| **FloatIM 跨组织 agent 网络**     | 让外部 agent 加入频道并接收工作交接 = **未经审计的第三方 agent 触达源码**。DeepCode 的 sub-agent 已覆盖内部编排需求                                                                                                                                                   |
| **loopback HTTP runtime API**     | Selfware 要求 runtime 暴露 `/api/*` 并绑 loopback。DeepCode 已有 app-server + JSON-RPC + Thread/Turn/Item，**再开一个 HTTP 面只会制造第二套语义**，正是 alignment plan 在消灭的那类分叉                                                                               |
| **日历接入 / Rhythm Recognition** | 产品方向不同。DeepCode 的触发器只接受标准 ICS 输入（且默认关闭），不做日历厂商集成                                                                                                                                                                                    |
| **信用点计费 / Combo Store 商店** | 与 MIT + 自带 key 的定位不兼容                                                                                                                                                                                                                                        |
| **"Auto Mode" 命名**              | ⚠️ DeepCode 的 `auto-mode` 已经是**安全分类器**（[`auto-mode/index.ts`](../packages/core/src/auto-mode/index.ts)），Floatboat 的 "Auto Mode" 是**模型路由**。**同名不同义，不要复用这个词。** 若将来做模型路由，命名为 `model-router`                                 |

**暂缓 —— IACT / 内嵌可点击动作**：机制方向是对的（agent 输出应携带结构化的下一步动作，
由客户端统一渲染，而不是让用户复制粘贴）。但有一个必须先回答的问题：
**内嵌按钮触发的动作，走不走审批？** 如果走，它就等价于现有的 `AskUserQuestion`；
如果不走，它就是一条绕过 dispatcher 的执行路径 —— 直接违反 AGENTS.md 的第一条约束。
建议等 alignment plan 的 Item 协议冻结后，作为一种 **item 类型**（而非 Markdown 扩展）重新评估。

---

## 4. 分阶段 PR 路线

每个 PR 独立可合、独立可 revert。**没有一个 PR 依赖 Floatboat 的任何服务或格式。**

| PR          | 内容                                                             | 依赖    | 风险                                                      |
| ----------- | ---------------------------------------------------------------- | ------- | --------------------------------------------------------- |
| **0**       | `cron` 的 `onApprovalRequired: 'deny'` 默认值 + 无人值守告警     | 无      | 低。独立安全修复，不依赖本方案其余部分                    |
| **1**       | File Contract 解析 + 裁决**纯函数**（不接入 dispatcher）         | 无      | 极低。纯新增模块 + 单测，不改变任何运行时行为             |
| **2**       | File Contract 接入 dispatcher；沙箱关闭时的 Bash 缺口告警        | PR 1    | **中**。碰权限链路，需全套对抗测试 + 无契约时的逐用例回归 |
| **3**       | Change Ledger writer + `deepcode ledger list/show/export`        | 无      | 低。只写不读，不参与裁决                                  |
| **4**       | `apply-ceremony`（No Silent Apply 编排）+ `ledger rollback`      | PR 3    | 中。涉及写回工作区                                        |
| **5**       | `RuntimeCapabilities` 协议方法 + 四客户端一致性测试              | PR 2    | 低（协议纯增量），但**测试可能暴露既有不一致**            |
| **6**       | `/combo` 蒸馏                                                    | PR 3, 4 | 低。产物是草稿                                            |
| **7**       | `TriggerProfile` 完整形态                                        | PR 0, 2 | 中                                                        |
| **8**（P2） | 触发源抽象（ICS / watch）、Grep/Glob 结果过滤、制品 `provenance` | PR 2, 5 | ——                                                        |

**建议的最小有价值切片**：PR 0 + PR 1 + PR 3。三个都是低风险、无相互依赖，
合完就能回答"agent 改了什么"和"无人值守时会不会乱来"这两个最要紧的问题。
File Contract 接入（PR 2）是唯一需要谨慎评审的一步。

---

## 5. 与现有架构的冲突与化解

| 冲突                                                                  | 化解                                                                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **两套权限来源可能互相矛盾**                                          | 单向取严：契约只收紧不放宽。矛盾在定义上不可能出现                                                                                                        |
| **ledger 写入拖慢工具调用**                                           | 追加一行 JSONL，与 session 追加同量级；且写在工具**成功返回后**，失败路径不写                                                                             |
| **`RuntimeCapabilities` 与 `InitializeResult.capabilities` 概念重叠** | 前者是"权限姿态"，后者是"协议特性"。文档里必须写死这条分界，否则会有人往错的那个里加字段                                                                  |
| **`.deepcode/` 目录膨胀**                                             | 契约进仓库（应当被 review），ledger 不进仓库（默认在 `~/.deepcode/projects/<key>/`）                                                                      |
| **与 alignment plan 的 PR 队列争抢同一批文件**                        | 本方案只在 dispatcher 增加一个规则来源、在 protocol 纯增量加方法。**建议排在 alignment plan 的 runtime host 收敛之后**，避免同时改 dispatcher             |
| **Claude Code 兼容**                                                  | `.deepcode/file-contract.yaml` 是 DeepCode 自有概念，Claude Code 无对应物 → **不做兼容映射**，缺失即不启用。不影响既有 `settings.json` / `AGENTS.md` 读取 |

---

## 6. 对威胁模型的增量

需要在 [`docs/security-model.md`](security-model.md) 的表里追加/修订：

| #         | 威胁                                                         | 现状                                                                                          | 本方案后                                                                              |
| --------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 新        | 模型经由 `Read` 读取**项目内**的 `.env` / `*.pem` 并写进输出 | **未缓解**：权限层无法表达路径 glob；沙箱层的硬编码 deny 只覆盖 home 下的凭证库，且沙箱默认关 | File Contract `read: deny`（对 Read/Grep/Glob 有效；**Bash 仍需沙箱**，且会显式告警） |
| 新        | 无人值守 cron 任务在无人审批时执行高风险动作                 | **未定义**：`CronJob` 不携带权限档位                                                          | `onApprovalRequired: 'deny'` 默认 + `TriggerProfile`                                  |
| 新        | 用户无法审计/撤销 agent 的历史写入                           | 部分（snapshots 存在但无意图索引）                                                            | Change Ledger + `ledger rollback`                                                     |
| 6（既有） | 不受信项目的 `AGENTS.md` 驱使 agent 做有害动作               | trust store (`/trust`)                                                                        | **增强**：契约的 `deny` 独立于模型判断，提示注入无法绕过                              |

**必须同时写明的残余风险**：File Contract 是**运行时策略层**，不是 OS 强制层。
它能拦住走 dispatcher 的工具调用，**拦不住** Bash 子进程里的任意读写。
把它宣传成"秘密防护"是危险的 —— 文档必须写成"减少误触与提示注入的可利用面，
真正的隔离仍然来自沙箱"。

---

## 7. 风险与未解假设

**已知风险**

1. **虚假安全感**（最大的一个）。见 §6 结尾。缓解：告警 + 文档措辞 + `doctor` 诊断长期可见。
2. **glob 具体度排序是经典 bug 源**。缓解：排序规则单独一个纯函数 + 表驱动测试；
   规则冲突时 `deepcode doctor` 打印实际生效顺序。
3. **ledger 无限增长**。缓解：滚动策略必须在 PR 3 就带上，不能留作 TODO。
4. **Combo 蒸馏泄密**。缓解：脱敏 + 强制剔除 `read: deny` 路径 + 产物必须人工 review 才启用。

**未解假设（需要评审拍板）**

- **契约默认值该多严？** 本文提议 `write: ask` 而非 Selfware 的 `write: deny`
  （coding agent 写代码是本职）。但对新用户，第一次跑就被问一堆问题体验很差。
  倾向：**内置一份 `recommended` 预设**（只 deny 秘密类路径，其余 allow），用户可选。
- **ledger 该不该默认开？** 倾向默认开（写入极轻、价值高），但需要确认磁盘与隐私预期。
- **`/combo` 的蒸馏要不要调模型？** 调模型质量高但引入成本与失败路径。
  倾向：结构化部分（`allowed-tools`、步骤序列）不调模型，`description`/body 调。
- **PR 2 与 alignment plan 的 dispatcher 收敛谁先？** 建议 alignment plan 先。

---

## 8. 验收指标

不用"完成度百分比"，用**可执行断言**：

1. 一个含 `.env` 的项目，零额外配置装上 `recommended` 契约后：
   `Read('.env')` 被拒且**给出 `reason` 文案**；`Bash('cat .env')` 在沙箱关闭时**仍能成功，
   但启动时已打印过告警**（如实反映能力边界，不假装拦住了）。
2. 任意一次 agent 写入后，`deepcode ledger list` 能列出该次变更的 `intent` / `paths` / `rollbackHint`，
   且 `deepcode ledger rollback <id>` 走完 diff 预览 → 确认 → 回滚 → 记录新账本的完整四步。
3. 同一份 settings 下，CLI / server / VS Code / LSP 四个客户端的 `RuntimeCapabilities`
   **逐字段相等**（一条自动化测试）。
4. 一个无 profile 的 cron job，在需要审批的调用上被拒绝而非静默放行，且任务继续执行完毕。
5. 删除所有新增配置文件后，`pnpm test` 全绿，且权限裁决用例的输出与本方案实施前**逐条相等**。

---

## 附：与调研报告的对应关系

本方案的每一项都可回溯到 [`docs/research/floatboat.md`](research/floatboat.md) 的一手证据（等级 A）：

| 本文                     | 调研报告 | 一手依据                                           |
| ------------------------ | -------- | -------------------------------------------------- |
| §2.A File Contract       | §4.4(1)  | `governance/file-contract.yaml`                    |
| §2.B Change Ledger       | §4.4(2)  | `specs/memory.md` §4 + §10.3                       |
| §2.C Capability Manifest | §4.4(3)  | `runtime/capabilities.yaml`                        |
| §2.D Combo               | §3.1(b)  | 等级 B（厂商声明），机制方向借鉴                   |
| §2.E Trigger Profile     | §3.1(a)  | 等级 C（第三方转述），**仅借鉴思路，设计全部自研** |
| §2.F No Silent Apply     | §4.4(4)  | `selfware.md` §6.3 / §7                            |
| §2.F provenance          | §4.5     | `selfware.md` §11.1                                |
| §3 拒绝清单              | §7.2     | 一手 + 与既有威胁模型比对                          |
