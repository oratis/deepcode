# Design: Effort Levels — DeepSeek 数字核实

> **状态**：M0 必出 · 数字需 M1 实测验证 · 写代码前 review 通过  
> **依赖章节**：DEVELOPMENT_PLAN.md §3.13c (effort levels) / §3.1 (DeepSeek provider)

## 1. 问题陈述

DEVELOPMENT_PLAN.md §3.13c 给了一份"5 档 effort → DeepSeek 参数映射"表：

| Effort   | `deepseek-chat` `max_tokens` | `deepseek-reasoner` reasoning budget |
| -------- | ---------------------------- | ------------------------------------ |
| `low`    | 4,000                        | 1,500                                |
| `medium` | 8,000                        | 4,000                                |
| `high`   | 16,000                       | 12,000                               |
| `xhigh`  | 24,000                       | 24,000                               |
| `max`    | 32,000                       | unlimited                            |

**这些数字是 v0.3 写 plan 时编的**，没核对 DeepSeek API 文档，也没实测。可能：

- 超出 `deepseek-reasoner` 的硬上限（API 直接 422）
- 触达 context window 上限导致输出被截
- `reasoning_content` 没有"budget"这种 API 参数（DeepSeek 用别的字段名）
- 不同模型版本（v3 vs v3.1 vs R1 vs R1-Lite）默认值不同

本文档：

1. 把 DeepSeek 当前 API 真实情况 spec 出来（基于公开文档）
2. 把 effort 映射重新设计成**有数据支撑、保守可扩展**的形态
3. 给出 M1 实测计划与回填流程

---

## 2. DeepSeek API spec snapshot

> ⚠️ 数据来源：DeepSeek 官方 API 文档 https://api-docs.deepseek.com/ （文档 2026 年快照）。本文档时间戳后接 API 变更，M1 实测须以最新为准。

### 2.1 可用模型

| Model ID            | 类型                | Context    | Max Output                                        | 备注         |
| ------------------- | ------------------- | ---------- | ------------------------------------------------- | ------------ |
| `deepseek-chat`     | 通用对话 + 工具调用 | 128k token | **8,192 token**（硬上限）                         | 对应 V3 系列 |
| `deepseek-reasoner` | 推理模型            | 128k token | **8,192 token** 最终输出 + 独立的 reasoning chain | 对应 R1 系列 |

**关键事实**：**`max_tokens` 硬上限是 8,192**（截至文档抓取）。这意味着 v0.3 plan 的 `16,000 / 24,000 / 32,000` 三档**直接 API 422**。

### 2.2 `deepseek-reasoner` 的 reasoning 机制

`deepseek-reasoner` 返回的 chunk 多一个字段：

```jsonc
{
  "choices": [
    {
      "delta": {
        "reasoning_content": "...", // 推理链 — 用户不应直接看到
        "content": "...", // 最终回答 — 用户看
      },
    },
  ],
}
```

**API 参数控制**：DeepSeek API **没有公开的 "reasoning budget" 参数**。

- `max_tokens` 控制的是**最终 content 的上限**，不是 reasoning chain
- reasoning chain 长度由模型自己决定，调用方无法直接限制
- 实际效果：reasoning chain 可能长达数千 token，全部计入计费但不计入 `max_tokens`

**这是 plan §3.13c 表格的第二个错误**：把 reasoning budget 当成调用方可控参数，实际上不是。

### 2.3 上下文窗口预算

总 context window = 128k token。一次请求中：

- system prompt + history + user msg ≤ 128k − `max_tokens` − 安全 buffer
- 实际可用 ≈ 128k − 8,192 − 2,000 = **~117,800 token** 给 system + history

### 2.4 计费

| 模型                | Input  | Cache Hit | Output  | Reasoning（reasoner 专属）              |
| ------------------- | ------ | --------- | ------- | --------------------------------------- |
| `deepseek-chat`     | ¥1 / M | ¥0.1 / M  | ¥2 / M  | n/a                                     |
| `deepseek-reasoner` | ¥1 / M | ¥0.1 / M  | ¥16 / M | ¥4 / M（按 reasoning_content token 算） |

