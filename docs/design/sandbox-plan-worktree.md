# Design: Sandbox × Plan Mode × Worktree 三者关系

> **状态**：M0 必出 · v1 lock · 写代码前必须 review 通过  
> **依赖章节**：DEVELOPMENT_PLAN.md §3.8 (modes) / §3.9a (sandbox) / §3.15.2 (plan mode) / §3.15.5 (worktree)

## 1. 问题陈述

DeepCode 的 agent 想"写盘"时，要穿过 **4 层正交关卡**：

```
        用户输入
           │
           ▼
   ┌───────────────────┐
   │ 1. Mode 策略       │  default / acceptEdits / plan / auto / dontAsk / bypassPermissions
   └────────┬──────────┘
            │
   ┌────────▼──────────┐
   │ 2. Permission 规则  │  settings.json 的 allow / ask / deny matcher
   └────────┬──────────┘
            │
   ┌────────▼──────────┐
   │ 3. Worktree 隔离    │  在主目录 or 临时 worktree
   └────────┬──────────┘
            │
   ┌────────▼──────────┐
   │ 4. OS Sandbox       │  bwrap (Linux) / sandbox-exec (macOS) 的 fs/net 白名单
   └────────┬──────────┘
            ▼
       实际系统调用
```

**每层独立写过 spec**（§3.8 / §3.9 / §3.15.5 / §3.9a），但**没有任何文档说"它们叠加时发生什么"**。这是 agent 安全的根基：

- 用户在 plan mode 下，sandbox 还需要兜底吗？
- worktree 模式下，permission deny 还生效吗？
- bypass mode 是不是真的能写 `.env`？sandbox 会不会拦？
- 如果 worktree 在 sandbox 之外（symlink 到主目录），写穿了怎么办？

这份文档把所有组合枚举出来，定义**优先级**与**预期行为**。

---

## 2. 设计原则

### 2.1 关卡是**串行 AND**

四层关卡是 **AND 关系，不是 OR**：必须**每一层都允许**，工具调用才能落到系统调用。

- 任何一层 deny → 调用失败
- 全部 allow → 调用穿透到 OS

### 2.2 关卡顺序固定，**从上到下不可逆**

Mode → Permissions → Worktree（路径改写）→ Sandbox（OS enforcement）。

- 用户视角先到 Mode 与 Permissions（可弹审批 UI）
- Worktree 是**路径透明改写**，工具不知道自己在 worktree 里
- Sandbox 是**最后兜底**，连 LLM 都不知道它存在

### 2.3 **Sandbox 永远不能被绕过**（除非显式 disable）

即 `bypassPermissions` mode 也必须穿过 sandbox。这是设计契约：

> 用户能放弃**自己**的审批（mode = bypass），但**不能放弃 OS 兜底**（这不是 mode 能控制的，是 sandbox 独立开关）。

只有 `settings.json` 的 `sandbox.enabled: false` 能关闭 sandbox。关 sandbox 是有意为之的"我知道我在做什么"决定，不是 mode 切换能触发的。

### 2.4 Plan mode 是"早期拦截"，不替代后续关卡

plan mode 不写盘，但**不是"短路 sandbox/worktree"** —— 它是在 Permission 那一层把所有写工具标 deny。后续关卡照常评估（其实没机会评估，因为已经被拦下）。

### 2.5 Worktree 是**路径透明改写**，不是"另一个权限层"

进入 worktree 后，agent 看到的 `cwd` 是临时目录，`./src/foo.ts` 解析到 worktree 内的副本。permission 规则照常按这个路径评估。

---

## 3. 决策矩阵（Mode × Sandbox × Worktree 全组合）

### 3.1 维度定义

| 维度                      | 取值                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| Mode                      | `default` / `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions` |
| Sandbox                   | `enabled` / `disabled`                                                        |
| Worktree                  | `main`（主工作目录）/ `inside-worktree`（已 EnterWorktree）                   |
| Permission rule（subdim） | `allow` / `ask` / `deny`                                                      |
| 工具种类                  | `read` / `write` / `bash` / `net`（WebFetch / MCP http）                      |

### 3.2 矩阵（按"写工具调用"枚举）

只考虑写工具（Edit / Write / Bash 有副作用）。读工具简单 —— mode 不限制读，只看 permission + sandbox。

