# Floatboat / AOE Tech Labs 调研报告

> 调研日期：2026-08-08 · 基线 `main@ec94748`
> 调研对象：Floatboat（Proactive Agent OS）、FloatIM、**Selfware Protocol**、IACT Protocol
> 厂商：AOE Tech Labs Limited
> 一手证据：`github.com/floatboatai/selfware.md` @ `4c4fddd`（完整克隆，仓库共 62 个文件，通读 `template.self/` 全部规范与配置）
>
> **本文只做事实描述与证据分级，不含 DeepCode 改造方案。** 方案见配套 PR
> [`docs/FLOATBOAT_ADOPTION_PLAN.md`](../FLOATBOAT_ADOPTION_PLAN.md)。

---

## 0. 结论先行

Floatboat 的产品叙事（"日历驱动的主动式 Agent OS"）和它的技术贡献**不是同一件事**，调研中必须分开评估：

| 层         | 内容                                                                                     | 对 DeepCode 的价值                       | 证据等级 |
| ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- | -------- |
| **协议层** | **Selfware Protocol** —— 一份 RFC 风格、有可运行参考实现的**"Agent 可写工作区治理规范"** | **高。这是本次调研唯一值得深挖的东西。** | **A**    |
| 协议层     | IACT —— 让 Agent 输出内嵌可点击动作的轻量 Markdown 扩展                                  | 中。思路可借鉴，规范本身未通读           | B        |
| 产品层     | Calendar-as-Runtime、Combo/Tacit Engine、FloatIM、Combo/Workflow Store                   | 中低。机制思路有价值，实现细节全部闭源   | B / C    |
| 商业层     | 定价、融资、装机量                                                                       | 低。仅作背景                             | B / C    |

**核心判断：Selfware 解决的问题，正是当前所有 coding agent（含 DeepCode）都没有正面解决的那个问题 ——
"Agent 在我的工作区里改了什么、凭什么能改、怎么撤销"。**

它把这件事从"运行时内部的临时状态"变成了**仓库里的、人类可读的、可 diff 可 review 的声明式文件**：
`governance/file-contract.yaml`（谁能读写哪些路径）、`runtime/capabilities.yaml`（运行时自我声明能做什么）、
`content/memory/*-changes.md`（append-only 变更账本，每条带 `rollback_hint`）。

反过来，Floatboat 的**产品层**对 DeepCode 参考价值有限：它面向 solopreneur 做通用办公自动化，
DeepCode 面向真实代码库做工程执行，用户心智、失败代价和验收方式都不同。**不建议对标其产品形态。**

**同时必须指出三个不利事实**（详见 §7）：Selfware 版本号在仓库内部就不自洽；参考实现里多个规范文件存在
UTF-8 损坏；生态（`.self` 采用率）目前接近于零。**它现在是一份好规范，不是一个已验证的标准。**

---

## 1. 证据分级方法

本报告所有事实标注证据等级，避免把营销话术当成技术事实：

| 等级  | 含义                                                      | 本文来源                                |
| ----- | --------------------------------------------------------- | --------------------------------------- |
| **A** | **一手可验证**：我方克隆/执行/通读了源码或规范原文        | `floatboatai/selfware.md` 仓库全文      |
| **B** | **厂商一手声明**：官网、官方 README、官方发布稿的直接陈述 | floatboat.ai、官方 GitHub README、PR 稿 |
| **C** | **第三方转述**：媒体报道、评测站，未经独立验证            | ReviewsTown、theaidb、聚合站            |

> 凡标 **C** 的数字（"减少 60–70% 复制粘贴"、"被动感知 80% 用户操作"、"10,000+ 早期用户"）
> **一律不得作为 DeepCode 设计决策的依据**。它们在本文中仅用于说明厂商的宣称口径。

---

## 2. 公司与产品事实

