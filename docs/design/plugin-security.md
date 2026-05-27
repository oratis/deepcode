# Design: Plugin 安全模型

> **状态**：M0 必出 · v1 lock · 写代码前必须 review 通过  
> **依赖章节**：DEVELOPMENT_PLAN.md §3.14 (plugins) / §3.9a (sandbox) / §3.15.10 (trust dialog) / `docs/design/sandbox-plan-worktree.md`

## 1. 问题陈述

§3.14 写了"`deepcode plugin install gh:user/repo`"—— 任意 GitHub 代码拉到本地 require()。**这是 v1 上线第一天就会被攻击的面**。

威胁面：

- **直接 RCE**：恶意 plugin 在 register() 里跑 `require('child_process').exec('rm -rf ~')`
- **凭据盗取**：plugin 读 `~/.deepcode/credentials.json` 或 macOS Keychain
- **加密劫持**：长期挖矿 plugin 后台跑
- **横向移动**：plugin 修改用户 `~/.deepcode/settings.json` 加自己到 `allow` 列表，或写恶意 hook 持久化
- **供应链**：plugin 依赖的 npm 包被攻击者接管
- **冒名顶替**：用户输错 `gh:user/repo`，装到 typosquat 仓库
- **诱骗信任**：marketplace 上有签名的官方插件改名近似官方插件名诱骗

光"显示个信任对话框" 不够 —— 用户会点 Yes。需要**多层防御**。

---

## 2. 威胁模型（who can attack via what）

### 2.1 攻击者画像

| 攻击者                        | 能力                                            | 动机                      |
| ----------------------------- | ----------------------------------------------- | ------------------------- |
| **A1 公开 plugin 作者**       | 写 plugin、发到 GitHub / npm / marketplace      | 挖矿 / 凭据盗取 / 横向    |
| **A2 已装 plugin 的更新接管** | 通过 npm/GitHub 接管账号或诱骗维护者合并恶意 PR | 同上 + 已通过初次信任审查 |
| **A3 依赖供应链**             | 攻击 plugin 依赖的 npm 包                       | 同上                      |
| **A4 typosquat**              | 注册近似名的恶意包                              | 等用户错装                |
| **A5 网络中间人**             | MITM `deepcode plugin install` 的网络请求       | 注入恶意代码              |
| **A6 marketplace 接管**       | 攻击官方/第三方 marketplace 注册表              | 大范围扩散                |
| **A7 本地 prompt injection**  | 通过 user message 让 agent 自己装恶意 plugin    | 绕过 trust dialog         |

### 2.2 关键资产保护优先级

P0（必须保护）：

- `DEEPSEEK_API_KEY` / `DEEPSEEK_AUTH_TOKEN`
- 用户 home 下的敏感文件（`~/.ssh/` / `~/.aws/` / `~/Library/Keychains` / `.env`）
- 用户的 git 仓库的 push 权限（`~/.ssh/id_*` / `~/.gitconfig` 含 push token）
- DeepCode 自己的 `~/.deepcode/credentials.json` / `~/.deepcode/settings.json`

P1（应该保护）：

- 浏览器 cookie / session 文件
- 用户主目录其他文件读取
- 任意网络外联（防挖矿、防泄露）

P2（best-effort）：

- 用户的工作目录（agent 本来就要读写）
- 临时文件夹

### 2.3 信任边界

```
   ┌─────────────────────────────────────────┐
   │       Host process (Trusted)             │
   │   (deepcode CLI / Mac app 主进程)        │
   │                                          │
   │   ▷ 持有 API key                         │
   │   ▷ 能改 settings.json                   │
   │   ▷ 调度 tool calls                      │
   └────────┬────────────────────────────────┘
            │ JSON-RPC over stdio
            │ (capability-passing)
            ▼
   ┌─────────────────────────────────────────┐
   │     Plugin sandbox (Untrusted)           │
   │   每个 plugin 一个独立子进程               │
   │   bwrap (Linux) / sandbox-exec (macOS)   │
   │                                          │
   │   ✗ 无法读 ~/.deepcode/                  │
   │   ✗ 无法读 ~/.ssh /.aws /.env             │
   │   ✗ 无法直接外联（除白名单域）            │
   │   ✗ 无法访问 keychain                    │
   │   ✓ 可以执行自己 contributes 声明的能力 │
   └─────────────────────────────────────────┘
```