| Mode                  | Permission               | Sandbox 状态 | Worktree        | 行为                                                                     |
| --------------------- | ------------------------ | ------------ | --------------- | ------------------------------------------------------------------------ |
| default               | allow                    | enabled      | main            | 弹审批 → 用户确认 → sandbox 校验路径 → 执行                              |
| default               | allow                    | enabled      | inside-worktree | 弹审批 → 用户确认 → sandbox 校验（worktree 路径自动在 allow 列表）→ 执行 |
| default               | allow                    | disabled     | main            | 弹审批 → 用户确认 → 直接执行                                             |
| default               | ask                      | enabled      | main            | 弹审批（明确显示"待批准"）→ …                                            |
| default               | deny                     | enabled      | main            | **不弹审批**，直接拒绝 + 提示"settings.json 中 deny 此规则"              |
| default               | deny                     | disabled     | main            | 同上                                                                     |
| **acceptEdits**       | allow                    | enabled      | main            | **自动放行**（无审批）→ sandbox 校验 → 执行                              |
| acceptEdits           | allow                    | enabled      | inside-worktree | 自动放行 → sandbox 校验 → 执行                                           |
| acceptEdits           | ask                      | enabled      | main            | 弹审批（acceptEdits 仅免 `Edit`/`Write`，不免 `Bash` 等 ask 项）         |
| acceptEdits           | deny                     | \*           | \*              | 拒绝                                                                     |
| **plan**              | \*                       | \*           | \*              | **强制 deny**（无视 permission），UI 显示红虚框"被 plan mode 阻止"       |
| **auto**              | allow                    | enabled      | main            | LLM 分类器跑一轮 → 输出 allow / soft_deny / hard_deny → 按结果继续       |
| auto                  | allow + 分类器=soft_deny | \*           | \*              | 弹审批（即使 permission 是 allow）                                       |
| auto                  | allow + 分类器=hard_deny | \*           | \*              | **拒绝**，本会话内同类调用不再询问                                       |
| auto                  | deny                     | \*           | \*              | 直接拒绝（permission deny 优先于分类器）                                 |
| **dontAsk**           | allow                    | enabled      | main            | 自动放行 → sandbox 校验 → 执行                                           |
| dontAsk               | ask                      | \*           | \*              | **拒绝**（dontAsk 不弹审批，ask 项一律 deny）                            |
| dontAsk               | deny                     | \*           | \*              | 拒绝                                                                     |
| **bypassPermissions** | \*                       | enabled      | main            | **跳过 mode/permission**，但 **sandbox 必须穿过**                        |
| bypassPermissions     | \*                       | enabled      | inside-worktree | 同上                                                                     |
| bypassPermissions     | \*                       | **disabled** | main            | 完全裸跑（最危险）                                                       |
| bypassPermissions     | \*                       | disabled     | inside-worktree | 裸跑，但 worktree 隔离仍生效                                             |

### 3.3 关键不变量

1. **plan mode 永远赢**：plan mode + 任何 permission + 任何 sandbox + 任何 worktree → 写工具 deny
2. **permission deny 永远赢**（除了 bypassPermissions 模式）：deny + 任何 mode（非 bypass）+ _ + _ → 拒绝
3. **sandbox enabled 永远兜底**：sandbox enabled + bypassPermissions + 任何 → 仍要穿过 sandbox 校验
4. **dontAsk 永远不弹审批**：dontAsk + ask permission → 直接 deny（不询问）
5. **acceptEdits 只免 Edit/Write**，不免 Bash 与其他高风险工具

---

## 4. 状态机：进入 / 退出

### 4.1 Plan mode 状态转换

```
   ┌─────────┐                     ┌──────────┐
   │ default │ ── EnterPlanMode ──▶│   plan   │
   └─────────┘                     └────┬─────┘
        ▲                               │
        │                               │
        └─── ExitPlanMode (after Approve)
```

- **进入**：用户切换 mode 选择器 / `/mode plan` / `EnterPlanMode()` 工具调用
- **退出**：用户点 "Approve plan" 按钮 / `/mode <other>` 显式切换 / `ExitPlanMode()` 工具调用
- **副作用**：
  - 进入时：harness 在 EventBus 发 `mode:plan:enter`，所有订阅者更新（composer 边框紫色、tool dispatcher 加 plan-deny 中间件）
  - 退出时：harness 在 EventBus 发 `mode:plan:exit` + `plan:approved` (if exit via approval)，把累积的 plan 内容作为 `<system-reminder>` 注入下一轮