| 项           | 内容                                                              | 等级 |
| ------------ | ----------------------------------------------------------------- | ---- |
| 法人实体     | AOE Tech Labs Limited                                             | B    |
| 产品         | Floatboat —— "Proactive Agent OS for Calendar-Driven Work"        | B    |
| 创始人 / CEO | Bruce Tan                                                         | B    |
| 成立 / 总部  | 2025 年 / 旧金山                                                  | C    |
| 投资方       | Sequoia、Welight Capital                                          | B    |
| 全球公开发布 | 2026-05-28                                                        | B    |
| 落地页版本   | v0.4.0                                                            | B    |
| 平台         | macOS（Apple Silicon + Intel）、Windows（Microsoft Store + .exe） | B    |
| 早期用户     | 宣称 10,000+                                                      | C    |
| 目标用户     | "solopreneur, creator, small business owner or 2-5 person studio" | B    |
| 联系         | Contact@floatboat.ai                                              | B    |

**定价**（等级 B，且**不完整**）：信用点（credit）制。可确认的只有加油包 —— "3,000 Credits Booster"
$12.99/包，有效期 1 年，单次结账最多 20 包，与订阅分开计费。订阅档位（Monthly / Annually）的具体价格
与额度在落地页上未公开渲染，无法验证。第三方评测指出信用点制"对重度用户带来不可预测性"（C）。

---

## 3. 产品架构（厂商叙事）

Floatboat 官网把产品拆成四步（等级 B，引号内为原文用词）：

1. **Calendar as Runtime** —— 接入 Google Calendar / Notion Calendar / Lark / Outlook / iCloud / ICS，
   把每个日程事件当作**带上下文元数据的 agent trigger**。
2. **Rhythm Recognition** —— 把日程条目分类，判断"在什么时机需要什么介入"。
3. **Execution** —— 会前准备、截止前起草、会后跟进，由 **"Combo Skills"** 执行。
4. **Persistent Workspace** —— 每个日程事件拥有独立 **"Agent Workspace"**，保存
   "run history, files and decisions"。

### 3.1 值得记录的三个机制思路

**(a) 权限按"事件"而非按"账号"授予。** 第三方描述其为
"permission scopes set per calendar event, not per account"（等级 C，但机制方向明确）。
即：一次触发 = 一个**有界的、临时的**权限档位，而不是一次性把账号权限全交给 agent。
**这是本次调研中除 Selfware 外最有价值的单点想法**（见 §6 对比）。

**(b) Combo —— 把已完成的工作蒸馏成可复用技能。** 手工完成一次任务后界面出现 Combo 按钮，
点击后 Floatboat 把"整个序列 —— inputs, instructions, preferences, output format ——
蒸馏成一个可移植的 skill 文件"（等级 B）。与 Zapier/Make 的区别在于
**自动化在工作完成之后被提取，而不是在工作开始之前被配置**。
厂商另有 "Tacit Engine™" 商标叙事，宣称被动观察用户在文件/浏览器/系统应用上的操作习惯（等级 B），
第三方转述其"被动感知约 80% 用户操作"（等级 C，无法验证，且对本地开发工具是隐私红线，见 §7）。

**(c) FloatIM —— agent 之间的工作交接网络。** 把任意 Floatboat 工作区变成一个可被 @mention 的
个人 agent，加入群聊；多个 agent 可"form ad-hoc teams, divide responsibilities, and check in at
key decision points"，且**跨用户/跨组织边界**（等级 B）。Bruce Tan 的定位原话：
"Floatboat gives agents a workspace. FloatIM gives them a network."

其余可确认事实：模型侧支持 DeepSeek / MiniMax / GLM / Kimi / GPT-5 / Claude / Gemini，
带 **"Auto Mode"**（便宜模型做解析、前沿模型做推理的路由，等级 B）；集成侧宣称通过原生 MCP + IACT
接入 "3,500+ tools"（等级 B）；消息侧接入 Slack / Telegram / WeChat / 飞书（等级 C）；
分发侧有 **Combo Store**（可组合技能）与 **Workflow Store**（固定执行流）两个商店（等级 B/C）。