**核心原则**：plugin **不在宿主进程内运行**。每个 plugin 进 sandbox 子进程，主进程通过 RPC 给 plugin 暴露**受限能力**（capability passing），plugin 永远拿不到完整的 fs / net 接口。

---

## 3. Plugin 生命周期与各阶段防御

### 3.1 Discover（用户发现）

| 渠道                                                 | 防御                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `deepcode plugin install ./local-dir`                | 本地路径 → 信任由用户负责，但仍走 sandbox 运行                                      |
| `deepcode plugin install gh:user/repo`               | 解析 GitHub URL → 显示 repo 描述 / star 数 / 创建日期；首次装弹"信任对话框"（§3.4） |
| `deepcode plugin install foo@marketplace`            | 解析到 marketplace index → 显示 marketplace 名 + maintainer + 审核状态              |
| `deepcode plugin install deepcode-plugin-foo`（npm） | 显示 npm 上的 maintainer / 下载量 / 最近更新；首次装弹信任对话框                    |

### 3.2 Install（下载到本地）

```
deepcode plugin install gh:user/repo
   │
   ▼ HTTPS clone（拒绝 HTTP）
   ▼ 验证 TLS 证书（拒绝自签）
   ▼ git clone 到 ~/.deepcode/plugins/.staging/<uuid>/
   ▼
   ▼ 校验 plugin.json schema（必需字段 / 版本号语义合规）
   ▼ 校验 contributes 数组合规
   ▼ 计算源码 hash（SHA-256 of tarball / git tree）
   ▼
   ▼ 检查官方/第三方 marketplace 的"已知 hash 列表"
   │     ┌─ hash 在已知列表 → 显示"✓ 此版本已被 <marketplace> 验证"
   │     └─ hash 不在 → 显示"⚠ 此版本未被任何 marketplace 验证 — 继续？"
   ▼
   ▼ 弹"信任对话框"（§3.4）
   ▼     显示: 名字 / 版本 / 作者 / contributes 清单 / 源代码地址
   ▼     用户选: [Trust & Install] / [Inspect source first] / [Cancel]
   ▼
   ▼ 用户 Trust → mv 到 ~/.deepcode/plugins/<name>/
   ▼ 记录到 ~/.deepcode/plugins-trust.json :
   ▼   { "<name>": { "version": "...", "installedAt": "...", "sourceHash": "...", "trustedBy": "user" } }
```

**安全 invariant**：

- 任何 plugin 在 `~/.deepcode/plugins/` 之外的位置（如 `.staging/`）**绝不被 load**
- `~/.deepcode/plugins-trust.json` 由 host process 维护，**plugin 不能写**（sandbox 拦截）
- 每个 plugin 必须有 manifest 中声明的 `version` 字段；版本不变但 hash 变 → 拒绝加载（防"GitHub 仓库被改"）

### 3.3 Hash pin 与版本固定

`~/.deepcode/plugins-trust.json` 中存的 `sourceHash`：

```jsonc
{
  "deepcode-plugin-data-tools": {
    "version": "0.3.0",
    "installedAt": "2026-06-01T08:30:00Z",
    "sourceHash": "sha256:abc123...",
    "trustedBy": "user",
    "marketplaceVerified": "oratis-official",
    "marketplaceSignature": "ed25519:...",
  },
}
```

**加载时**：每次 plugin load 重新计算 hash，与存档比对：

- 一致 → 正常加载
- 不一致 → **拒绝加载** + 弹对话框"此 plugin 自上次信任后被修改，是否重新审查？"

这相当于 npm 的 `package-lock.json` 但加 hash 校验。