### 4.2 Worktree 状态转换

```
   ┌──────┐                              ┌─────────────────┐
   │ main │ ─── EnterWorktree({base}) ──▶│ inside-worktree │
   └──────┘                              └────────┬────────┘
       ▲                                          │
       │                                          │
       └────────── ExitWorktree() ────────────────┘
                  ├─ 有改动: 自动 commit → 返回路径+分支名
                  └─ 无改动: 自动清理
```

- **进入**：`EnterWorktree({ baseBranch })` 工具调用
  - harness 执行 `git worktree add /tmp/dc-wt-<uuid> <baseBranch>`
  - 切换 session 的 `cwd` 指针
  - 在 EventBus 发 `worktree:enter`，sandbox 子系统更新 `filesystem.allowWrite` 添加 worktree 路径
- **退出**：`ExitWorktree()` 工具调用
  - 检查改动：`git status --porcelain`
  - 有改动 → `git add . && git commit -m "DeepCode agent worktree session"`，返回 `{ branch, path, files }`
  - 无改动 → `git worktree remove --force /tmp/dc-wt-<uuid>`
  - 切换 cwd 回主目录
  - 在 EventBus 发 `worktree:exit`，sandbox 移除 worktree 路径 allowlist

### 4.3 不允许的状态组合

- **plan mode + EnterWorktree 同时进入**：拒绝。worktree 涉及写盘（创建工作树），plan mode 禁写。需要先退出 plan 再 EnterWorktree。
- **bypassPermissions + sandbox disabled + 主目录**：UI 必须显示警告 banner（黄底）"⚠ 完全裸跑模式 — agent 可读写任何文件 / 触达任何网络"。但不阻止。
- **嵌套 worktree**：`EnterWorktree` while already inside worktree → 拒绝。一次会话只能在一层 worktree 里。

---

## 5. 实现契约

### 5.1 ToolDispatcher 评估顺序

`packages/core/src/harness/tool-dispatcher.ts` 的 `evaluate(toolCall)` 函数：

```typescript
async function evaluate(call: ToolCall): Promise<Verdict> {
  // 关卡 1: Mode
  const modeVerdict = await modePolicy.evaluate(call, currentMode);
  if (modeVerdict === 'deny') return { allow: false, reason: 'mode-denied' };
  if (modeVerdict === 'ask-plan') return await planModeBlock(call); // plan 专用

  // 关卡 2: Permissions
  const permVerdict = permissionMatcher.match(call, settings.permissions);
  if (permVerdict === 'deny') return { allow: false, reason: 'permission-denied' };
  if (permVerdict === 'ask') {
    const approved = await approvalUI.prompt(call);
    if (!approved) return { allow: false, reason: 'user-rejected' };
  }
  // 'allow' / 'auto' fall through

  // 关卡 2.5: auto classifier (仅 mode=auto)
  if (currentMode === 'auto') {
    const cls = await autoClassifier.judge(call, settings.autoMode);
    if (cls === 'hard_deny') return { allow: false, reason: 'auto-hard-deny' };
    if (cls === 'soft_deny') {
      const approved = await approvalUI.prompt(call, { hint: 'auto-classifier soft-denied' });
      if (!approved) return { allow: false, reason: 'auto-soft-deny-user-rejected' };
    }
  }

  // 关卡 3: Worktree path rewriting (transparent)
  const rewrittenCall = worktree.rewriteCall(call); // ./foo.ts → /tmp/dc-wt-<id>/foo.ts

  // 关卡 4: Sandbox (OS enforcement)
  if (settings.sandbox.enabled) {
    const sbVerdict = await sandbox.check(rewrittenCall);
    if (!sbVerdict.allow) return { allow: false, reason: `sandbox: ${sbVerdict.reason}` };
  }

  return { allow: true, executePath: rewrittenCall };
}
```

**优先级总结**：plan-deny > permission-deny > auto-hard-deny > user-rejection > sandbox-deny。 sandbox 是最后的兜底，前面任何一层拒绝都不会触发 sandbox 校验（也没必要）。

### 5.2 Sandbox 的 worktree 集成

