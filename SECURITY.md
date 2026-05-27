# Security Policy

## 报告安全漏洞

**请不要通过 GitHub Issues 报告安全漏洞。**

漏洞披露请发邮件到（M0 期间临时邮箱，正式邮箱将随 v0.1 发布更新）：

> 联系方式：通过 https://github.com/oratis 找到 maintainer 私信

请在邮件中包含：

- 漏洞描述与影响范围
- 复现步骤
- 受影响的版本
- 可能的修复建议（可选）

我们会在 72 小时内确认收到，并在合理时间内沟通修复时间表。

## 威胁模型

DeepCode 的核心威胁模型见：

- `docs/design/plugin-security.md` —— 插件攻击面（A1-A7 攻击者画像，最详）
- `docs/design/sandbox-plan-worktree.md` —— Mode × Permission × Worktree × Sandbox 四层关卡

简言之，我们假设：

- **用户的本地环境是可信的**（运行 DeepCode 的机器没被攻陷）
- **用户的 LLM 提供方 (DeepSeek) 是可信的**（不会主动给恶意指令）
- **插件、MCP server、自定义 hook 是不可信的**（都跑在 sandbox 子进程中）
- **用户的 prompt 输入是半可信的**（防 prompt injection 攻击 `Bash(deepcode plugin install ...)` 等）

## 支持的版本

| 版本 | 支持中                  |
| ---- | ----------------------- |
| 0.x  | M0 设计阶段，无公开发布 |

正式版（v1.0+）发布后将更新此表。

## 安全更新

DeepCode Mac 客户端支持自动更新（详见 `docs/DEVELOPMENT_PLAN.md` §4b）。

**Emergency security release** 流程：tag 后缀 `+security.X`（如 `v0.2.2+security.1`）→ release workflow 自动设 `mandatory: true` 写到 `latest-mac.yml` → 触发用户客户端的**红色强制升级 banner**，无法关闭。

CLI 端用户需要手动运行 `deepcode upgrade` 升级。重大安全漏洞会通过 GitHub Security Advisory + 邮件通知（如订阅）。
