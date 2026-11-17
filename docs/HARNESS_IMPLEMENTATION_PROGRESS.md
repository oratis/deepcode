# Harness 改造实施进度

> 更新：2026-11-17（Asia/Shanghai）。对应 [完整方案](HARNESS_TRANSFORMATION_PLAN.md) 和 [ADR 0003](adr/0003-plugin-composed-harness.md)。
> 用户已批准按方案推进 H01–H04、独立界面优化及 v0.5.0 的 PR、独立审查、合并和发布。下方历史验收记录保留；发布收敛记录见文末。

## 工作包状态

| 工作包  | 状态                               | 交付与下一步                                                                                  |
| ------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| H00     | 已完成，用户已批准进入实施         | 方案、源码研究、ADR、运行时契约与文档入口                                                     |
| H01     | 已实现；本机安全与回归门禁通过     | 一个强制执行服务，接通 native/SDK/插件桥/MCP serve/hook MCP；插件默认隔离与撤销               |
| H02     | 原型已完成；本机打包与性能门禁通过 | 官方 Cordis 4.1.0、最小 kernel、生命周期测试、browser/CJS/sidecar/VSIX 原型                   |
| H03     | 已实现统一准入与 profile 基线      | 真实入口接入 AppBootstrap、固定安全根、严格 schema、只收紧 patch、空闲重载及 last-good 检查点 |
| H04     | 已实现 journal 与兼容适配基线      | v2 单写、双读、跨进程租约、durable 边界、只读导入、故障恢复与桌面数据接口                     |
| H05–H14 | 待推进                             | 领域插件迁移、完整 context/request、jobs、客户端与默认 backend 切换继续按方案验收             |

H01/H02 的 Linux 内核测试与 Linux 打包结果待 CI；CI 已添加同一原型门禁。本机为 macOS arm64，未启动 Docker daemon，也没有把 Linux 参数构造当作内核隔离实测。没有修改 Rust、用户会话文件或执行真实模型付费请求。

## H01：统一执行与安全边界

### 实现落点

| 路径                                                                                                                                   | 改动                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tool-execution.ts](../packages/core/src/runtime/tool-execution.ts)                                                                    | 新增 `ToolExecutionService`：权限/模式/contract/hooks、审批、不可变参数、一次性 admission、写路径复检、取消、deadline/drain、snapshot、spill、ledger、事件 |
| [agent.ts](../packages/core/src/agent.ts)、[tool-runner.ts](../packages/core/src/runtime/tool-runner.ts)                               | 删除两套重复执行实现；native 保留先审批再并行只读/串行写的调度，SDK adapter 使用同一服务并保留私有取消信号和历史事件投影                                   |
| [host.ts](../packages/core/src/runtime/host.ts)                                                                                        | 每 turn 建立执行 scope，运行结束撤销并 drain；客户端不能通过 turn options 注入自己的 executor                                                              |
| [capability-bridge.ts](../packages/core/src/plugins/capability-bridge.ts)                                                              | 一个共享的插件 RPC adapter。REPL、headless、app-server 仅绑定 turn scope，不再直接调用工具 handler                                                         |
| [serve.ts](../packages/core/src/mcp/serve.ts)                                                                                          | MCP 请求执行也进入服务；请求取消/断连关闭会撤销执行；自定义 gate 只能额外拒绝，不能代替基础策略                                                            |
| [dispatcher.ts](../packages/core/src/hooks/dispatcher.ts)、[wireup.ts](../packages/core/src/plugins/wireup.ts)                         | hook MCP/agent 回调绑定当前执行 scope；外部插件 command hook 经过 Bash broker；HTTP POST hook 暂明确拒绝                                                   |
| [subprocess.ts](../packages/core/src/plugins/runtime/subprocess.ts)、[isolation.ts](../packages/core/src/plugins/runtime/isolation.ts) | 默认 OS 隔离、环境白名单、加密随机 token、RPC 大小/并发限制、进程组清理和入站请求撤销                                                                      |
| [tool-dispatcher.ts](../packages/core/src/harness/tool-dispatcher.ts)                                                                  | auto classifier 的 allow 继续经过 PreToolUse，不再提前跳过 hook                                                                                            |