sandbox 子系统订阅 `worktree:enter` / `worktree:exit` 事件：

```typescript
eventBus.on('worktree:enter', ({ path }) => {
  sandbox.fs.allowWrite.add(path);
  sandbox.fs.allowRead.add(path);
});

eventBus.on('worktree:exit', ({ path }) => {
  sandbox.fs.allowWrite.delete(path);
  sandbox.fs.allowRead.delete(path);
});
```

这样 worktree 路径自动进入 sandbox allowlist，无需用户手动配置。

### 5.3 Plan mode 的 tool-call 拦截

```typescript
class PlanModePolicy {
  async evaluate(call: ToolCall, currentMode: Mode): Promise<ModeVerdict> {
    if (currentMode !== 'plan') return 'pass';
    if (isReadOnly(call)) return 'pass';
    // 写工具被拦下，但不立即 deny -- 把意图记录给 plan card 用
    planCardAccumulator.record(call);
    return 'plan-blocked'; // 走 §5.1 的 planModeBlock 分支
  }
}
```

被 plan 拦下的工具调用**不消失**，而是被汇总到 plan card 的"agent 想做这些事"列表，等用户 Approve 后批量执行（或丢弃）。

---

## 6. UX 后果

### 6.1 用户可见的反馈

| 关卡拒绝点                   | UI 反馈                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Mode deny (非 plan)          | 工具卡片红虚框，标"被 `<mode>` 拒绝"                                                      |
| **Plan mode block**          | 工具卡片紫虚框，标"🔒 被 plan mode 阻止 — 仅记录意图" + 同时该 call 进 Plan Card 列表     |
| Permission deny              | 工具卡片红虚框，标"被 settings.json 中的 deny 规则阻止：`<规则>`"                         |
| Permission ask + user reject | 工具卡片灰虚框，标"用户拒绝"                                                              |
| Auto soft_deny + user reject | 工具卡片灰虚框，标"auto 分类器要求审批，用户拒绝"                                         |
| Auto hard_deny               | 工具卡片红虚框，标"auto 分类器硬拒绝：`<理由>`"                                           |
| **Sandbox deny**             | 工具卡片橙虚框，标"⚡ sandbox 阻止 — 试图访问 `<路径或域名>`" + 附"修改 sandbox 配置"链接 |

### 6.2 工具卡片状态徽章扩展

视觉稿 §11 状态徽章里已经有的：

- ⏸ pending approval / ✕ failed

**新增**（对应本文档）：

- 🔒 plan-blocked
- 🚫 deny（permission / auto / mode）
- ⚡ sandbox-blocked

---

## 7. 测试场景（M3.5 必须全部跑过）

### 7.1 不变量验证

```typescript
// T1: plan mode 永远 deny 写
test('plan mode denies write even when permission says allow', async () => {
  setMode('plan');
  setSettings({ permissions: { allow: ['Edit(*)'] } });
  const verdict = await dispatcher.evaluate(editCall);
  expect(verdict.allow).toBe(false);
  expect(verdict.reason).toBe('plan-blocked');
});

// T2: sandbox 兜底 bypassPermissions
test('sandbox denies even in bypass mode', async () => {
  setMode('bypassPermissions');
  setSettings({ sandbox: { enabled: true, fs: { denyWrite: ['/etc/*'] } } });
  const verdict = await dispatcher.evaluate(writeCall('/etc/hosts'));
  expect(verdict.allow).toBe(false);
  expect(verdict.reason).toMatch(/sandbox/);
});

// T3: dontAsk 拒绝 ask 项
test('dontAsk denies ask-rule without prompting', async () => {
  setMode('dontAsk');
  setSettings({ permissions: { ask: ['WebFetch'] } });
  const verdict = await dispatcher.evaluate(webFetchCall);
  expect(verdict.allow).toBe(false);
  expect(approvalUI.promptCount).toBe(0); // 没弹审批
});

// T4: worktree allowlist 自动加入 sandbox
test('worktree path joins sandbox allowlist on enter', async () => {
  await tools.EnterWorktree({ baseBranch: 'main' });
  expect(sandbox.fs.allowWrite).toContain(/^\/tmp\/dc-wt-/);
});
```

### 7.2 状态转换验证