---

## 4. Selfware Protocol（一手通读 · 等级 A）

**这一节是本报告的核心。** 以下全部基于克隆 `floatboatai/selfware.md` @ `4c4fddd` 后对
`template.self/` 的实际通读，不依赖任何转述。

### 4.1 定位与版本

- Slogan：**"A file is an app. Everything is a file."**
- License：MIT（明确允许修改、再分发、派生）
- RFC 风格规范，使用 MUST / MUST NOT / SHOULD / SHOULD NOT / MAY
- 仓库提供**可运行**的 `template.self` 脚手架 + 最小 Python runtime（`runtime/server.py`）
- 规范正文有 EN / ZH 双语（`selfware.md` / `selfware-zh.md`），并有脚本校验两版章节号对齐
  （`entrypoint/scripts/check-protocol-sync.sh`）

### 4.2 三大支柱

| 支柱                                      | 不可违反的原则（节选，原文 MUST）                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data Sovereignty**<br>数据主权          | 用户数据（Canonical Data）MUST 位于用户可访问、可读取、可迁移的位置；任何变更 MUST 经用户确认后才生效（**No Silent Apply**）；任何变更 MUST 可回滚；runtime/views/logic 是可替换实现，MUST NOT 成为数据的唯一持有者或访问瓶颈         |
| **Self-Containment**<br>自包含            | 实例 MUST 可复制、可转移、可独立运行；**View 是数据的函数（`View = f(Data, Intent, Rules)`）**，MUST NOT 成为事实源；打包 MUST 使用通用格式（ZIP）以便任何人解包检查；实例的**开发过程**（任务、决策、变更记录）SHOULD 记录在实例内部 |
| **Decentralized Evolution**<br>去中心演化 | Discovery 发送任何上下文 MUST 取得显式许可；Self-Analysis 对外发布 MUST 用户确认；生态制品 MUST 自描述（携带元数据）；协作 SHOULD 基于开放协议（如 Git）而非专有服务                                                                  |

### 4.3 目录约定（参考实现实际结构）

```
template.self/
├── selfware.md / selfware-zh.md   # 协议权威文件（EN/ZH）
├── manifest.md                     # 实例清单：canonical scope、runtime 入口、pack 计划
├── AGENT_CHARTER.md                # 跨 agent 的项目级原则（所有 agent MUST 遵守）
├── AGENTS.md / CLAUDE.md           # 各家 agent 的统一入口，MUST NOT 弱化 charter
├── governance/
│   ├── file-contract.yaml          # ★ 路径维度的权限契约（可执行）
│   └── trust-policy.yaml           # 制品校验与运行时安全策略
├── runtime/
│   ├── capabilities.yaml           # ★ 运行时能力自声明（机器可读）
│   ├── actors.yaml                 # ★ 角色身份与作用域（human/agent 分别授权）
│   └── server.py                   # 可替换的最小 runtime
├── entrypoint/
│   ├── index.yaml                  # 人机交互入口索引（action / prompt 两类）
│   ├── forms/*.yaml                # 动作参数表单（执行前收集输入）
│   └── scripts/*.{sh,ps1}          # 双平台等价脚本（MUST 同时提供）
├── content/                        # ★ Canonical Data Scope —— agent 唯一默认可写区
│   └── memory/
│       ├── data-changes.md         # ★ 数据变更账本（append-only）
│       └── software-changes.md     # ★ 软件变更账本（append-only）
├── process/
│   ├── tasks/       decisions/     # 任务与决策记录（require_discussion）
│   └── runs/                       # 运行日志（agent 可写）
└── specs/                          # 分册规范：runtime-api / packaging / memory / process / …
```

### 4.4 五个可直接借鉴的机制

#### (1) File Contract —— 把权限表达成"路径 × 动作 × 归属"

`governance/file-contract.yaml` 是一份**可执行的权限契约**。关键设计：

