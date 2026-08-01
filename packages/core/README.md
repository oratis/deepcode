# @deepcode/core

DeepCode 的 TypeScript 内核包：agent loop、DeepSeek provider、tools、config、sessions、MCP、sandbox、hooks、skills、plugins、tasks 与 worktrees。

> 当前架构方向见 [`docs/CODEX_ALIGNMENT_PLAN.md`](../../docs/CODEX_ALIGNMENT_PLAN.md)。原始模块规划保留在 [`docs/DEVELOPMENT_PLAN.md`](../../docs/DEVELOPMENT_PLAN.md) 中作为历史快照。

## 当前状态

主要模块均已有实现与测试。CLI、headless、LSP 与 VS Code 已通过 `RuntimeHost` 固定 provider、tools、permissions、hooks 与 sandbox 等安全服务；`runAgent` 保留为 core 内部循环和 desktop 迁移期兼容入口。当前剩余的主要 host 差异是 desktop renderer 仍直接运行 provider/loop，后续按 packaging ADR 迁出 WebView。

关键入口：

- `src/agent.ts`：现有 agent loop 与兼容 facade。
- `src/providers/`：DeepSeek provider 与 capability/pricing。
- `src/tools/`：内置工具和 registry。
- `src/harness/tool-dispatcher.ts`：mode、permissions 与 hook gate。
- `src/sessions/`：legacy JSONL session 与 snapshots。
- `src/config/`：多层 `settings.json` loader。
- `src/sandbox/`：macOS sandbox-exec 与 Linux bwrap/network isolation。

## API 入口

```ts
import { runAgent, ToolRegistry, BUILTIN_TOOLS } from '@deepcode/core';
```

公共 API 见 [`docs/core-api.md`](../../docs/core-api.md)。新 host 不应直接复制 CLI 的组装代码；在 `RuntimeHost` 落地前，新增入口必须显式传入 mode、permissions、trust 与 sandbox policy。