**effort levels 设计时要考虑成本曲线**：reasoner 的 reasoning_content 是按 token 计费的，所以"更深思考"是真有钱在烧。

---

## 3. 修正后的 effort 映射（v0.5）

### 3.1 设计原则

1. **数字必须在 DeepSeek API 硬上限内**（max_tokens ≤ 8,192）
2. **5 档之间的语义差距明显**（不能是 4000 vs 4500 这种没区别的微调）
3. **包含一个 effort 用不到的维度** —— 因为 reasoning_content 不可控，effort 控制其他维度（max_tokens / temperature / context retention / 多步上限）来制造差异
4. **保持与 Claude Code effort 概念兼容**（low → max 5 档命名一致）
5. **CLI/GUI 用户文案语义清晰**：用户应知道"我选 high 多花多少钱"

### 3.2 修正后的映射表（5 档）

| Effort   | `max_tokens` | `temperature` | 上下文压缩阈值 | Multi-turn max | 推荐模型            | UI 标签      | 单轮预估成本（¥） |
| -------- | ------------ | ------------- | -------------- | -------------- | ------------------- | ------------ | ----------------- |
| `low`    | 1,500        | 0.2           | 50%            | 4              | `deepseek-chat`     | "Quick"      | ~0.01             |
| `medium` | 3,000        | 0.4           | 70%            | 8              | `deepseek-chat`     | "Standard"   | ~0.03             |
| `high`   | 6,000        | 0.6           | 80%            | 16             | `deepseek-reasoner` | "Deep"       | ~0.15             |
| `xhigh`  | 8,000        | 0.7           | 85%            | 32             | `deepseek-reasoner` | "Extra Deep" | ~0.30             |
| `max`    | 8,192        | 0.8           | 90%            | 64             | `deepseek-reasoner` | "Max"        | ~0.60+            |

**变化对比 v0.3**：

| 维度                    | v0.3 数字（虚构） | v0.5 数字（基于 API spec）            |
| ----------------------- | ----------------- | ------------------------------------- |
| `max_tokens` 最高       | 32,000            | **8,192**（API 硬上限）               |
| reasoning budget        | 1,500 → unlimited | 移除（API 不支持）                    |
| 新增 `temperature` 控制 | —                 | 0.2 → 0.8                             |
| 新增 context 压缩阈值   | —                 | 50% → 90%                             |
| 新增 multi-turn 上限    | —                 | 4 → 64                                |
| 新增推荐模型差异        | —                 | low/medium 用 chat，high+ 用 reasoner |
| 新增成本预估            | —                 | ¥0.01 → ¥0.60+                        |

### 3.3 effort 之间的语义差异

| 档位                        | 用户感受                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `low` "Quick"               | 快速回复，简短答案。适合"帮我看看这一行有没有错"。低延迟、低成本、不深度思考。                                |
| `medium` "Standard"（默认） | 平衡。适合日常编码任务、一般 bug 修复、文档编写。                                                             |
| `high` "Deep"               | 切换到 R1 推理模型。适合"重构这个模块"、"解释为什么 X 是死锁"。延迟显著增加（reasoning chain 可能数千 token） |
| `xhigh` "Extra Deep"        | R1 + 更大 multi-turn 上限 + 更宽松的 context 压缩。适合复杂任务如"迁移 prisma 到 drizzle"。                   |
| `max` "Max"                 | 不计成本上限。适合 agent 自主跑 1+ 小时的长任务。每会话可能 ¥3-10                                             |

### 3.4 effort 的"超出预算"行为

每个 effort 档位绑定一个**当轮 cost cap**（防"agent 跑飞烧光钱"）：