只有执行服务在这些生产入口中调用 `ToolHandler.execute`。工具内部实现、单元测试和用户明确审阅的宿主 command/http hook 属于不同边界，不把 JavaScript 类型或一次 gate 回调视为 OS 隔离。

### 执行契约

- 服务冻结每次调用的参数副本，审批和执行使用相同输入。admission 由私有 WeakMap 保存、只能消费一次，不能伪造或重复使用。
- `ToolExecutionBinding` 没有启动期/turn 间隙权限；每次 RPC 使用实际 turn 的 mode、contract、sandbox、signal。并发 turn 无法从旧 RPC 协议识别所属会话时，拒绝歧义请求，不猜测权限所有者。session-aware RPC 在后续 profile/extension 工作包补齐。
- native、SDK、CLI/server 插件桥和 `mcp serve` 使用同一拒绝/执行/结算实现。subagent 也经 `runAgent` 创建同类服务，继承父级工具上限、模式、contract、审批、sandbox、deadline、spill 与 ledger。
- 审批取消后，即使 UI 迟到返回 allow，也不能开始写入。工具超时先 abort，再最多等待 2 秒清理；不响应取消的可信进程内 handler 会使 scope 返回 `cleanup_incomplete` 并永久撤销，不能报告成功或继续执行。JavaScript 本身不能强制杀死任意进程内代码。
- snapshots/spill/ledger 使用该入口实际提供的 session/store/sink。没有 session 的 MCP 或 subagent 不伪造持久会话/rollback 引用；独立 subagent/job 会话归属仍属于 H04/H08。既有 ledger 写失败的 best-effort 语义尚未升级为 durable journal。
- hook MCP 使用 active scope，不保留上一 turn 的权限。递归 hook/tool 调用有拒绝路径，避免等待自己的串行队列。

### 插件进程与兼容变化

默认、`{mode: 'workspace-write'}` 和 `{mode: 'read-only'}` 都启用独立插件隔离；只有明确的 `danger-full-access` 或旧 `enabled:false` 退出 OS 隔离，`mode` 优先于 `enabled`。

macOS 使用专门的 deny-default profile：安装目录和 Node runtime 只读、每进程私有 HOME/TMP 可写、直接网络和 fork 不开放；Linux 使用 bwrap 的 mount/net/pid namespace 与最小只读运行时映射。宿主 workspace 不直接挂入插件。隔离工具缺失或平台不支持时拒绝启动，不自动裸跑。插件的运行依赖应包含在安装目录中，不能依赖任意宿主全局模块路径。

子进程使用 `process.execPath`，只带固定 PATH/LANG、私有 HOME/TMP 和 RPC token，不继承 `NODE_OPTIONS`、代理变量或任意 provider/cloud token。副作用通过 broker 请求后，受到普通工具策略约束；用户明确批准的 Bash 仍是现有 Bash 权限边界，这不是“Bash 能访问的任何秘密也会被自动隐藏”的保证。

停止时先撤销 RPC 和 pending invoke，abort 入站能力请求，再 TERM/KILL 进程组并等待清理。即使 leader 先退出也终止同组后代；临时目录在清理完成后删除。显式 full-access 运行的是用户信任代码，不能承诺控制恶意脱离进程组的代码。日志只写 stderr，JSON-RPC stdout 不夹杂插件 log 文本。

以下收紧有意改变旧绕过行为，升级时应可见：