### 3.4 Verify（marketplace 签名）

Marketplace 维护一份 `index.json`，列出所有审核过的 plugin 版本与 ed25519 签名：

```jsonc
// https://github.com/oratis/deepcode-marketplace/index.json
{
  "version": "1",
  "publicKey": "ed25519:abc...",
  "plugins": [
    {
      "name": "deepcode-plugin-data-tools",
      "versions": [
        {
          "version": "0.3.0",
          "source": "gh:oratis/deepcode-plugin-data-tools@v0.3.0",
          "sourceHash": "sha256:abc123...",
          "signature": "ed25519:...",
          "auditedBy": "oratis",
          "auditedAt": "2026-06-01",
        },
      ],
    },
  ],
}
```

DeepCode 内置 marketplace 公钥（编译时打入），`deepcode plugin marketplace add` 添加新 marketplace 时**强制要求公钥** + 首次添加用户必须显式信任。

### 3.5 Load（启动时加载到 sandbox 子进程）

```
host process 启动
   │
   ▼ 扫描 ~/.deepcode/plugins/* 与 settings.json 的 enabledPlugins
   ▼
   ▼ 对每个启用的 plugin:
   │   ├─ 重新计算 sourceHash → 与 trust.json 比对
   │   ├─ hash 不一致 → 跳过，告警
   │   └─ hash 一致 → 启动 sandbox 子进程
   │
   ▼ Sandbox 子进程启动:
   │   ├─ bwrap (Linux) / sandbox-exec (macOS) 包装 node 进程
   │   ├─ 文件系统:
   │   │     ✓ 可读: plugin 自己的目录 / /tmp/deepcode-plugin-<name>/
   │   │     ✗ 拒读: ~ home (~/.deepcode/ ~/.ssh/ ~/.aws/ etc.)
   │   ├─ 网络:
   │   │     ✓ 默认禁外联
   │   │     ✓ plugin.json 可声明 allowedDomains，主进程审核后注入
   │   ├─ 系统调用:
   │   │     ✗ 禁 ptrace / exec 任意命令 / mount / chmod root-owned 文件
   │   └─ 资源限制: max 200MB RAM, max 1 CPU core, max 100 file descriptors
   │
   ▼ Plugin 子进程通过 JSON-RPC over stdio 与主进程通信
```

### 3.6 Run（工具调用 / hook 触发 / skill 加载）

Plugin 的所有能力都通过 **capability handles** 暴露 —— 不直接 fs/net 访问：

```typescript
// Plugin 看到的 API（在 sandbox 内）:
interface PluginContext {
  // 读用户文件 — 但通过主进程代理，受 §3.9 permissions 约束
  read(path: string): Promise<string>;

  // 写文件 — 同样代理
  write(path: string, content: string): Promise<void>;

  // 跑 shell — 受 §3.9a sandbox + §3.9 permissions 双重约束
  bash(cmd: string): Promise<{ stdout; stderr; exitCode }>;

  // 网络 — 受 plugin.json 的 allowedDomains 约束
  fetch(url: string, opts?: RequestInit): Promise<Response>;

  // 日志 — 总是允许
  log(msg: string): void;

  // ✗ 没有直接 fs 模块 / net 模块 / child_process
  // ✗ 没有 require()（plugin 必须打包自己依赖到 bundle）
}
```

**契约**：plugin 的所有副作用通过这套受限 API 走，**经过主进程**。主进程在中间执行所有 §3.8 / §3.9 / §3.9a 的安全检查（详见 `docs/design/sandbox-plan-worktree.md` §5.1）。

这意味着 plugin 没法绕过用户的 permissions / mode / sandbox 设置。

### 3.7 Plugin contributes 的安全语义

