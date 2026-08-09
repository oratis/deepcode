# Contributing to DeepCode

感谢你对 DeepCode 感兴趣。DeepCode 是一个由 DeepSeek 驱动的本地 coding agent，正在收敛 CLI、桌面端和编辑器端的运行时语义。

> 在写代码前请先读：
>
> 1. [`AGENTS.md`](AGENTS.md) — 仓库操作、验证与安全约束
> 2. [`docs/CODEX_ALIGNMENT_PLAN.md`](docs/CODEX_ALIGNMENT_PLAN.md) — 当前架构与 PR 路线
> 3. [`docs/DEVELOPMENT_PLAN.md`](docs/DEVELOPMENT_PLAN.md) — 原始里程碑历史快照
> 4. [`docs/design/sandbox-plan-worktree.md`](docs/design/sandbox-plan-worktree.md) — sandbox × plan mode × worktree 三者关系
> 5. [`docs/design/plugin-security.md`](docs/design/plugin-security.md) — plugin 安全模型

## 项目结构

```
deepcode/
├── package.json            # workspaces 根
├── pnpm-workspace.yaml
├── packages/
│   ├── core/               # @deepcode/core — 内核（无 UI 依赖）
│   └── shared-ui/          # CLI 与桌面客户端共享类型
├── apps/
│   ├── cli/                # @oratis/deepcode — npm 包，命令 `deepcode`
│   └── desktop/            # Mac 客户端（Tauri 2 + Rust + React）
├── docs/
│   ├── DEVELOPMENT_PLAN.md
│   ├── VISUAL_DESIGN.html
│   └── design/             # 强制设计文档
└── reference/
    └── claude-code-upstream/   # 只读 fork，gitignored
```

详见 `docs/DEVELOPMENT_PLAN.md` §2 整体架构。

## 开发环境

### 必需

- Node.js ≥ 22
- pnpm ≥ 9
- Git ≥ 2.30
- ripgrep（CLI Grep 工具依赖）

### 推荐

- macOS 14+（Mac 客户端开发必需）
- VS Code + ESLint / Prettier 插件
- DeepSeek API key（用于集成测试 — 仓库 secrets 注入）

### 一次性 setup

```bash
git clone https://github.com/oratis/deepcode.git
cd deepcode
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm docs:check
```

## 工作流

### 1. 选 issue / 提案

- 看 GitHub Issues 上的 `good first issue` 或 `help wanted` 标签
- 大改动先开 **discussion** 或 **draft PR**，避免做了又重做
- 跟开发方案对齐 —— 任何超出 `DEVELOPMENT_PLAN.md` 当前版本 scope 的能力，需要在 PR 描述里说明为什么进 scope

### 2. 开发

```bash
git checkout -b feat/<topic>
# ... write code ...
pnpm test
pnpm lint
pnpm typecheck
```

### 3. 提交

**Commit message 格式**（遵循 conventional commits）：

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

`type`:

- `feat`: 新功能
- `fix`: bug 修复
- `docs`: 文档
- `refactor`: 重构（不改外部行为）
- `test`: 测试
- `chore`: 维护性变更

`scope`（参考 monorepo 结构）：

- `core` / `cli` / `desktop` / `shared-ui` / `docs` / `ci`

例：

```
feat(core): add SubagentStop hook event

实现 §3.6 hooks 9 事件中的 SubagentStop。
Task 子代理完成时触发，可被用户 hook 拦截做后处理。

Closes #42
```

### 4. PR

PR 标题必须 conventional commits 格式。PR 描述模板会自动加载 `.github/pull_request_template.md`，关键字段：

- **Summary**：3 句话以内说清楚干了什么
- **Test plan**：跑了哪些测试、怎么验证
- **Documentation**：本 PR 配套的 docs 改动
- **Release notes label**：选一个 `release-notes:feature` / `fix` / `breaking` / `internal`

### 5. 合并

- 至少 1 个 maintainer approval
- CI 全绿（typecheck / lint / test / build）
- PR 标题与提交都 conventional commits
- 默认 squash merge，保留干净 main 分支历史

## 测试要求

每个 PR 必须带对应测试。详见 `docs/DEVELOPMENT_PLAN.md` §6 里程碑表中每个 M 的"测试"列。

### 单元测试

```bash
pnpm test                     # 全部
pnpm --filter @deepcode/core test    # 单包
```

使用 vitest。test 文件 `*.test.ts` 与源码并列。

### 集成与真实 provider 测试

默认测试不请求 DeepSeek API。真实 provider 用例位于 `packages/core/src/providers/deepseek.live.test.ts`，只有显式提供测试凭证并按测试文件说明启用时才运行；不要把凭证写入仓库或测试日志。

### 安全测试（M3.5 起强制）

安全测试属于 `@deepcode/core` 测试套件。每个修改 `packages/core/src/sandbox/`、permissions、credentials、hooks、process execution 或 plugins 的 PR 必须运行 core 全套测试和对应的 focused test files；Linux kernel sandbox 集成测试还需要 bwrap/slirp4netns 与 CI 中的 opt-in 环境。

## 代码风格

- TypeScript strict mode
- Prettier 自动格式化（commit hook）
- ESLint with `@deepcode/eslint-config`（M0 出）
- 不允许 `any`（除非加 `// eslint-disable-next-line` 注释说明）
- 不允许默认导出（`export default`），强制命名导出

## 文档

- 公开 API 用 TSDoc 注释
- 复杂逻辑必须有 `// why:` 注释解释**为什么**这么写
- 大架构变化必须更新对应 `docs/` 文档（与代码同 PR）

## 安全相关

发现安全漏洞？**不要开 GitHub issue**。请发邮件到 `security@deepcode-todo.dev`（M0 期间临时邮箱待定，见仓库 SECURITY.md）。详见 `docs/design/plugin-security.md` 的威胁模型。

## 行为准则

- 礼貌、专业
- review 关注代码不关注人
- 接受批评的同时给出建设性反馈
- 不允许 ad hominem 攻击

## 许可

DeepCode 用 MIT 协议。提 PR 即表示你接受你的贡献以 MIT 协议发布。

## 联系

- GitHub Issues: bug 报告 / 功能请求
- GitHub Discussions: 设计讨论 / 一般问题
- maintainer: @oratis

---

_这份 CONTRIBUTING.md 是 M0 产出。M1 开始会逐步增加：CODE_OF_CONDUCT.md / SECURITY.md / .github/ISSUE_TEMPLATE/\* / .github/PULL_REQUEST_TEMPLATE.md。_