```yaml
semantics:
  access_values: [allow, deny, require_discussion] # ← 三态，不是二态
  rule_precedence: more specific glob wins; if equal specificity, later rule wins
defaults:
  agent_read: allow
  agent_write: deny # ← 默认拒写
  agent_execute: deny # ← 读/写/执行是三个独立轴
rules:
  - glob: '.env*'
    owner: human # ← 归属：human | agent | shared
    agent_read: deny
    agent_write: deny
    notes: Secret values are human-only.
  - glob: 'content/**'
    owner: human
    agent_write: allow # ← 唯一默认可写区
  - glob: 'governance/**'
    owner: shared
    agent_write: require_discussion # ← 不是拒绝，是"必须先跟人讨论"
  - glob: 'entrypoint/scripts/**'
    agent_execute: allow # ← 可执行但仍 require_discussion 才能改
```

**三个设计要点值得单独记下**：

- **`require_discussion` 是第三态。** 它既不是 allow 也不是 deny，而是"agent 可以提议，
  但必须先与人达成一致才能落地"。绝大多数 agent 权限系统只有二态，这一态精确表达了
  "高影响但合法"的操作。
- **读 / 写 / 执行分三轴。** `entrypoint/scripts/**` 是 `execute: allow` + `write: require_discussion`——
  可以跑，不能悄悄改。这个区分在只有"文件权限"的系统里表达不出来。
- **`owner` 字段。** `human` / `agent` / `shared` 表达的是**责任归属**而非访问控制，
  用于在冲突时判定谁有最终决定权。

#### (2) Change Ledger —— append-only 的变更账本

规范 §10.3 强制：**每次文件修改 MUST 产生一条 Change Record**，最小字段：

| 字段                | 含义                                                    |
| ------------------- | ------------------------------------------------------- |
| `id`                | 唯一标识                                                |
| `timestamp`         | ISO 8601                                                |
| `actor`             | `user` / `agent` / `service`                            |
| `intent`            | 这次改动想达成什么                                      |
| `paths`             | 受影响文件列表                                          |
| `summary`           | 人类可读描述                                            |
| **`rollback_hint`** | **怎么回滚 —— git ref / 备份位置 / 手工步骤，优先 git** |

并且**刻意拆成两条时间线**（`specs/memory.md` §4）：

- `content/memory/data-changes.md` —— 数据变更（`content/` 下的用户数据）
- `content/memory/software-changes.md` —— 软件变更（specs / runtime / governance / manifest 等）

拆分理由在规范里写得很清楚：数据变更频率高、体量大，属于"使用痕迹"；软件变更属于"开发记录"。
**混在一起会让软件迭代史被数据操作淹没，降低可审计性。** 单次操作若同时涉及两类路径，
MUST 在两个账本各记一条，用相同 `id` 关联。

> Memory MUST NOT 成为协议权威 —— 权威始终是 `selfware.md`。这一条防止了"记忆漂移变成规则"。

#### (3) Capability Manifest —— 运行时自我声明

`runtime/capabilities.yaml` 让运行时**机器可读地声明自己能做什么**：

```yaml
write_scope: [content/**]
confirmation_required: [pack_self, check_update_apply, publish, send_context, protocol_change]
endpoints: [{ method: GET, path: /api/capabilities, purpose: Return capability declaration }, …]
modules:
  { git: optional, discovery: optional, self_analysis: optional, trust_verification: enabled }
policies: { loopback_only: true, no_silent_apply: true, data_change_record_file: … }
```

配套的 MUST：runtime **MUST** 绑定 loopback（`localhost`/`127.0.0.1`/`::1`）除非显式配置；
只有 `POST /api/save` 可写入 `content/`；**发现自己缺少某项能力时，在执行写入或对外通信前
MUST 请求用户确认**。

#### (4) No Silent Apply —— 更新的四步仪式

规范 §6.3 把"应用一次更新"定义成不可省略的四步：