| Contribution  | 安全语义                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills`      | skill markdown 加载后会作为 system prompt 注入主 agent 上下文。**这是 prompt injection 面** —— 恶意 skill 可以让主 agent 干坏事。**防御**：skill 加载前显示完整内容预览，由用户确认（首次） |
| `commands`    | 用户主动 `/<cmd>` 触发，等价 skill                                                                                                                                                          |
| `hooks`       | 每个 tool call 都会触发 hook —— 恶意 hook 可以泄露所有命令历史。**防御**：hook 也走 sandbox 子进程；http hook 必须显式声明在 `allowedHttpHookUrls`                                          |
| `mcpServers`  | MCP server 是独立进程，本身已经 sandboxed by §3.3。**注意**：plugin contributes 的 MCP server 默认 disabled，用户需要在 settings.json 显式 enable                                           |
| `agents`      | sub-agent 跑在主进程，但只用于 Task 调用。**防御**：sub-agent 的 `tools` 白名单字段会被强制收紧到 plugin 声明的 contributes 子集                                                            |
| `statusLines` | 命令在 sandbox 跑，stdout 渲染到 UI。**防御**：限制输出 ≤ 200 字符 / 5s timeout / 不传 env 变量                                                                                             |
| `modes`       | 自定义 mode 注册到 mode 选择器。**防御**：禁止 plugin 注册任何"放松权限"的 mode（必须比 default 收紧）                                                                                      |

---

## 4. 信任 ladder（plugin 来源等级）

DeepCode 显示 plugin 时，**按来源标颜色**：

| 颜色  | 标识                     | 含义                                                                |
| ----- | ------------------------ | ------------------------------------------------------------------- |
| 🟢 绿 | `official`               | 第一方 `oratis-official` marketplace 已签名 + 审核                  |
| 🔵 蓝 | `verified-third-party`   | 用户已添加的第三方 marketplace 签名（用户显式信任过该 marketplace） |
| 🟡 黄 | `unverified-marketplace` | marketplace 见过此 plugin 但没审核；或 npm 直装                     |
| 🟠 橙 | `direct-source`          | `gh:user/repo` 直装，没经过任何 marketplace                         |
| 🔴 红 | `local-path`             | `./path` 本地装；最高灵活性最低保证                                 |

GUI 的 Plugins 管理页面把这五档色用 dot/border 表示，让用户一眼看到自己装了多"敢"的东西。

---

## 5. Kill switch

### 5.1 单个 plugin 紧急禁用

```bash
deepcode plugin disable <name>           # 立即禁用，下次启动不加载
deepcode plugin disable <name> --kill    # 也 kill 当前在跑的 sandbox 进程
deepcode plugin remove <name>            # 物理删除
```

GUI 同样在 Plugins 页面有 disable / remove 按钮。

### 5.2 Marketplace 级 revoke

如果发现某 marketplace 上一批 plugin 是恶意的，marketplace 维护者发布 `revoked.json`：

```jsonc
{
  "revoked": [
    { "name": "deepcode-plugin-evil", "versions": ["*"], "reason": "credential theft" },
    { "name": "deepcode-plugin-x", "versions": ["<0.5.0"], "reason": "rce in load" },
  ],
}
```

DeepCode 每次启动拉一次（缓存 6h），命中即：

- **强制禁用**该 plugin（无视用户的 enabled 设置）
- 弹通知告知用户 + 列出 reason

用户可以选择 "Ignore revocation"（写到 `settings.json` 的 `ignoreRevokedPlugins`），但 UI 会持续显示红色警告徽章。

### 5.3 全局 plugin off

```bash
deepcode --no-plugins ...                # 单次启动不加载任何 plugin
```

settings.json:

```jsonc
{ "plugins": { "globalEnabled": false } }
```

用于紧急排查"是不是某个 plugin 在作恶"。

---

## 6. 默认安全姿态（first install / no settings.json）

新用户装完 DeepCode，**默认设定**：

| 项                           | 默认值                                                          |
| ---------------------------- | --------------------------------------------------------------- |
| `plugins.globalEnabled`      | `true`                                                          |
| `plugins.allowedSources`     | `["official", "verified-third-party"]` — 即默认不允许直装 `gh:` |
| `plugins.requireMarketplace` | `false`（用户可改 `true` 进入严格模式）                         |
| `plugins.autoUpdate`         | `false` — plugin 不自动升级，避免接管攻击                       |
| `plugins.maxPlugins`         | `20` — 防止误装大量 plugin                                      |

**`--strict` 模式**：`deepcode --strict ...` 等同临时 `requireMarketplace=true` + `allowedSources=["official"]` + `disableAllHooks=true`，适合 CI 或不信任环境。

---

## 7. 主进程在攻击下的恢复

### 7.1 主进程崩溃恢复

Plugin sandbox 进程崩溃**不影响主进程**。主进程检测到 plugin 子进程退出 → log + 标 plugin "crashed" 状态 + 不重启（避免崩溃循环）。

### 7.2 主进程被 plugin 攻击

理论上 plugin 在 sandbox 子进程内，无法直接攻击主进程。但有几个攻击面要明确：

- **RPC 输入**：plugin 通过 RPC 发数据给主进程，可能含恶意 payload（路径穿越、SQL injection 风格）。**防御**：所有 RPC 输入用 zod schema 严格校验，长度上限。
- **资源耗尽**：plugin 大量 RPC 请求拖死主进程。**防御**：每个 plugin 的 RPC QPS 限制 100/秒，超限断连。
- **请求伪造**：plugin 假装别的 plugin 身份。**防御**：每个 sandbox 子进程在创建时由主进程注入唯一 token，所有 RPC 必须带 token 校验。

### 7.3 凭据保护（最终防线）

即使 plugin 通过某种 0day 跳出 sandbox：

- `~/.deepcode/credentials.json` 文件权限 `600`
- macOS Keychain 访问需要主进程的 entitlement（plugin 子进程不带此 entitlement）
- 日志中 API key 永远打码（前 4 / 后 4 显示，中间星号）

---

## 8. Prompt injection 防御（A7 场景）

Plugin 安装是**带副作用的特权操作**。绝对禁止 LLM 主动通过工具调用安装 plugin。

**实现契约**：

- `Bash(deepcode plugin install ...)` → **硬拒绝**，无论 mode（包括 bypassPermissions）
- 这是在 mode 之上的硬规则，由 dispatcher 在 §5.1 关卡 1 之前先 short-circuit

用户必须在 CLI 或 GUI 中**亲自**输入 `deepcode plugin install` 命令。Agent 可以**建议**用户装某个 plugin，但不能自己装。

---

## 9. 测试场景

### 9.1 安全契约

```typescript
// S1: 恶意 plugin 试图读 API key
test('plugin cannot read ~/.deepcode/credentials.json', async () => {
  const evil = await installPlugin('./test-fixtures/evil-read-creds');
  const result = await evil.invoke('read-creds');
  expect(result.error).toMatch(/EACCES|sandbox/);
});