1. 启动期和 turn 间隙的插件 fs/bash/fetch 请求被拒绝；已有运行中请求会随 scope 撤销。
2. 外部插件 command hook 使用 Bash broker；外部 HTTP POST hook 因当前 broker 仅支持 GET 而明确失败。用户已审阅的 settings command/http hook 保持原信任语义。
3. 插件 fetch 拒绝 body 或非 GET 方法，不再静默忽略参数。
4. 任意 `mcp serve` 自定义 `allowed:true` gate 不再扩大基础权限；需要授权时使用 `buildMcpGate` 的显式配置。无人审批时 ask 始终拒绝。
5. `bypassPermissions` 保留既有显式模式语义；file-contract deny、sandbox 和 hook deny 仍有效。本次不把 permission mode 偷换成新的外部 API。

### 安全测试证据

[统一执行回归](../packages/core/src/runtime/tool-execution.test.ts) 对 native、SDK adapter、共享 plugin bridge、MCP in-memory 真实协议和 service 五条入口运行同一矩阵：plan、permission deny、contract deny、read-only sandbox、无人审批、symlink 逃逸、hook deny、auto allow 后 hook deny、snapshot/ledger、spill、取消和 cooperative deadline。

另外验证一次性 admission、审批期间参数/路径变化、迟到审批、SDK 私有 signal 与事件投影、uncooperative cleanup、跨 turn/并发绑定拒绝、hook 的旧回调覆盖和递归拒绝。[原有 tool-runner 回归](../packages/core/src/runtime/tool-runner.test.ts) 继续覆盖 hardlink、审批后换链、最终路径检查时取消、额外可写目录和跨 turn snapshot 序号；[agent 测试](../packages/core/src/agent.test.ts) 保留 subagent contract/权限上限等回归。

[真实插件测试](../packages/core/src/plugins/runtime/subprocess.test.ts) 在本机原生沙箱验证外部文件读写、自改写和已监听回环端口访问被拒绝，环境变量白名单、错误 token/畸形 frame、RPC 撤销、忽略 TERM 的后代和 leader 先退出时的进程组清理。测试在外层工具沙箱内不能创建嵌套沙箱/监听端口，因此最终结果来自允许这些本地测试能力的执行环境；没有把 EPERM 环境错误当成产品通过。

## H02：实际 Cordis 依赖与最小 kernel

新增 [packages/kernel](../packages/kernel/src/index.ts)，直接使用 `@deepseek-ai/cordis` 的 Context、plugin/Fiber、inject/provide、effect 与 isolate。adapter 仅做声明图预检、明确失败与生命周期编排，不另造 DI，也尚未接替生产 `RuntimeHost`。

| 项目              | 实际结果                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| 发布包            | `@deepseek-ai/cordis@4.1.0`，MIT                                                                  |
| registry tarball  | `https://registry.npmjs.org/@deepseek-ai/cordis/-/cordis-4.1.0.tgz`                               |
| SHA-512 integrity | `sha512-CJrjNyBkKn1SfvBQUcgFYKFnLjS+uKrhdMsbHU60xabvi12d+xQ+IQSNlME5Z+B+4Zi6n4BDknKY94tEPeo47w==` |
| SHA-256 tarball   | `3b0099a6aa9b0b52c3e199042acf6f1ae195c5690f7de11aa61171bca7752eca`                                |
| 锁定闭包          | Cordis 4.1.0、`@deepseek-ai/cosmokit@1.9.0`、`@standard-schema/spec@1.1.0`，完整性均在 pnpm lock  |
| 未引入            | 可选 loader/include peers、Zstd、原生锁、Node 24 或 pnpm 11                                       |
| 许可              | [第三方 notices](../packages/kernel/THIRD_PARTY_NOTICES.md)，原型服务 bundle 和候选 VSIX 保留     |

通过 `npm pack --ignore-scripts` 取实际发布 tarball 并计算哈希；包内有 32 个文件及 MIT LICENSE。**发布包不等同研究 commit `39163dd3`**：8 个 src 文件存在差异，包括 ValidationError、注入 metadata 和 dispose 状态更新。这里选择已固定且受测的 registry 产物，不声称包含研究提交中的全部修复。