1. **解释更新逻辑** —— 来源、比对方式、应用过程、回滚机制
2. **给出更新摘要** —— 标题、说明、changelog / diff
3. **要求用户决策** —— Accept / Reject / Defer
4. **仅在 Accept 后应用**；Reject 后当前版本必须保持可用

且 §7 要求：**应用前 SHOULD 先创建回滚点**（优先 git commit/tag）。
§8.1 Git 协作补充：冲突时 MUST 停止自动应用，交回用户选择解决策略。

#### (5) Actors —— 按角色而非按进程授权

`runtime/actors.yaml` 为每个参与者声明独立作用域：

```yaml
actors:
  - id: human-owner
    type: human
    memory_scope: { read: ['**'], write: ['**'] }
  - id: default-agent
    type: agent
    memory_scope:
      read: [AGENT_CHARTER.md, manifest.md, docs/**, governance/**, content/**, …]
      write: [content/**, process/tasks/**, process/runs/**] # ← 比 human 窄
    confirmation_required_actions: [pack_self, check_update_apply, protocol_change, send_context]
```

**agent 的可读集合与可写集合被分别、显式地枚举**，而不是从进程身份继承。

### 4.5 其余规范要点（简记）

- **`.self` 打包**（§9）：就是 ZIP，MUST 含 `self/manifest.md`。打包前 MUST 展示文件树 + 总大小 +
  排除规则摘要 + 输出路径，用户 Accept 才执行。打包过程 MUST NOT 修改 `selfware.md`。
- **生态制品元数据**（§11.1）：`id / title / type / version / protocol_version_range / applies_to /
license / sha256 / provenance / distribution`，其中 `provenance` 是**派生链（可含父哈希）**，
  `distribution` 用 `hosted:` / `index:` / `git:` / `sha256:` 前缀约定。
  消费侧 MUST 先列候选 + 元数据，**绝不静默应用**。
- **Discovery / Self-Analysis**（§5 / §12）：可对外找方案、可从自身变更中蒸馏 know-how，
  但**任何对外发送 MUST 显式同意 + 默认最小化 + 支持用户裁剪与脱敏**。
- **Agent 责任原则**（`AGENTS.md`）：收到当前环境不完全支持的 `.self` 时，agent MUST 主动适配
  （装依赖、补脚本）；遇到与既有 `process/decisions/` 冲突的新需求时，**MUST NOT 静默覆盖**，
  而要显式指出冲突、引导用户澄清、并设计共存方案。

---

## 5. IACT Protocol（等级 B/C，未通读）

官方 README 的描述（B）：_"An ultra-lightweight inline interaction protocol designed for AI Agents,
enabling clickable interactive elements embedded in natural language conversations."_
仓库在 `github.com/floatboatai/iact`。

第三方转述（C，**未验证**）：缩写展开为 "Inline Action-Clicked Text"，是一个 Markdown 扩展，
让 AI 输出里直接内嵌功能按钮和可点击链接，宣称"减少 60–70% 复制粘贴摩擦"。

**评估**：机制方向是对的 —— agent 的输出不应只是文本，而应携带**结构化的下一步动作**，
由客户端统一渲染。但本次调研未克隆该仓库，规范细节、成熟度与安全模型（内嵌按钮触发的动作
如何走审批？）**均未验证**，不构成任何设计依据。

---

## 6. 与 DeepCode / Claude Code / Codex 的机制对位

按**机制**而非产品对位。DeepCode 一侧全部对源码核实（等级 A）。