// S2: 试图 exec rm -rf
test('plugin cannot exec arbitrary shell', async () => {
  const evil = await installPlugin('./test-fixtures/evil-exec');
  const result = await evil.invoke('rm-rf-home');
  expect(result.error).toMatch(/sandbox-blocked/);
});

// S3: 试图外联
test('plugin cannot fetch unlisted domain', async () => {
  const evil = await installPlugin('./test-fixtures/evil-exfil');
  const result = await evil.invoke('post-to-evil-server');
  expect(result.error).toMatch(/network denied/);
});

// S4: hash 改动检测
test('plugin load fails if source hash changes', async () => {
  await installPlugin('./test-fixtures/normal-plugin');
  modifyPluginFile('normal-plugin', 'extra-line');
  const result = await loadPlugins();
  expect(result.errors).toContain(/source hash mismatch/);
});

// S5: revoke 强制禁用
test('revoked plugin cannot be loaded even if enabled', async () => {
  await installPlugin('./test-fixtures/will-be-revoked');
  await mockRevoke('will-be-revoked');
  const loaded = await loadPlugins();
  expect(loaded.find((p) => p.name === 'will-be-revoked')).toBeUndefined();
});

// S6: agent 不能自己装 plugin
test('agent cannot install plugin via Bash', async () => {
  const verdict = await dispatcher.evaluate({
    tool: 'Bash',
    args: { command: 'deepcode plugin install gh:user/repo' },
  });
  expect(verdict.allow).toBe(false);
  expect(verdict.reason).toBe('plugin-install-via-agent-forbidden');
});