```jsonc
{
  "effortBudgets": {
    "low": { "maxTurnYuan": 0.05 },
    "medium": { "maxTurnYuan": 0.2 },
    "high": { "maxTurnYuan": 1.0 },
    "xhigh": { "maxTurnYuan": 3.0 },
    "max": { "maxTurnYuan": 20.0 },
  },
}
```

超过预算 → 弹审批 "本轮已花 ¥0.21，超 medium 档预算 ¥0.20。继续 / 切换 effort / 停止？"

---

## 4. CLI / 配置 全链路

### 4.1 优先级（高→低）

1. CLI flag：`--effort high`
2. 会话内：`/effort high`
3. Skill frontmatter：`effort: high`（该 skill 激活期间）
4. settings.json：`"effortLevel": "medium"`
5. 系统默认：`medium`

### 4.2 环境变量

`DEEPCODE_EFFORT_LEVEL` —— CI 场景用，优先级在 CLI flag 之下、`/effort` 之上。

### 4.3 settings.json 完整字段

```jsonc
{
  "effortLevel": "medium",
  "effortBudgets": {
    "low": { "maxTurnYuan": 0.05 },
    "medium": { "maxTurnYuan": 0.2 },
    "high": { "maxTurnYuan": 1.0 },
    "xhigh": { "maxTurnYuan": 3.0 },
    "max": { "maxTurnYuan": 20.0 },
  },
  "effortOverrides": {
    "code-review": "high", // skill code-review 强制升到 high
    "verify": "low", // skill verify 默认就用 low
  },
}
```

### 4.4 UI 显示

Composer 的模型选择器右侧显示当前 effort：

```
●  R1   ·   Deep   ⌄
```

点击展开下拉，可在同一 popup 切模型 + effort：

```
╭────────────────────────────╮
│  Model                     │
│  ●  deepseek-chat          │
│  ○  deepseek-reasoner      │
│                            │
│  Effort                    │
│  ○  Quick                  │
│  ●  Standard               │
│  ○  Deep                   │
│  ○  Extra Deep             │
│  ○  Max                    │
│                            │
│  Est. ¥0.03 / turn         │
╰────────────────────────────╯
```

切换某些组合时 UI 自动同步：选 `Quick` → 自动切到 `deepseek-chat`（reasoner 不适合 quick）。

---

## 5. Reasoning chain 的处理

虽然 `reasoning_content` 不可被 API 参数限制，但 DeepCode 可以**在客户端层**做以下事：

### 5.1 显示控制（UI）

每个 effort 档的 UI 表现：

- `low` / `medium`：不显示 reasoning chain（用 `deepseek-chat`，本来就没有）
- `high` / `xhigh` / `max`：默认折叠 reasoning chain，点击展开查看；输出区只显示 `content`

### 5.2 成本告警

每轮收完 stream 后，主进程统计 `usage.reasoning_tokens`：

```
统计窗口最近 10 轮平均 reasoning tokens：
  > 5000 → UI 状态栏 yellow "reasoning chain 偏长，effort 是否过高"
  > 15000 → 弹建议 "切到更低 effort 档"
```

### 5.3 Reasoning chain 的截断（v1.1）

DeepCode v1 不主动截断 reasoning chain（API 不支持）。但可以做"早停"检测：

- 如果 reasoning_content 超过 30k token 且 content 仍未开始输出 → 推断"模型卡死"
- 自动 cancel stream + 用 `content="<empty due to reasoning timeout>"` 完成本轮 + 提示用户

---

## 6. M1 实测计划

本文档的数字虽基于公开文档推断，但**必须 M1 阶段实测核实**。

### 6.1 实测脚本

`packages/core/scripts/effort-bench.ts`：