```typescript
// T5: plan + EnterWorktree 同时拒绝
test('cannot enter worktree while in plan mode', async () => {
  setMode('plan');
  const result = await tools.EnterWorktree({ baseBranch: 'main' });
  expect(result.error).toMatch(/cannot enter worktree in plan mode/);
});

// T6: nested worktree 拒绝
test('cannot nest worktrees', async () => {
  await tools.EnterWorktree({ baseBranch: 'main' });
  const second = await tools.EnterWorktree({ baseBranch: 'feature' });
  expect(second.error).toMatch(/already inside worktree/);
});

// T7: ExitWorktree 自动 commit 有改动
test('ExitWorktree commits changes', async () => {
  await tools.EnterWorktree({ baseBranch: 'main' });
  await tools.Write('foo.ts', '...');
  const exit = await tools.ExitWorktree();
  expect(exit.branch).toMatch(/^dc-wt-/);
  expect(exit.files).toContain('foo.ts');
});
```

### 7.3 UX 反馈验证

```typescript
// T8: plan-blocked 调用进 Plan Card 列表
test('plan-blocked call is recorded in Plan Card', async () => {
  setMode('plan');
  await dispatcher.evaluate(editCall);
  expect(planCardAccumulator.entries).toContainEqual({ tool: 'Edit', ... });
});

// T9: sandbox 拒绝时 UI 提示路径
test('sandbox-blocked reason includes path', async () => {
  setSettings({ sandbox: { fs: { denyRead: ['~/.ssh/*'] } } });
  const v = await dispatcher.evaluate(readCall('~/.ssh/id_rsa'));
  expect(v.reason).toContain('~/.ssh/id_rsa');
});
```

---

## 8. 开放问题（M3 阶段需决定）

1. **auto 分类器超时**：分类器调用 LLM，可能超时。默认 fallback 是 ask 还是 deny？  
   **建议**：fallback = `ask`（保守，弹审批让用户决定）

2. **worktree 内的相对路径解析**：用户在 prompt 里说"修改 src/foo.ts"，是相对于主目录还是 worktree 目录？  
   **建议**：相对于当前 `cwd` —— 即 worktree 目录。系统 prompt 注入一条 `<system-reminder>` 提醒 agent "你现在在 worktree /tmp/dc-wt-xxx 里"。

3. **ExitWorktree 失败回滚**：如果 commit 失败（比如 hook 失败），exit 应该 fail 还是丢改动？  
   **建议**：fail。返回错误让 agent 自己决定（如清理 working tree 后重试）。**不丢用户工作**。

4. **多个并发 sub-agent 的 mode/sandbox**：Task 子代理跑在独立 context。它继承主 agent 的 mode 还是独立？  
   **建议**：默认**继承**（避免子代理偷偷越权），可在 sub-agent 的 frontmatter 显式声明 `mode: <name>` 覆盖。

5. **CLI headless 模式下的 plan mode**：CI 跑 `deepcode -p "..." --mode plan` 时，谁点"Approve plan"？  
   **建议**：headless 下 plan mode 只输出 plan 文本到 stdout 然后退出（exit code 0）。需要执行计划必须显式跑 `deepcode -p "..."` 第二轮。

---

## 9. 实现里程碑映射

| 里程碑   | 范围                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| M1       | 关卡 1（mode）+ 关卡 2（permission）的基础引擎；4 mode：default / acceptEdits / plan / bypassPermissions |
| M2       | settings.json `permissions` 字段加载 + matcher；2 种 glob 语法                                           |
| M3       | 完整 mode 5 档 + auto 分类器；plan mode 状态机 + Plan Card 累积                                          |
| **M3.5** | **关卡 4（sandbox）**：bwrap + sandbox-exec；与 §5.2 worktree 集成；**本文档 §7 所有测试**必须全绿       |
| M4       | 关卡 3（worktree）状态机；EnterWorktree/ExitWorktree 工具实现                                            |
| M7       | UX 反馈：所有 §6.1 的视觉状态在 GUI 落地                                                                 |

---

## 10. 关联文档

- `docs/DEVELOPMENT_PLAN.md` §3.8 / §3.9a / §3.15.2 / §3.15.5
- `docs/design/plugin-security.md` —— plugin 怎么穿过这套关卡
- `docs/design/effort-levels.md` —— 与本设计无直接交互
- `docs/security-model.md`（M3.5 产出）—— 完整威胁模型，本文是其前置
