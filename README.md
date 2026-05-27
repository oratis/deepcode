<div align="center">

# DeepCode

**Claude Code 的 DeepSeek 版** —— 完整复刻 Claude Code 全部能力，底层 LLM 切换到 **DeepSeek**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)](docs/DEVELOPMENT_PLAN.md)

</div>

---

> **当前状态**：📐 **设计阶段（M0）**。开发方案 v0.5 与视觉设计 v0.4 已锁定，工程实现尚未开始。  
> 不要把这个 repo 当作可用产品 —— 它现在只是设计文档与 mockup。

## 这是什么

如果你在用 **Claude Code**（Anthropic 的 AI 编程 CLI / 桌面客户端）但希望底层模型用 **DeepSeek** 而不是 Claude，DeepCode 就是为你做的。

我们的目标是：

- ✅ **完整复刻** Claude Code 的全部能力 —— 工具调用 / MCP / 子代理 / hooks / skills / plugins / harness / sandbox / checkpointing / 输出风格 / effort levels
- ✅ **两种形态**：Node.js CLI + Mac 客户端（v1.1+ 追加 VS Code + JetBrains 扩展）
- ✅ **零迁移成本**：settings.json / hooks / MCP servers / 自定义命令格式与 Claude Code 1:1 对齐；用户可直接从 Claude Code 导入配置
- ✅ **Mac 客户端自动更新**：Claude Code 式 "Relaunch to update vX.Y.Z" 浮层
- ✅ **GitHub Releases** 作为唯一发布渠道，签名 + 公证 + 三通道（stable / beta / nightly）

## 为什么不做（v1）

诚实声明范围边界：

- ❌ **图像输入**（v1 / v1.1 早期）：DeepSeek 无 vision 模型。等官方出 vision 或决策接 Qwen-VL fallback
- ❌ **Windows GUI**：CLI 在 WSL2 跑 Linux 版即可；不出 Windows 安装
- ❌ **Managed/MDM 配置层**：v1 不是企业产品
- ❌ **多账号 / 多 provider 切换 UI**：架构留扩展点，v1 仅 DeepSeek
- ❌ **云同步 / 协作 / 远程会话**：DeepCode 是本地工具

完整 WON'T 列表见 `docs/DEVELOPMENT_PLAN.md` §0.2。

## 怎么用（pre-alpha 设计稿，尚不可用）

实际可用后的预期：

```bash
# 安装 CLI
npm i -g deepcode-cli

# 首次启动 — 填入 DeepSeek API Key
deepcode

# 一次性 headless 模式（CI 用）
deepcode -p "fix the bug in src/auth.ts"

# 切到 plan mode
deepcode --mode plan

# 切到 R1 + Deep effort
deepcode --model deepseek-reasoner --effort high
```

Mac 客户端：拖入 Applications → 首启完成 onboarding（3 步：介绍 / 填 key / 选模型）。

详见 `docs/DEVELOPMENT_PLAN.md` §5 CLI 安装路径与全套 flags。

## 文档地图

| 文件                                                                         | 内容                                                                                                                                                                    | 必读?  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)                         | **整体开发方案 v0.5**（1500+ 行，含 §3.x 关键模块、§6 里程碑、§7 风险）                                                                                                 | ✅     |
| [docs/VISUAL_DESIGN.html](docs/VISUAL_DESIGN.html)                           | **视觉设计 v0.4**（11 屏 mockup：onboarding / CLI REPL / Mac 主视图 / composer / 文件面板 / 命令面板 / plan mode / plugins / settings / MCP manager / 自动更新 banner） | ✅     |
| [docs/design/sandbox-plan-worktree.md](docs/design/sandbox-plan-worktree.md) | sandbox × plan mode × worktree 三者关系矩阵 + 状态机 + 测试场景                                                                                                         | ✅     |
| [docs/design/plugin-security.md](docs/design/plugin-security.md)             | plugin 安全模型：威胁模型 / sandbox 子进程 / hash pin / 信任 ladder / kill switch                                                                                       | ✅     |
| [docs/design/effort-levels.md](docs/design/effort-levels.md)                 | effort 5 档到 DeepSeek API 参数映射 + M1 实测计划                                                                                                                       | ✅     |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                           | 贡献指南 / 开发环境 / commit message 规范 / 测试要求                                                                                                                    | 贡献者 |

## 现在的进度

✅ **M0 · 完成**

- [x] 开发方案 v0.5 (15 周 v1 + 4 周 v1.1)
- [x] 视觉设计 v0.4（11 屏）
- [x] 3 份必出设计文档（sandbox×plan×worktree / plugin 安全 / effort levels）
- [x] CONTRIBUTING.md / SECURITY.md
- [x] README skeleton（本文件）
- [x] monorepo 骨架（pnpm workspaces / TS project references / Vitest / Prettier / GHA CI）
- [x] `pnpm install && pnpm typecheck && pnpm build && pnpm test` 全绿
- [ ] 第一份 BEHAVIOR_PARITY.md 框架（M3 开始填）

⏸ **M1 · 内核 MVP**（next）：DeepSeekProvider + agent loop + 6 P0 工具 + sessions(jsonl) + 文件快照 + trust dialog 基础。详见 `docs/DEVELOPMENT_PLAN.md` §6 里程碑表。

## 命名由来

- **Deep** = DeepSeek 的 Deep + 深度思考的 Deep
- **Code** = 编程
- Logo：纯白猫头剪影（两尖耳 + 圆头），承载于品牌蓝 (`#4D6BFE`) 渐变方块

## 致谢

- **Anthropic** 的 [Claude Code](https://github.com/anthropics/claude-code) —— 我们的对齐基准
- **DeepSeek** —— 提供模型与 API
- **[LISA](https://github.com/oratis/LISA)** —— 内核 agent loop / MCP client / 工具实现的设计蓝本
- MCP 生态社区 —— Model Context Protocol 协议本身

## 许可

[MIT](LICENSE)

---

<div align="center">

📬 [GitHub Issues](https://github.com/oratis/deepcode/issues) · [Discussions](https://github.com/oratis/deepcode/discussions)

</div>
