# @deepcode/core

DeepCode 的 TypeScript 内核包：agent loop、DeepSeek provider、tools、config、sessions、MCP、sandbox、hooks、skills、plugins、tasks 与 worktrees。

> 当前架构方向见 [`docs/CODEX_ALIGNMENT_PLAN.md`](../../docs/CODEX_ALIGNMENT_PLAN.md)。原始模块规划保留在 [`docs/DEVELOPMENT_PLAN.md`](../../docs/DEVELOPMENT_PLAN.md) 中作为历史快照。

## 当前状态

主要模块均已有实现与测试。CLI/headless 通过 `RuntimeHost` 运行；desktop、VS Code 与 LSP 则作为版本化 app-server 协议的薄客户端。provider、凭据、agent loop、tools、permissions、hooks、sandbox、MCP 与 plugins 都由受信任的 Node host 统一组装，renderer 不运行模型或工作区变更逻辑。

关键入口：

- `src/runtime/`：`RuntimeHost`、默认 runtime 组装与执行器。
- `src/agent.ts`：host 内部使用的 agent loop 与兼容 facade。
- `src/providers/`：DeepSeek provider 与 capability/pricing。
- `src/tools/`：内置工具和 registry。
- `src/harness/tool-dispatcher.ts`：mode、permissions 与 hook gate。
- `src/sessions/`：legacy JSONL session 与 snapshots。
- `src/config/`：多层 `settings.json` loader。
- `src/sandbox/`：macOS sandbox-exec 与 Linux bwrap/network isolation。

## API 入口

公共 API 见 [`docs/core-api.md`](../../docs/core-api.md)。新增交互界面应实现 `@deepcode/protocol` 客户端；仅 headless/嵌入式 Node host 应直接使用 `RuntimeHost`。不要在 renderer、编辑器 extension host 或 LSP 进程中复制 provider/tool 组装。