| 机制           | Selfware / Floatboat                                                                      | DeepCode 现状（`main@ec94748`）                                                                                                                                                                                          | 差距性质                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 权限的表达维度 | **路径 × 动作三轴 × 三态**（`file-contract.yaml`）                                        | **工具维度**：`Bash(git diff:*)` / `WebFetch(domain:x)`，二态 allow/ask/deny（[`config/permissions.ts`](../../packages/core/src/config/permissions.ts)）                                                                 | **正交能力缺失**：DeepCode 能说"允许跑 git diff"，说不了"`.env*` 永不可读、`docs/**` 改动必须先讨论"                |
| 沙箱写边界     | `Canonical-Data-Scope: content/`，实例自声明                                              | `read-only` / `workspace-write` / `danger-full-access` 三档 + additional-dirs（[`sandbox/policy.ts`](../../packages/core/src/sandbox/policy.ts)）                                                                        | **DeepCode 更强**（真 OS 级隔离），但**粒度更粗**：workspace 内部无分区                                             |
| 权限轴分离     | 读/写/执行三轴                                                                            | **已做同类拆分**：sandbox mode 与 permission mode 是独立两轴（`sandbox/policy.ts` 顶部注释，对齐 `CODEX_ALIGNMENT_PLAN.md` §5.5）                                                                                        | 方向一致，DeepCode 已有正确设计                                                                                     |
| 变更审计       | **Change Record 账本**，每条带 `rollback_hint`，数据/软件双时间线                         | session JSONL 是**消息流**（[`sessions/storage.ts`](../../packages/core/src/sessions/storage.ts)）+ snapshots；`MEMORY.md` 存的是**事实**不是变更（[`memory/loader.ts`](../../packages/core/src/memory/loader.ts)）      | **能力缺失，且是最大的一个**：DeepCode 没有"agent 改了什么 + 怎么撤销"的持久人读账本                                |
| 运行时能力声明 | `capabilities.yaml` + `GET /api/capabilities`，含 `write_scope` / `confirmation_required` | protocol `initialize()` 已返回 capabilities（[`protocol/src/runtime.ts:112`](../../packages/protocol/src/runtime.ts)），但只声明**协议特性**（threadResume / workspaceDiff…），不声明**权限与写边界**                    | **部分缺失**：客户端问不到"这个 runtime 能写哪里、哪些动作要确认"                                                   |
| 更新仪式       | **No Silent Apply** 四步 + 先建回滚点，全局强制                                           | plugin 安装有 ed25519 签名 + 吊销列表（[`plugins/marketplace.ts`](../../packages/core/src/plugins/marketplace.ts)）；hooks 有 trust-gate（`config/hook-trust.ts`）                                                       | **DeepCode 在制品信任上更强**；但**没有统一的"diff 预览 + 回滚点"更新仪式**                                         |
| 制品元数据     | `sha256` + **`provenance` 派生链** + `protocol_version_range` + `applies_to`              | `name/version/sourceHash/sigBase64/publisherPubKey` + `revoked.json`                                                                                                                                                     | **DeepCode 更强**（有真签名与吊销，Selfware 只是 `signature_preferred: false`）；**缺 `provenance` 与版本兼容区间** |
| 技能来源       | **Combo：完成后蒸馏**成可移植 skill                                                       | skills 是**手写** `SKILL.md`（frontmatter: name/description/allowed-tools/model/effort/hooks，[`skills/loader.ts`](../../packages/core/src/skills/loader.ts)）                                                           | **能力缺失**：DeepCode 有完整的 skill 装载与三层来源，唯独没有"从已完成的 thread 生成 skill"                        |
| 主动触发       | 日程事件为 trigger，**权限按事件授予**                                                    | cron：5 字段表达式 + `{schedule, prompt, cwd, enabled}`（[`cron/index.ts`](../../packages/core/src/cron/index.ts)）+ launchd                                                                                             | **部分缺失**：只有时间源，无事件源抽象；**且 cron job 不携带权限档位**                                              |
| 模型路由       | **"Auto Mode"** = 便宜模型解析 / 前沿模型推理                                             | ⚠️ **同名不同义**：DeepCode 的 `auto-mode` 是**安全分类器**（[`auto-mode/index.ts`](../../packages/core/src/auto-mode/index.ts)），判 allow/ask/deny；模型选择靠 `--model` + effort 档（`docs/design/effort-levels.md`） | **术语冲突值得警惕**；路由能力本身缺失                                                                              |
| 内嵌动作       | IACT：输出内嵌可点击按钮                                                                  | 输出是文本；有 `AskUserQuestion` / `SubmitReviewFinding` 等专用工具                                                                                                                                                      | 能力缺失，但需先评估审批语义                                                                                        |
| 过程自包含     | `process/{tasks,decisions,runs}/` 记在实例内部                                            | tasks 是**内存态**（[`tasks/manager.ts`](../../packages/core/src/tasks/manager.ts)，`Map` 存储）；ADR 在 `docs/adr/` 由人写                                                                                              | 能力缺失（但 DeepCode 有 git，性价比需评估）                                                                        |