```typescript
const SCENARIOS = [
  { name: 'simple-edit', prompt: 'fix typo in src/foo.ts: line 12 says "calue" should be "value"' },
  { name: 'medium-refactor', prompt: 'extract helpers from src/auth.ts into src/auth-helpers.ts' },
  { name: 'complex-migration', prompt: 'migrate prisma to drizzle across 18 files' },
];

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

for (const eff of EFFORTS) {
  for (const sc of SCENARIOS) {
    const result = await runScenario(eff, sc);
    log({
      effort: eff,
      scenario: sc.name,
      duration_ms: result.duration,
      input_tokens: result.usage.prompt_tokens,
      output_tokens: result.usage.completion_tokens,
      reasoning_tokens: result.usage.reasoning_tokens ?? 0,
      cost_yuan: calcCost(result),
      success: result.passed_acceptance,
    });
  }
}
```

### 6.2 验收标准

实测产出 `docs/design/effort-levels-measured.csv`，包含：

- 实测各档实际 `max_tokens` 触顶情况
- 实际成本（与 §3.2 预估对比）
- 实际延迟（p50 / p95）
- 任务完成率

如果实测发现：

- 数字偏离预估 > 50% → 回填 §3.2 表格
- 某档区分度不够（如 `medium` 和 `high` 行为几乎一样）→ 重新设计该档

### 6.3 回填流程

M1 实测完成 → 更新本文档 §3.2 表格 → 同步更新 `DEVELOPMENT_PLAN.md` §3.13c → 通过 PR 修订（不是 plan 改 0.6 而是本文档作为权威源，plan 引用本文档）。

---

## 7. 与其他子系统的关联

| 子系统                   | 关联                                                      |
| ------------------------ | --------------------------------------------------------- |
| §3.1 DeepSeek provider   | provider 实现读 effort，注入 `max_tokens` / `temperature` |
| §3.13 Skills frontmatter | skill 可显式声明 effort，覆盖会话级设置                   |
| §3.15.8 statusLine       | statusLine JSON 包含 effort 字段，可显示当前档位          |
| `/effort` slash command  | M3 实现                                                   |
| `--effort` CLI flag      | M2 实现，参考 §5 CLI 全套 flags                           |

---

## 8. 开放问题（M1 实测后定）

1. **`deepseek-chat` 是否真的无 reasoning_content？**  
   文档说没有，实测确认。如果实测发现有，需要扩展所有 5 档都显示 reasoning chain。

2. **`max_tokens` 8,192 是当前上限还是会涨？**  
   2026 年 DeepSeek 可能发新版本提高上限。本文档 M3 重新核对。

3. **不同地域（中国大陆 / 海外）API 行为是否一致？**  
   通过 baseURL 改国内中转时，可能有限速 / 不同 timeout，需要测。

4. **`max` 档真的有意义吗？**  
   如果 `max` 与 `xhigh` 实测结果几乎一样（都顶到 8,192）→ 合并成 4 档。

5. **`temperature` 是否值得做 effort 维度？**  
   编码场景 temperature 高了反而不稳。可能 effort 只调 `max_tokens` 与上下文策略，不动 temperature。M1 实测决定。

---

## 9. 实现里程碑映射

| 里程碑 | 范围                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| M0     | **本文档**（不含实测数字，标"待 M1 实测"）                                                                                      |
| M1     | DeepSeekProvider 注入 effort 参数 + `effort-bench.ts` 实测脚本 + 回填本文档表格 + 写到 `docs/design/effort-levels-measured.csv` |
| M2     | `--effort` CLI flag                                                                                                             |
| M3     | `/effort` slash command                                                                                                         |
| M4     | skill frontmatter `effort` 字段加载 + `effortOverrides` 配置项                                                                  |
| M7     | GUI Composer 的 effort 选择器（视觉稿 #4）                                                                                      |
| M3+    | reasoning chain 成本告警                                                                                                        |

---

## 10. 关联文档

- `docs/DEVELOPMENT_PLAN.md` §3.13c（effort levels 起源）
- `docs/design/sandbox-plan-worktree.md`（无直接关联）
- DeepSeek 官方 API 文档（外部）：https://api-docs.deepseek.com/
- M1 产出 `docs/design/effort-levels-measured.csv`（数据源）
