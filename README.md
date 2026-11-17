<div align="center">

# DeepCode

**面向真实代码库的 DeepSeek coding agent** —— CLI、macOS 桌面端与编辑器接入共享一个持续演进的核心

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/oratis/deepcode/actions/workflows/ci.yml/badge.svg)](https://github.com/oratis/deepcode/actions/workflows/ci.yml)

</div>

---

## 这是什么

DeepCode 让 DeepSeek 可以在本地代码库中执行读取、编辑、命令、审阅、MCP 和可恢复会话工作。项目最初以 Claude Code 兼容为目标，现在正转向经过验证的 Codex 式运行模型：统一任务生命周期、可靠中断、清晰权限边界和跨客户端一致行为。

- **已可用**：Node.js CLI、Tauri macOS 客户端、核心工具、MCP、hooks、skills、plugins、sandbox、sessions、background tasks、voice input，以及 0.3.0 的工作区治理层（file contract、change ledger、runtime capabilities、`/combo`、trigger profile）。
- **在收敛**：VS Code/LSP、统一权限、真实取消、thread/turn/item 协议与跨客户端恢复。
- **兼容优先**：继续读取既有 `settings.json`、`DEEPCODE.md`、`AGENTS.md` 和 Claude 风格扩展资产，但不以未经验证的“1:1 parity”作为安全或完成度承诺。
- **Harness 改造**：[完整 Harness 化改造方案](docs/HARNESS_TRANSFORMATION_PLAN.md) 已获实施授权，覆盖插件组合、全端迁移、安全与回滚；上一轮设计见 [Codex alignment plan](docs/CODEX_ALIGNMENT_PLAN.md)。

H01–H04 统一执行、Cordis、bootstrap/profile 与 session journal 的实现和验证见 [实施进度](docs/HARNESS_IMPLEMENTATION_PROGRESS.md)。

## 快速上手

v0.5.0 提供 [GitHub Release](https://github.com/oratis/deepcode/releases/tag/v0.5.0) 的 VSIX 与源码。下载 `deepcode-0.5.0.vsix`，在 VS Code 中运行 **Extensions: Install from VSIX…**，再打开 DeepCode 面板。

CLI 从源码运行：

```bash
# Node 22 + pnpm 9
git clone --branch v0.5.0 https://github.com/oratis/deepcode.git
cd deepcode
pnpm install --frozen-lockfile
pnpm build
deepcode_checkout="$PWD"
deepcode() { node "$deepcode_checkout/apps/cli/dist/cli.js" "$@"; }
deepcode --help
# 首次启动会引导设置 DeepSeek key
deepcode
deepcode -p "fix the bug in src/auth.ts"
deepcode --mode plan
```

`deepcode` 函数在当前 shell 中有效，也可以直接用 Node 执行构建后的 CLI 绝对路径。本次没有 npm 包、签名 DMG 或自动更新包；不要用 npm 安装命令获取 v0.5.0。桌面开发启动与未来发布配置见 [发布说明](docs/RELEASING.md)。升级旧会话前请读 [兼容与回滚说明](docs/HARNESS_RUNTIME_GUIDE.md)。

## 当前工程基线

主分支执行 typecheck、lint、format、Vitest、TypeScript build，并在 CI 中覆盖 macOS/Linux；Tauri Rust backend 也纳入单独检查。不要从 README 中读取静态测试总数，当前结果以 [CI](https://github.com/oratis/deepcode/actions/workflows/ci.yml) 为准。

最新源码对照与下一阶段处理顺序记录在 [完整 Harness 化改造方案](docs/HARNESS_TRANSFORMATION_PLAN.md)。[Codex alignment plan](docs/CODEX_ALIGNMENT_PLAN.md) 保留上一轮架构历史；[MORNING_REPORT.md](MORNING_REPORT.md) 是早期历史快照，不再表示当前进度。

## 文档地图

### 用户文档

| 文件                                                                     | 内容                                            |
| ------------------------------------------------------------------------ | ----------------------------------------------- |
| [docs/MIGRATION_FROM_CLAUDE_CODE.md](docs/MIGRATION_FROM_CLAUDE_CODE.md) | 从 Claude Code 5 分钟迁移指南 + 字段映射        |
| [docs/BEHAVIOR_PARITY.md](docs/BEHAVIOR_PARITY.md)                       | 与 Claude Code 的逐项行为对比                   |
| [docs/SHIPPING_MAC.md](docs/SHIPPING_MAC.md)                             | 给 maintainer：Apple Dev ID + 签名 + 公证全流程 |
| [docs/VOICE_INPUT.md](docs/VOICE_INPUT.md)                               | 装 whisper.cpp 本地语音输入                     |
| [docs/file-contract.md](docs/file-contract.md)                           | 路径维度权限契约（`deepcode contract`）         |
| [docs/change-ledger.md](docs/change-ledger.md)                           | 变更账本与回滚（`deepcode ledger`）             |
| [docs/combo.md](docs/combo.md)                                           | `/combo` —— 把做完的 thread 蒸馏成 skill        |
| [docs/triggers.md](docs/triggers.md)                                     | 定时任务触发源：cron / ICS 日历 / 文件变更      |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)                               | 5 分钟 launch 视频逐段录制脚本                  |

### 设计文档

下一阶段方案建议按顺序阅读：[完整方案](docs/HARNESS_TRANSFORMATION_PLAN.md) → [架构决策 ADR 0003](docs/adr/0003-plugin-composed-harness.md) → [运行时契约](docs/design/harness-runtime-v2.md) → [上游源码研究](docs/research/deepseek-harness-architecture-2026-11.md)。H01–H04 已实现并验证，H05–H14 仍按目标契约推进；完整改造尚未完成。

| 文件                                                                         | 内容                                                 |
| ---------------------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/CODEX_ALIGNMENT_PLAN.md](docs/CODEX_ALIGNMENT_PLAN.md)                 | 上一轮整体改造计划、审计证据、正反方审议与 PR 路线   |
| [docs/THREE_WAY_REVIEW.md](docs/THREE_WAY_REVIEW.md)                         | 与 Claude Code / Codex 的三方能力+界面对比与优先级   |
| [docs/FLOATBOAT_ADOPTION_PLAN.md](docs/FLOATBOAT_ADOPTION_PLAN.md)           | 工作区治理层的采纳/拒绝决策记录与实施偏差            |
| [docs/V0.3.0_REPORT.md](docs/V0.3.0_REPORT.md)                               | 0.3.0 交付报告：做了什么、拒绝了什么、发布踩了什么坑 |
| [docs/research/floatboat.md](docs/research/floatboat.md)                     | Floatboat / Selfware 调研（带证据分级）              |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)                         | 整体开发方案 v0.5（1500+ 行 / §3 模块 / §6 里程碑）  |
| [docs/VISUAL_DESIGN.html](docs/VISUAL_DESIGN.html)                           | 视觉设计 v0.4（11 屏 mockup）                        |
| [docs/security-model.md](docs/security-model.md)                             | 威胁模型 + 防御层 + 攻击向量测试 + 已知缺口          |
| [docs/design/session-format-v1.md](docs/design/session-format-v1.md)         | 统一 session JSONL、旧格式迁移与 writer ownership    |
| [docs/design/sandbox-plan-worktree.md](docs/design/sandbox-plan-worktree.md) | sandbox × plan mode × worktree 关系矩阵              |
| [docs/design/plugin-security.md](docs/design/plugin-security.md)             | plugin 信任 ladder + sandbox 子进程                  |
| [docs/design/effort-levels.md](docs/design/effort-levels.md)                 | 5 档 effort 到 DeepSeek API 参数映射                 |
| [docs/m1-validation.md](docs/m1-validation.md)                               | M1 用真 DeepSeek API 验证记录                        |

## 项目结构

```
packages/
  kernel/        # trusted Cordis bootstrap/lifecycle adapter
  protocol/      # app-server contracts and client transport
  core/          # @deepcode/core — agent loop, providers, tools, MCP, sandbox, hooks (UI-agnostic)
  shared-ui/     # @deepcode/shared-ui — types shared between CLI + Mac client + VS Code
apps/
  server/        # shared runtime owner and editor/desktop sidecar
  cli/           # @oratis/deepcode — Node.js CLI (run from source)
  desktop/       # @deepcode/desktop — Tauri 2 + React Mac client
  vscode/        # deepcode — VS Code extension (app-server protocol client)
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