### 6.1 一句话总结这张表

> **DeepCode 在"执行的安全性"上明显强于 Selfware（真 OS 沙箱、ed25519 签名、吊销列表、
> 凭证边界）；Selfware 在"治理的可读性与可审计性"上明显强于 DeepCode（路径级契约、
> 变更账本、能力自声明）。两者不冲突，且几乎正交。**

---

## 7. 不利证据与风险（必读）

调研必须同时记录反面事实，否则不构成决策依据。

### 7.1 规范本身的成熟度问题（等级 A —— 一手观察）

| 问题                     | 观察到的事实                                                                                                                                                                                                                                                                                                                                                                                | 影响                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **版本号不自洽**         | 仓库 README 写 "Current protocol version: `v0.1.0 (Draft)`"，但 `template.self/selfware.md` 正文头部写 `Version: 0.2.0 (Draft)`；分册规范 `specs/memory.md`、`specs/process.md` 也标 `0.2.0 (Draft)`                                                                                                                                                                                        | 一个把 `protocol_version_range` 写进制品元数据的规范，自己的版本号对不上。**引用时必须锚定 commit 而非版本号**                                                                                      |
| **参考实现存在编码损坏** | 实测 62 个文件中：**5 个文件已含不可恢复的 U+FFFD 替换字符**（`specs/runtime-api.md` 25 处、`specs/memory.md` 15 处、`guides/import-history.md` 14 处、`CLAUDE.md` 12 处、`specs/process.md` 4 处）；**另有 4 个文件含非法 UTF-8 字节序列**（`iconv -f UTF-8` 失败：`selfware-zh.md`、`specs/runtime-api.md`、`guides/adoption.md`、`guides/import-history.md`）；**22 个文件带 UTF-8 BOM** | 规范正文里出现不可读字符，说明**发布流程缺少编码校验**。ZH 版协议权威文件本身就在损坏名单里 —— 一份要求"人类可读、可审计"的规范，其中文正文不可完整阅读。工程成熟度信号明显偏弱                     |
| **签名不是强制**         | `trust-policy.yaml`：`hash_required: true`、**`signature_required: false`**、`signature_preferred: true`                                                                                                                                                                                                                                                                                    | 制品信任只强制哈希不强制签名 —— 哈希只防传输损坏，**不防恶意发布者**。DeepCode 现有的 ed25519 强制校验比这更严                                                                                      |
| **生态基本为零**         | README 只指向单个 demo（`awesome-selfware/openoffice.self`）；`theaidb` 显示下载 9 次、0 条评价（等级 C）                                                                                                                                                                                                                                                                                   | `.self` 距离"事实标准"极远。**第三方评测亦承认这一点**："The open-source adoption curve will determine whether that format becomes a genuine standard or remains proprietary in practice"（等级 C） |

### 7.2 产品层不应借鉴的部分

- **Tacit Engine 的被动观察。** 宣称跨"每个文件、浏览器标签页、系统应用"观察用户习惯（B），
  第三方称覆盖约 80% 操作（C）。对一个**在用户代码库里执行写操作的本地工具**，
  这种全局被动采集是隐私与合规红线，与 DeepCode `docs/security-model.md` 的既有姿态直接冲突。
