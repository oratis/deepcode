<div align="center">

# DeepCode

**面向真实代码库的 DeepSeek coding agent** —— CLI、macOS 桌面端与编辑器接入共享一个持续演进的核心

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/oratis/deepcode/actions/workflows/ci.yml/badge.svg)](https://github.com/oratis/deepcode/actions/workflows/ci.yml)

</div>

---

## 这是什么

DeepCode 让 DeepSeek 可以在本地代码库中执行读取、编辑、命令、审阅、MCP 和可恢复会话工作。项目最初以 Claude Code 兼容为目标，现在正转向经过验证的 Codex 式运行模型：统一任务生命周期、可靠中断、清晰权限边界和跨客户端一致行为。

- **已可用**：Node.js CLI、Tauri macOS 客户端、核心工具、MCP、hooks、skills、plugins、sandbox、sessions、background tasks 与 voice input。
- **在收敛**：VS Code/LSP、统一权限、真实取消、thread/turn/item 协议与跨客户端恢复。
- **兼容优先**：继续读取既有 `settings.json`、`DEEPCODE.md`、`AGENTS.md` 和 Claude 风格扩展资产，但不以未经验证的“1:1 parity”作为安全或完成度承诺。
- **设计路线**：完整审查、正反方审议和分阶段 PR 见 [Codex alignment plan](docs/CODEX_ALIGNMENT_PLAN.md)。

## 快速上手

```bash
# 1. 装 CLI
npm i -g deepcode-cli

# 2. 设 DeepSeek key（首次启动会引导）
deepcode

# 3. 干活
deepcode -p "fix the bug in src/auth.ts"   # headless one-shot
deepcode --mode plan                       # plan mode REPL
deepcode --model deepseek-reasoner --effort high
```

Mac 客户端（v1 即将发布）：拖入 Applications → 首启完成 onboarding。

## 当前工程基线

主分支执行 typecheck、lint、format、Vitest、TypeScript build，并在 CI 中覆盖 macOS/Linux；Tauri Rust backend 也纳入单独检查。不要从 README 中读取静态测试总数，当前结果以 [CI](https://github.com/oratis/deepcode/actions/workflows/ci.yml) 为准。

已知架构差距和处理顺序记录在 [docs/CODEX_ALIGNMENT_PLAN.md](docs/CODEX_ALIGNMENT_PLAN.md)。[MORNING_REPORT.md](MORNING_REPORT.md) 是早期历史快照，不再表示当前进度。

## 文档地图

### 用户文档

| 文件                                                                     | 内容                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| [docs/MIGRATION_FROM_CLAUDE_CODE.md](docs/MIGRATION_FROM_CLAUDE_CODE.md) | 从 Claude Code 5 分钟迁移指南 + 字段映射        |
| [docs/BEHAVIOR_PARITY.md](docs/BEHAVIOR_PARITY.md)                       | 与 Claude Code 的逐项行为对比                   |
| [docs/SHIPPING_MAC.md](docs/SHIPPING_MAC.md)                             | 给 maintainer：Apple Dev ID + 签名 + 公证全流程 |
| [docs/VOICE_INPUT.md](docs/VOICE_INPUT.md)                               | 装 whisper.cpp 本地语音输入                     |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)                               | 5 分钟 launch 视频逐段录制脚本                  |

### 设计文档

| 文件                                                                         | 内容                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| [docs/CODEX_ALIGNMENT_PLAN.md](docs/CODEX_ALIGNMENT_PLAN.md)                 | 当前整体改造计划、审计证据、正反方审议与 PR 路线    |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)                         | 整体开发方案 v0.5（1500+ 行 / §3 模块 / §6 里程碑） |
| [docs/VISUAL_DESIGN.html](docs/VISUAL_DESIGN.html)                           | 视觉设计 v0.4（11 屏 mockup）                       |
| [docs/security-model.md](docs/security-model.md)                             | 威胁模型 + 防御层 + 攻击向量测试 + 已知缺口         |
| [docs/design/sandbox-plan-worktree.md](docs/design/sandbox-plan-worktree.md) | sandbox × plan mode × worktree 关系矩阵             |
| [docs/design/plugin-security.md](docs/design/plugin-security.md)             | plugin 信任 ladder + sandbox 子进程                 |
| [docs/design/effort-levels.md](docs/design/effort-levels.md)                 | 5 档 effort 到 DeepSeek API 参数映射                |
| [docs/m1-validation.md](docs/m1-validation.md)                               | M1 用真 DeepSeek API 验证记录                       |

## 项目结构

```
packages/
  core/          # @deepcode/core — agent loop, providers, tools, MCP, sandbox, hooks (UI-agnostic)
  shared-ui/     # @deepcode/shared-ui — types shared between CLI + Mac client + VS Code
apps/
  cli/           # deepcode-cli — Node.js CLI (npm publishable)
  desktop/       # @deepcode/desktop — Tauri 2 + React Mac client
  vscode/        # @deepcode/vscode — VS Code extension (v1.1)
  lsp/           # @deepcode/lsp — LSP bridge for Neovim/Emacs/Sublime (v1.1)
docs/
  design/        # internal design docs
  ...            # user-facing docs (migration, security, shipping)
scripts/
  gen-release-notes.ts  # conventional-commit grouped release notes
```

## 命名

- **Deep** = DeepSeek + 深度思考
- **Code** = 编程
- Logo：白猫剪影（两尖耳 + 圆头）

## 致谢

- **OpenAI Codex** —— 当前运行模型与客户端架构的重要公开参考
- **Anthropic Claude Code** —— 早期兼容设计的重要参考
- **DeepSeek** —— 模型与 API
- **MCP** 生态 —— Model Context Protocol 协议

## 许可

[MIT](LICENSE)

---

<div align="center">

📬 [Issues](https://github.com/oratis/deepcode/issues) · [Discussions](https://github.com/oratis/deepcode/discussions) · [Migration guide](docs/MIGRATION_FROM_CLAUDE_CODE.md)

</div>