[生命周期测试](../packages/kernel/src/index.test.ts) 覆盖真实注入与 async 子 scope 释放、缺依赖/循环/重复服务/重复 ID 的启动前拒绝、初始化失败回收、漏 provision、卸载错误上报、候选失败保留旧图、连续 20 代重载不残留 registry/service、isolate 不回退父服务。

发布物的 `FiberState` 是被擦除的 const enum；isolated TypeScript/esbuild 无法运行时 import。adapter 使用固定版本的 ACTIVE 数值并测试 uid/服务可见性。Cordis 卸载异常默认写 logger，adapter 收集并以 AggregateError 向宿主报告，避免把日志当成成功卸载。KernelSlot 只验证候选图的原子选择；外部独占资源迁移、配置 schema、可信 root owner 校验、异步启动超时监管仍属于 H03/H08，不能把原型用于第三方任意代码。

## 打包与性能证据

运行 [spike-harness-kernel.mjs](../scripts/spike-harness-kernel.mjs) 构建现有 app-server 与加入 kernel fixture 的候选 CJS，打包真实 VSIX，并在临时目录、无 node_modules、`PATH=''` 下使用复制的 Node 22 runtime 执行 initialize 和关闭；macOS 复制 runtime 做 ad-hoc codesign。desktop 变体保持 `forceFileCredentials:true`。浏览器 fixture 在不含 process/require/Buffer 的 VM 中完成 boot/dispose。

固定本机环境：Node **22.23.4**、pnpm **9.12.0**、macOS arm64。基线和候选各 **11 次新进程/新 HOME**，交替次序，完整样本与数值见 [H02 实测 JSON](research/harness-h02-packaging-report.json)。这是冷进程启动，不是清空 OS 文件缓存后的磁盘冷启动。性能不包含厂商模型请求。

| 指标                        |       基线 | Cordis 候选 |  增量 |
| --------------------------- | ---------: | ----------: | ----: |
| app-server CJS (含 notices) |    706,096 |     740,525 | 4.88% |
| VSIX (含 notices)           |    218,798 |     231,127 | 5.63% |
| initialize 中位数 (ms)      |      45.08 |       47.66 | 5.73% |
| 启动 RSS 中位数 (bytes)     | 73,351,168 |  74,203,136 | 1.16% |

extension 为 31,814 bytes；browser kernel 为 30,809 bytes；desktop sidecar initialize 为 48.66 ms。

既有预算继续为 extension 64 KiB、app-server 768 KiB、VSIX 256 KiB；initialize 5 秒、metadata 2 秒、diff 10 秒。原型额外断言 server/VSIX/initialize 中位数/RSS 增量均不超过 15%。真实 Tauri 安装器签名、公证、安装更新和 Linux 结果不是本机这次 prototype 的结论。

## 可复现验证与当前边界