- **`.self` 自执行文件。** "文件即应用"意味着**分发的文件携带可执行逻辑**。
  对办公场景是便利，对 coding agent 是**典型的供应链攻击面**（收到一个 `.self` 就等于收到一个待运行程序）。
  Selfware 自己用 loopback-only + 用户确认来缓解，但威胁模型强度远低于 DeepCode 现有的
  子进程 + OS 沙箱 + 签名校验三层。
- **信用点计费与闭源实现。** 与 DeepCode 的 MIT + 自带 key 定位不兼容，无参考价值。
- **跨组织 agent 网络（FloatIM）。** 让外部 agent 加入频道并接收工作交接，
  对代码库场景意味着**未经审计的第三方 agent 触达源码**。方向不成立。

### 7.3 调研本身的局限（必须声明）

- Floatboat **客户端未安装、未运行**。所有产品层行为（日历触发、Combo 蒸馏、Auto Mode 路由的
  实际效果）**均为厂商声明或第三方转述，本次调研未做任何实测**。
- 定价订阅档位未能取到。
- IACT 仓库未克隆，规范未通读。
- 官方 Pandaily 报道页抓取到的正文为空，相关字段（成立时间、总部）仅有单一 C 级来源。

---

## 8. 对 DeepCode 的可行动结论

**建议深挖并选择性采纳的（按价值排序）：**

1. **Change Ledger** —— 带 `rollback_hint` 的 append-only 变更账本，数据/软件双时间线。
   填补 DeepCode 最大的能力空白：会话是消息流，不是变更账本。
2. **File Contract** —— 路径 × 读/写/执行 × `allow|deny|require_discussion` 的声明式契约，
   与现有工具维度 permission 正交叠加，不替换。
3. **Capability Manifest** —— 在 protocol `initialize()` 的 capabilities 之外，
   增加"写边界 + 需确认动作"的可查询声明，直接呼应 `CODEX_ALIGNMENT_PLAN.md` 的 P0
   "权限与工具执行不是运行时统一能力"。
4. **Combo（会话蒸馏为 Skill）** —— DeepCode 的 skill 装载链路已经完整，只差生成端。
5. **Trigger Profile** —— 让 cron job 携带权限档位，把"按事件授权"落到现有 `cron/index.ts`。

**建议明确拒绝的：** `.self` 自执行分发、Tacit 式被动全局观察、跨组织 agent 网络、
loopback HTTP runtime（与既有 app-server 重复）。

具体的落地路线、PR 切分、测试与回滚策略见配套方案文档
[`docs/FLOATBOAT_ADOPTION_PLAN.md`](../FLOATBOAT_ADOPTION_PLAN.md)。

---

## 9. 来源

**一手（等级 A）**

- [`github.com/floatboatai/selfware.md`](https://github.com/floatboatai/selfware.md) @ `4c4fddd` —— 完整克隆，通读 `template.self/` 全部文件
- [Selfware 协议原文](https://floatboat.ai/selfware.md)

**厂商一手（等级 B）**

- [Floatboat 官网](https://floatboat.ai/) · [定价页](https://floatboat.ai/pricing) · [服务条款](https://floatboat.ai/terms)
- [Floatboat Introduces FloatIM（EIN Presswire）](https://www.einpresswire.com/article/913396052/floatboat-introduces-floatim-turning-desktop-workspaces-into-agent-networks)
- [Floatboat Launches: The Proactive Agent OS（FinancialContent）](https://markets.financialcontent.com/stocks/article/abnewswire-2026-5-28-floatboat-launches-the-proactive-agent-os-that-runs-work-from-the-calendar)
- [IACT Protocol 仓库](https://github.com/floatboatai/iact)（未克隆）

**第三方（等级 C —— 未独立验证）**

- [Floatboat AI Review（ReviewsTown）](https://www.reviewstown.com/software/floatboat-ai-review/)
- [Floatboat（theaidb）](https://theaidb.com/apps/Floatboat)
- [Floatboat Launches "Proactive Agent OS"（Pandaily）](https://pandaily.com/floatboat-launches-proactive-agent-os-that-works-from-your-calendar)（正文抓取为空）
