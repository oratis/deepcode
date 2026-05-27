# @deepcode/core

DeepCode 的内核包 —— agent loop / providers / tools / MCP / sandbox / harness。
**完全 UI 无关**，CLI 和 Mac 桌面客户端都依赖这个包。

> 详见 [`docs/DEVELOPMENT_PLAN.md`](../../docs/DEVELOPMENT_PLAN.md) §3 关键模块设计。

## 当前状态

M0 骨架 — 所有模块都是 placeholder。实际实现按 §6 里程碑展开：

| 模块                                                          | 文件                        | 里程碑 |
| ------------------------------------------------------------- | --------------------------- | ------ |
| agent loop                                                    | `src/agent.ts`              | M1     |
| DeepSeek provider                                             | `src/providers/deepseek.ts` | M1     |
| Read/Write/Edit/Bash/Grep/Glob tools                          | `src/tools/`                | M1     |
| Sessions (jsonl + 文件快照)                                   | `src/sessions.ts`           | M1     |
| Credentials (Keychain + 文件)                                 | `src/credentials.ts`        | M2     |
| Config (settings.json 三层)                                   | `src/config.ts`             | M2     |
| Slash commands                                                | `src/slash-commands.ts`     | M2     |
| Hooks (9 events × 5 handler types)                            | `src/hooks.ts`              | M3     |
| MCP client                                                    | `src/mcp.ts`                | M3     |
| Compaction                                                    | `src/compaction.ts`         | M3     |
| Memory dual system                                            | `src/memory.ts`             | M3     |
| Harness (system-reminder injector / plan mode / tasks / cron) | `src/harness.ts`            | M3     |
| Sandbox (bwrap / sandbox-exec)                                | `src/sandbox.ts`            | M3.5   |
| Skills                                                        | `src/skills.ts`             | M4     |
| Sub-agents                                                    | `src/sub-agents.ts`         | M4     |
| Output styles                                                 | `src/output-styles.ts`      | M4     |
| Plugins                                                       | `src/plugins.ts`            | M5     |

## API 入口

```ts
import { VERSION, PROJECT_NAME } from '@deepcode/core';
```

完整 API 表面将随 M1 实现展开，参见 `docs/core-api.md`（M1 产出）。