使用 Node 22 / pnpm 9：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
DEEPCODE_SDK_SMOKE=1 pnpm --filter @deepcode/app-server exec vitest run src/engines/claude-sdk.smoke.test.ts
pnpm release:check
pnpm spike:harness-kernel /tmp/deepcode-h02-report.json
pnpm docs:check
git diff --check
```

最终本机结果：

| 门禁                                    | 结果                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Frozen lock 安装                        | 通过，新增闭包锁定为 3 个包，无可选 loader/native 依赖                          |
| typecheck / lint / build                | 通过                                                                            |
| 全工作区 `pnpm test`                    | **1,865 passed / 23 skipped**，156 个测试文件通过；平台/opt-in 跳过未伪装成实测 |
| SDK executable smoke                    | **2 passed**，单独开启全量命令中跳过的 SDK smoke                                |
| `release:check`                         | 通过，包括真实 VSIX、初始化/恢复、metadata/diff、薄客户端与桌面能力扫描         |
| `spike:harness-kernel`                  | 通过；含版权 notices 后，所有既有包体预算与 15% 增量目标均满足                  |
| format / docs / diff / 本次文档本地链接 | 通过                                                                            |

测试记录日期是 2026-11-17，仅是本工作区验收，不替代未运行的远端 CI。

没有改 Rust，所以没有用 Rust 构建冒充 H01/H02 的测试。SDK smoke 使用已安装 SDK、回环 Messages fixture 和假 key；未验证外部厂商可用性。Linux CI 会安装 bwrap 并执行同一测试和 H02 门禁；本机平台不适用或显式 opt-in 的测试跳过会原样记录。

## H03：统一 bootstrap/profile

`RuntimeHost` 现在是 `AppBootstrap` 的迁移 facade。真实 CLI/headless/app-server 入口加载同一 profile schema；默认分别为 interactive/headless/app-server，Tauri/VS Code 分发入口分别选择 desktop/editor。所有现有 native/SDK host turn 都经 Cordis 固定根图准入。根服务核验实际实现引用及固定 owner/version，不接受配置提供的同名 owner 标签。

实现：

- `runtime/profile.ts`、`profile-loader.ts`：严格 schemaVersion=1、固定 base-coding、字段来源、受信 workspace、工具 allow 交集/deny 并集、配置快照。
- `runtime/bootstrap.ts`：无工具/provider 副作用的候选图、缺根服务拒绝、turn 代际固定、忙碌重载拒绝、失败保留当前图、last-good profile 原子保存、关闭时取消并排空。
- CLI `--profile`、`profile inspect` 与 completion；默认入口及 app-server 复用同一实现。生产 sidecar/VSIX 现在包含实际 Cordis，并保留第三方版权 notices。

H03 是固定第一方 bundle 的组合准入，不开放任意 host plugin 配置。Web/SDK/ACP entrypoint 尚未实现，不能作为可启动 profile 伪报。MCP/skills/memory 领域的既有组合 adapter 仍存在，按 H07/H09 移入完整领域插件；H05 的 request/context 配置指纹会继续扩展当前 profile generation。

## H04：session-v2 journal

实现：

- `sessions/journal.ts`：版本化 envelope、单调 seq、eventId、runEpoch、payload 校验、JSONL 已提交前缀与 SHA-256、原子 manifest、纯模型/timeline/资源投影；未知必要语义拒绝续写。
- `sessions/lease.ts`：不可覆盖的租约代次，完整 owner 文件以 hard link 独占发布；不删除 stale owner、不用 TTL、不接管 live/unknown owner。AsyncLocalStorage 关联实际 writer scope，结束后的迟到写入拒绝。
- `sessions/importer.ts`：旧 TS/Rust 共享读屏障、版本/engine 检测、两次 source hash、私有资源复制与 snapshot 引用重定位、manifest 发布前不可见、幂等重试。迁移不改旧文件。
- `SessionManager`：默认 dual-read/single-write、v2 snapshot/SDK 资源位置、checkpoint 保留完整事实、故障恢复、归档与显式删除边界。
- `RuntimeHost` / `runAgent` / `ToolExecutionService`：完整 turn writer 所有权，input/model/turn、完整 message、审批、tool intent/result 的 durable 边界。提交 intent 失败不执行工具；取消终态在 drain 后确认；cleanup_incomplete 隔离会话。
- `CanonicalThreadStore`：新 UI snapshot 作为 journal 事件保存，旧 threads-v1 只读；app-server 从入队到 terminal 持同一租约，第二个 host 在入队前被拒绝；崩溃遗留 in-progress 标成 interrupted，已提交消息保留，不重放工具。
- 桌面数据 adapter：能力协商 `sessionJournal`，rename 与带 checksum/资源路径校验的文件历史走 app-server，旧 sidecar 才 fallback。未改 Rust，也没有让 renderer 接触凭据。

旧 native JSONL 可直接续写到独立 v2；旧 SDK continuation 与 snapshot-only 历史因缺少完整旧 writer 屏障保留只读、拒绝自动迁移。旧 thread snapshot 的丰富过程不冒充完整导入，缺失事实有记录。新 v2 SDK 继续绑定私有 engine、拒绝跨 engine/fork。

详细配置、限制与降级步骤见 [使用与迁移说明](HARNESS_RUNTIME_GUIDE.md)。新 journal 不包括 token delta；每 step 请求快照、完整上下文生产者、job 状态机和 retention 继续由 H05/H08 接入。没有宣称 SDK 内部请求可重放或完成 H13 的最终 backend 切换。

## H03/H04 验收记录

边界测试覆盖：profile 恶意字段/重复配置/权限放宽、所有当前 profile 的真实 host 启动、缺失安全根、空闲代际切换、last-good 保持、关闭取消；实际两个 Node 进程的 writer 排他、SIGKILL 恢复、同时争抢唯一接续者；未提交尾修复与已提交损坏拒绝；三类旧 JSONL 的源字节不变、导入失败不发布、重复导入、未来版本/SDK 绑定拒绝；intent 提交失败不执行、result 提交失败不报成功；跨 host 入队/取消/终态租约；rename 与 snapshot 私有 blob 校验。

| 门禁                             | 最终结果                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------- |
| 全仓 `pnpm test`                 | **1969 passed / 23 skipped，166 files passed**；包括同工作区界面改动         |
| 真实 SDK 本机 fixture smoke      | **2 passed**；覆盖真实 SDK 工具桥与会话恢复，不访问外部模型服务              |
| typecheck / lint / format:check  | 通过                                                                         |
| build / desktop production build | 通过                                                                         |
| release:check                    | 通过：extension 49,100 B，app-server 769,856 B，VSIX 245,277 B；既有预算不变 |
| docs:check / git diff --check    | 通过                                                                         |

现有 `spike:harness-kernel` CI 门禁也已复核通过：当前 baseline 上的 prototype 增量为 server 0.65%、VSIX 1.00%、initialize 5.58%、RSS 0.49%；browser kernel smoke 通过。该复核使用当前 H03/H04 baseline，不替换上文历史 H02 测量。

结构化结果见 [H03/H04 验证记录](research/harness-h03-h04-validation.json)。仅记录本机 Node 22.23.4 / pnpm 9.12.0 / macOS arm64 实测；Linux 内核与其他文件系统仍以 CI 为准。没有改 Rust，未重跑 cargo。

## 回滚与下一步

H03/H04 已接入当前入口；完整插件化 backend 默认切换仍未发生。回滚前停止当前 host，保留 sessions-v2，使用旧 native 文件继续旧版；v2 后续追加不会倒灌。无效 profile 修复或显式恢复 last-good，不自动选择更宽权限。H01 强制执行边界不可通过架构回滚关闭；用户 worktree 不参与存储清理。

下一工作包是 H05 agent/context：typed registry、inbox、每 step 请求快照、context checkpoint 与 model/UI 投影分离。界面优化由独立 chat 实施，进度见其专项文档，不把该工作等同于 H10/H11 后端完成。

## v0.5.0 发布收敛（2026-11-17）

本次将 H00–H04 与独立界面 chat 的成果统一发布。版本已同步到 core、CLI、desktop、Tauri、Cargo 和 VSIX，CHANGELOG 明确旧会话兼容及回滚边界。独立审查分别覆盖执行/bootstrap、journal/server、发布打包、桌面 UI 和 VS Code UI；修复后重新运行相关门禁，以 PR 最终 CI 和 tag workflow 结果作为合并/发布证据。

发布渠道沿用仓库现有规则：当前没有 Apple、npm 或 updater 发布密钥，因此本次交付 GitHub Release、VSIX 与源码，不声称发布 npm、签名 DMG 或自动更新包。旧 CLI npm 打包仍引用未发布的私有 workspace 包，后续启用 npm 渠道前还必须实现独立安装打包并验证；不能仅添加 token 后把该渠道视为可用。

打包审查校正了 H02 原型脚本的比较含义：H03 后 current baseline 本身已经包含 Cordis，当前 15% 相对指标只衡量额外 kernel fixture，不代表完整 Cordis 引入成本；报告字段为 `incrementalFixtureOverhead`，保留绝对体积预算及 Node 22/browser/sidecar/VSIX smoke。历史 H02 原始测量不改写。macOS 发布步骤改为幂等同步版本，重复设置同一版本不会再触发 `npm version` 错误。

本地 Rust 验证：仅更新 Cargo 版本和 lock 对应条目，Rust 源文件未变；`cargo test --locked` **30 passed**（采用与 CI 相同的 compile-only sidecar placeholders，不构成 DMG 验证）。额外执行 `cargo fmt --check` 发现 HEAD 已有 Rust 格式差异；未在此发布中批量重排无关源码，此项不记为通过。

独立安全审查修复了外部 command hook 的原始 JSON 被 Bash 展示包装遮蔽、嵌套 hook 丢失请求级取消信号的问题。command hook 保留 JSON stdin 与 `DEEPCODE_HOOK_*` 环境，完整包装命令通过 Bash 审批；MCP/外部 command hook 的决策输出若被 capture 或 spill 截断则明确拒绝，不能把不完整 JSON 当作放行。请求级取消继续传到嵌套 MCP/agent hook。快速上手入口也改为本次实际可用的 VSIX 与源码方式。

独立会话审查修复了取消时遗漏已提交消息、分批保存终态后崩溃导致消息漏恢复、重复 call ID 错借其他 turn 结果的问题。terminal save 在同一 writer 内合并完整事实并提交 checkpoint/snapshot；重复内容按出现次数保留、恢复重试不重复添加，悬空调用在新输入前补本轮 durable/unknown 结果。新增 core/server 回归覆盖取消发生在执行中或结果提交后、部分 item flush、重复消息和跨 turn ID 复用。

审查修复后的全仓验证：`pnpm test` **2006 passed / 23 skipped，167 files passed**，真实 SDK loopback smoke **2 passed**；`release:check` 和 kernel smoke 均通过，extension **54,943 B**、app-server **771,551 B**、VSIX **247,198 B**，均在既有预算内。独立 UI chat 完成 desktop **155 tests + 22 Chrome E2E** 与 VS Code **38 tests**。本次结构化结果见 [v0.5.0 验证记录](research/harness-v050-validation.json)，历史 H02/H03/H04 报告保留原始数值。

[PR #297](https://github.com/oratis/deepcode/pull/297) 首轮 Linux CI 发现 bwrap 的私有 tmpfs 根允许在 HOME/TMP 之外创建临时文件；该结果不代表已证明宿主文件逃逸。后续修复在所有 bind 完成后将根 mount 非递归设为只读，保留私有 HOME/TMP 子挂载可写。原三种隔离模式的拒绝断言和宿主文件未创建检查保持不变，另验证 HOME/TMP 均可正常读写；macOS 原生隔离 12/12 复验通过，最终 Linux 内核结果以 PR CI 为准。

## v0.5.1 发布后修复

v0.5.0 的 PR #297、main CI 和发布验证通过并发布后，下载正式 VSIX 的扩展 smoke 发现 `thread/rename` 被 stdio decoder 拒绝；此前直接调用 handler 的测试覆盖不到这一层。独立 agent 确认遗漏共七项：`runtime/capabilities`、`thread/list`、`thread/fork`、`thread/archive`、`thread/delete`、`thread/rename`、`session/snapshots`。这不是 journal 锁死或打包差异，源码 stdio 同样返回 parse_error。

v0.5.1 将 decoder 方法表改为 `Record<ProtocolMethod, true>` 的穷尽检查并使用 own-property 判断，新增方法若遗漏 wire 支持会在编译期失败；未知方法和原型属性名仍拒绝。回归覆盖真实 stdio 的七个接口、snapshot 内容、fork/archive/delete 后列表以及重命名。发布 gate 直接调用打包后的接口并检查重启后的标题，避免用 handler 单测代替真实传输验收。会话格式与迁移策略保持兼容，请使用 v0.5.1 或更新版本。原 v0.5.0 tag 和测量记录保留，修复通过独立 PR 审查及 CI 后发布。

v0.5.1 独立复核无 P1/P2；Node 22 本机全仓 **2017 passed / 23 skipped**、SDK smoke **2 passed**，lint/format/docs/build/release gate 均通过。扩展后的空 PATH 独立 bundle smoke 覆盖全部七项管理操作及重启恢复；最终 bundle 为 extension **54,943 B**、app-server **771,730 B**、VSIX **247,261 B**。记录见 [v0.5.1 验证结果](research/harness-v051-validation.json)。

## v0.5.2：补齐可安装发布产物（2026-11-17）

继 v0.5.1 协议修复后，对正式 Mac/CLI 包做独立 review 和实际运行验证：

- Mac Node 侧车使用独立的最小 JIT entitlement；主 app 的 entitlement 不作为子进程权限。真实签名包在空 PATH、隔离 HOME 下完成会话全生命周期及重启。
- Apple 公证、staple、严格签名和最终 Gatekeeper 均为发布必过项。跳过构建时，实际 app 的版本必须与发布配置相同；旧产物不能被误标新版。
- DMG 仅挂载和清理本次生成的临时卷，不卸载用户已有的 DeepCode 卷。更新 tar 在最终 app 签名并 staple 后重新生成、签名；缺少匹配的 updater 私钥时不发布自动更新 feed，也不更换已发布公钥。
- CLI `.tgz` 内含运行时、15 个 builtin skills、schema 和第三方许可证，无私有 workspace 安装依赖。SDK 仍是独立可选依赖；DMG 原生运行时不内置实验性 SDK。
- 常规 CI 和发布 validation 均验证真实 CLI tarball：仓库外离线安装、命令入口、skills、schema/profile、stdio 会话操作、重启和可选 SDK 发现；即使 npm registry 认证不可用，也在 GitHub Release 提供 `.tgz`。

本地 Node 22 / pnpm 9 验证：2,021 项全量测试通过、23 项环境性跳过，随后新增的旧 app 版本拒绝测试通过（总计 2,022）；SDK loopback 2 项、Rust 30 项通过。typecheck、lint、format、docs、VSIX release gate、CLI 独立安装 gate 通过。未修改 Rust 业务源码；此前记录的 Rust 全仓格式历史问题不在此次变更范围。

对已签名 v0.5.2 app 额外运行回环 fake DeepSeek 服务，验证真实 native 流、Write 显式审批、批准前无文件、取消待审批后迟到批准拒绝且无写入、取消 provider 流关闭连接，以及重启后 completed/interrupted/interrupted 三个回合与工具结果恢复。没有调用真实模型，没有使用用户会话或 provider 凭据。这项验收不包含真实云端模型、SDK 桌面引擎或 Bash 子进程取消。

凭据通过既有本机 Keychain 使用，没有导出到仓库、发行包或 GitHub。npm registry 认证和 DeepCode updater 私钥分别验证，不把 Apple 签名凭据视为其替代。本地证据见 [v0.5.2 验证记录](research/harness-v052-validation.json)；最终产物、公证 ID、校验值和线上下载复验记录在发布 PR 与 [v0.5.2 发布页](https://github.com/oratis/deepcode/releases/tag/v0.5.2)。

此版本不修改 journal 格式和迁移策略。回滚可重新安装前版客户端；旧会话继续遵守只读源文件及 dual-read/single-write 规则。
