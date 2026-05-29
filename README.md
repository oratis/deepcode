<div align="center">

# DeepCode

**Claude Code 的 DeepSeek 版** —— 完整复刻 Claude Code 全部能力，底层 LLM 切换到 **DeepSeek**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-549%20passing-brightgreen.svg)](.github/workflows/ci.yml)
[![v1 scope](https://img.shields.io/badge/v1%20scope-~98%25-brightgreen.svg)](MORNING_REPORT.md)

</div>

---

## 这是什么

如果你在用 **Claude Code** 但希望底层模型用 **DeepSeek** 而不是 Claude，DeepCode 就是为你做的。

- ✅ **完整对齐** Claude Code 的全部能力：工具调用 / MCP / 子代理 / hooks / skills / plugins / sandbox / checkpointing / 输出风格 / 5 档 effort levels
- ✅ **四种形态**：Node.js CLI · Mac 客户端 · VS Code 扩展 · LSP bridge (Neovim/Emacs/Sublime)
- ✅ **零迁移成本**：settings.json / hooks / MCP servers / skills / agents 与 Claude Code 1:1 对齐。见 [docs/MIGRATION_FROM_CLAUDE_CODE.md](docs/MIGRATION_FROM_CLAUDE_CODE.md)
- ✅ **同安全保证**：sandbox-exec (macOS) + bwrap (Linux) + ed25519 marketplace signatures + DNS proxy + pipeline analysis ([docs/security-model.md](docs/security-model.md))

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

## 完成度

```
M0  设计骨架            ████████████████████ 100%
M1  内核 MVP            ████████████████████ 100%
M2  CLI MVP             ████████████████████ 100%
M3  modes/hooks/memory  ████████████████████ 100%
M3c MCP/compact/etc.    ████████████████████ 100%
M3c-rest                ████████████████████ 100%
M3.5 sandbox            ████████████████████ 100%
M4  skills/agents/style ████████████████████ 100%
M5  plugins manifest    ████████████████████ 100%
M5.1 plugin subprocess  ████████████████████ 100%
M5.2 marketplace        ████████████████████ 100%
M6  Mac client          ██████████████████░░  90% (UI 11 屏 + IPC 协议完，等装 Electron binary)
M7  file panel + rewind ████░░░░░░░░░░░░░░░░  20% (UI 骨架；Monaco 等 binary)
M8  polish              ████████████████████ 100%
M9  release pipeline    ██████████████████░░  90%
v1.1  VS Code/JetBrains █████░░░░░░░░░░░░░░░  25% (VS Code 骨架 + LSP 骨架)
```

**549 个测试通过 · CI ubuntu + macOS 双矩阵绿色**。

详细汇报：[MORNING_REPORT.md](MORNING_REPORT.md)

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
  desktop/       # @deepcode/desktop — Electron Mac client
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

- **Anthropic** 的 [Claude Code](https://github.com/anthropics/claude-code) —— 对齐基准
- **DeepSeek** —— 模型与 API
- **MCP** 生态 —— Model Context Protocol 协议

## 许可

[MIT](LICENSE)

---

<div align="center">

📬 [Issues](https://github.com/oratis/deepcode/issues) · [Discussions](https://github.com/oratis/deepcode/discussions) · [Migration guide](docs/MIGRATION_FROM_CLAUDE_CODE.md)

</div>