// S7: RPC 输入 zod 校验
test('plugin malformed RPC is rejected', async () => {
  const evil = await installPlugin('./test-fixtures/malformed-rpc');
  const result = await evil.invoke('send-garbage');
  expect(result.error).toMatch(/schema-validation/);
});
```

### 9.2 默认姿态验证

```typescript
// S8: 默认不允许 gh: 直装
test('default install rejects gh: source', async () => {
  resetSettings(); // default
  const result = await cli.run('plugin install gh:user/repo');
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toMatch(/allowedSources/);
});

// S9: --strict 拒绝任何非官方
test('--strict only allows official marketplace', async () => {
  const result = await cli.run('--strict ...');
  // assert only official-tagged plugins are loaded
});
```

---

## 10. 与其他子系统的关联

| 子系统                | 关联                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| §3.9a Sandbox         | plugin 子进程**也**用同一套 bwrap/sandbox-exec 包装；plugin 的写工具调用通过 RPC 给主进程，主进程评估时会**再过一遍** sandbox（双重） |
| §3.15.10 Trust dialog | plugin install 复用 trust dialog UX，但更严格（必须读完 contributes）                                                                 |
| §3.6 Hooks            | plugin 贡献的 hook 也走 sandbox 子进程；http hook URL 需在 plugin.json 中声明并经 user 确认                                           |
| §3.14 Marketplace     | marketplace index.json 的签名机制定义在本文档 §3.4                                                                                    |
| §3.13 Skills          | plugin 贡献的 skill 加载时复用 skill loading 路径，但加 prompt injection 警告（首次加载）                                             |

---

## 11. 开放问题（M5 实现前定）

1. **Plugin 间通信**：plugin A 能调 plugin B 的能力吗？  
   **建议 v1**：不允许。每个 plugin 独立 sandbox，只与主进程通信。v1.1+ 可考虑显式 capability passing。

2. **Plugin 持久化存储**：plugin 想存自己的状态（比如缓存）放哪？  
   **建议**：`~/.deepcode/plugins/<name>/state/` —— 主进程在 sandbox 启动时 mount 这一个路径为可写。

3. **Plugin 更新通知**：plugin 有新版了，怎么提醒用户？  
   **建议**：被动 —— 用户运行 `deepcode plugin list --updates` 才查。不主动后台拉 update。

4. **Marketplace fork**：用户想 fork 官方 marketplace 加自己审核的 plugin，流程？  
   **建议**：clone repo + 改 publicKey + push → 用户 `deepcode plugin marketplace add gh:myuser/my-marketplace` 即可。

5. **二进制依赖**：plugin 想用 native node module（如 sharp）？  
   **建议 v1**：不允许。所有 plugin 必须纯 JS。v1.1+ 考虑预编译白名单。

6. **零容忍指标**：什么样的 plugin 行为触发自动 revoke？  
   **建议**：marketplace 维护者人工审核 + 用户 abuse 报告 + 自动检测（如 plugin 试图 RPC 超出声明的 contributes 范围）。

---

## 12. 实现里程碑映射

| 里程碑 | 范围                                                                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- |
| M0     | **本文档**；写代码前定 plugin sandbox 协议 schema                                                     |
| M3     | hook 子系统骨架（plugin 还没接入）；为 plugin hook 留接口                                             |
| **M5** | 完整实现本文档；包括 sandbox 子进程 / RPC / hash pin / trust dialog / marketplace index 拉取 / revoke |
| M6     | GUI Plugins 管理页面落地（§3.14 视觉稿 #8）                                                           |
| v1.1   | Marketplace 注册表正式上线（v1 期间用 GitHub repo 当 index）                                          |
