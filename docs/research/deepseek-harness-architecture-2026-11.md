# DeepSeek Harness 架构源码复核（2026-11）

> 调研日期：2026-11-17（Asia/Shanghai）<br>
> 上游：[`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)，`master@39163dd30f703a79079e2d2446545cff3c453738`，根包 `0.2.2-rc.3`，提交时间 2026-11-13<br>
> 对照：DeepCode `main@3421a3c77a4955d428b2bc9b5169c128b85c1279`<br>
> 方法：读取一手 Git clone 的源码、配置、测试入口与文档；未安装、构建或运行上游项目，未调用模型。本文不宣称上游测试通过或所有平台行为已经复现。<br>
> 历史材料：[2026-08 调研](deepseek-harness.md)、[第一轮能力采纳方案](../DSH_ADOPTION_PLAN.md)。本文保留历史结论的适用时间，不将其缺项表当作当前事实。

## 1. 本次研究回答什么

这次目标是把 DeepCode 的产品组装和扩展方式改造成 Harness 模式。关键差距已经从“缺几个工具”转为“运行时的每项能力能否通过有生命周期的插件组合”。旧方案明确拒绝 Cordis 化，理由是当时只需要移植若干能力；本次用户要求改变了范围，旧裁决不能继续阻止架构改造。

当前上游的含义比“支持插件”更完整：agent 驱动、会话存储、provider、工具、审批、prompt、后台作业、宿主 API、客户端 UI 都能作为独立贡献挂载；profile 选择产品组合，bundle 分发默认组合，patch 更换实例配置；卸载贡献时必须收回其注册和资源。DeepCode 已有扩展包与 MCP，不等于已经具备这个内部架构。

本报告使用三个标签：**源码事实**表示实际读过实现或接口；**上游声明**表示来自上游文档但未运行验证；**DeepCode 建议**表示本轮的架构判断，不冒充上游现状。源码事实也不能替代动态验证。

## 2. 基线变化与规模

按该 commit 的文件路径统计，`packages/*/*/package.json` 有 **382** 个，`packages/client/*/package.json` 有 **74** 个，`apps/*/package.json` 有 **6** 个，`vendor/*/package.json` 有 **9** 个。这些是目录计数，不是模型工具数、独立运行服务数或必须复制的目标包数。

相对旧调研基线，至少应刷新以下认知：

| 方面     | 本次核实的上游状态                                                             | 对 DeepCode 的影响                                                                   |
| -------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| 执行环境 | 根 manifest 要求 Node `>=24.9.0`，pnpm `11.28.5`                               | 当前 Node 22 / pnpm 9 不能直接承诺安装运行整个上游栈；依赖引入必须先做版本与打包验证 |
| 桌面     | Electron 壳 + 私有 Desktop Host + 共用 Web 应用                                | 全插件架构不要求 DeepCode 放弃 Tauri；复用宿主/客户端边界即可                        |
| 启动组合 | `web`、`headless`、`sdk`、`sdk-minimal`、`acp` profile；桌面另有受管理 profile | CLI、桌面、IDE 应有显式组合，而非各自构建服务                                        |
| 会话     | 当前逻辑格式 `SESSION_FORMAT_VERSION = 4`                                      | 不能把旧调研的日志格式直接当作导入兼容契约                                           |
| 前后端   | host/client 双入口包 + Typert Remote + WebSocket stream mux                    | 可学习边界与契约生成纪律；替换 DeepCode JSON-RPC 必须单独论证                        |
| 基础框架 | vendored、改过的 `@deepseek-ai/cordis`                                         | 不能用普通 npm `cordis` 的名字替代对具体版本与补丁的评估                             |

证据：[根 package.json][u-package]、[vendor 修改清单][u-vendor]、[Session 类型][u-session-types]、[Desktop Host][u-desktop-host]、[profile 组合器][u-profile]。

## 3. 插件不是工具包，而是服务与资源的所有者

### 3.1 Context、Service、Fiber

**源码事实**：`vendor/cordis/src/context.ts` 的 `Context` 是带服务解析代理的容器。`extend()` 创建子上下文，`isolate(name)` 为指定服务创建新的解析域，`intercept()` 叠加服务元数据。`isolate()` 隔离的是服务寻址，不是操作系统权限或进程内存。

`Fiber` 是插件实例的生命周期所有者，包含 `PENDING → LOADING → ACTIVE` 及失败、卸载、销毁状态；`ctx.effect()` 记录清理函数，按反向注册顺序执行并等待异步清理。服务与事件注册挂在该生命周期上。上游 vendor 清单 V6 专门记录了异步初始化、重入卸载、未完成清理等加固，说明“拿一个 disposer 数组”不能自然获得同样保证。[Context][u-context]、[Fiber][u-fiber]、[vendor 修改清单][u-vendor]。

**DeepCode 建议**：把可替换服务、类型化事件、作用域与资源所有权作为同一个迁移单元。至少建立 root/application、workspace、thread、turn、plugin instance 的所有权关系；不能只把 `RuntimeHost` 构造器参数搬进一个全局 map。是否直接依赖固定版本 `@deepseek-ai/cordis`，要用最小组合原型证明 Node 22、TypeScript、Tauri sidecar 和卸载语义后确定，不能默认与上游普通 Cordis 包等价。

### 3.2 激活取决于依赖，而非数组位置

**源码事实**：`Service`/插件声明 `inject`，注册表按服务可用性激活插件；`base/cordis.patch.yml` 明确说明行顺序不构成加载顺序。`ToolsService` 注入 `systemPrompt`，`AgentLoop` 提供具体驱动，`AgentRegistry` 提供独立的 live registry/factory 委托。未挂载 agent-loop 时，registry 的工厂创建会报错，而不是退回隐式默认 loop。[基础组合][u-base]、[ToolsService][u-tools]、[AgentRegistry][u-agent]、[AgentLoop][u-agent-loop]。

**DeepCode 建议**：依赖声明要能区分 required/optional、启动失败/等待依赖、禁用/不可用。诊断应直接给出“哪个插件缺哪个服务”。切换 provider、移除 MCP 或重载配置不能留下仍指向已卸载服务的执行句柄。

### 3.3 Profile / Bundle / Patch

**源码事实**：`app-boot/src/profile.ts` 管理 `$DSH_HOME/profiles/<name>` 下的 profile manifest、依赖及 `cordis.patch.yml`；`dsh.profile.bundles` 决定组合包顺序，`dsh.bundle.patch` 指向一个或多个配置 patch。配置从空树开始叠加 bundle、profile patch 与启动 overlay；home patch 由启动层参与组合。patch 按 id 定位，替换整份 config，**不是任意深合并**。`sdk-minimal` 独立组合，不继承 base。[profile][u-profile]、[app-boot][u-boot]、[base][u-base]、[Web bundle][u-web-bundle]。

**DeepCode 建议**：把产品 profile、运行权限 profile、agent preset 分成三个术语，避免同名混淆。新组合配置应有 schema、来源追踪、脱敏后的有效配置查看、变更预览与错误定位。当前 `.deepcode` 设置的优先级、工具权限、MCP 和 hooks 需要适配，不应让用户一次性重写所有配置。

上游 YAML 支持 `!!js` 表达式，这是可信代码配置能力。DeepCode 不应默认把项目中的配置升级为任意 JS 执行入口；表达式兼容与项目配置是否可信必须分开决定。

## 4. Agent / Session / Turn 的实际职责

### 4.1 注册、创建和驱动分开

**源码事实**：`AgentRegistry` 对外提供 agent 身份、live registry 与创建/恢复入口，`AgentFactory` 承担具体创建，默认 `AgentLoop` 创建 `ReactLoopAgent`。`CreateAgentOptions.setup` 在未发布的 agent scope 内组合贡献；先进入 SessionStore 并完成 session 创建，再执行 setup，最后发布 agent。初始化失败会收回未发布资源，但已经提交的 session 事实不被假装抹除。接口注释明确 setup 是 **trusted same-process code**，不是运行时安全边界。[AgentRegistry / AgentFactory][u-agent]、[AgentLoop][u-agent-loop]。

`FactoryOwnership` 在卸载时停止接收工作、中止创建信号、等待活跃 agent teardown 和启动任务。`ReactLoopAgent` 将一个用户 turn 与一次模型 step 分开：持久 `turn/start`/`turn/end` 包围多个 step；inbox 领取、`agent/pre-step` 准入、准备模型调用、工具批次执行与收尾构成驱动链。[FactoryOwnership][u-agent-loop]、[ReactLoopAgent][u-react-agent]。

**DeepCode 建议**：保留现有 Thread/Turn/Item 对外语言，内部提供 `AgentDriver`/`AgentFactory` seam；默认驱动插件重用现有行为。不能为对齐上游把客户端 thread 改名为 session，或引入第二套不相干的 turn id。

### 4.2 模型输入必须可由日志重建

**源码事实**：Session 是 append-only 内存事件日志，`Session.deriveMessages()` 负责模型历史投影；`SessionEventMap` 可扩展。日志不仅有 user/assistant/tool，还包含 `request/header`、`request/context`、system prompt 变化等。`ReactLoopAgent.prepareRequest()` 先获得注册绑定的 `prepareCall()`，再根据该调用能力协调输入；请求被冻结后才流式发出。`llm/stream` 对 loop 构造的请求只读，不能偷偷注入无法回放的消息。[Session][u-session]、[SessionEventMap][u-session-types]、[prepareRequest][u-react-agent]、[LlmRuntime][u-llm]。

**上游声明与源码接口一致**：完成的 assistant stream 嵌入 `assistant/message`，失败/重试/取消 attempt 可记录为 `assistant/attempt`；`agent/assistant-stream` 的实时 chunk 是进程内瞬态事件。进程在 settlement 之前硬崩溃时，不保证保留尚未提交的 attempt stream。[架构说明][u-architecture]、[assistant-stream 实现][u-assistant-stream]。

**DeepCode 建议**：保留 canonical thread rollout，但补齐“请求由哪些已记录输入、prompt 贡献、工具集和 provider capabilities 生成”的投影契约。客户端的流式展示、审计事实、模型上下文三者需要明确边界。重放应能复核请求形状，不能承诺重新请求模型得到相同自然语言输出。

### 4.3 三种事件域不能混用

| 域                | 上游实例                                     | 应用含义                                           |
| ----------------- | -------------------------------------------- | -------------------------------------------------- |
| 持久事实          | `session/event`、`turn/start`、`tool/result` | 恢复、审计、模型历史、客户端状态投影               |
| 活跃 agent 扩展点 | `agent/pre-step`、`agent/turn-stopping`      | 输入准入、循环控制、续跑；并非每个 hook 都直接落盘 |
| 能力扩展点        | `tools/pre-execute`、`fs/*`、`llm/stream`    | 在能力边界施加策略、适配和观测                     |

waterfall 允许调用 `next()` 委托，serial 要等待前序完成，emit 是通知；这三者错误处理和可否阻止提交不同。DeepCode 不能使用一个通用 EventEmitter 让监听器顺序偶然决定审批或落盘结果。[架构说明][u-architecture]、[Session 事件声明][u-session]、[工具流水线][u-pipeline]。

## 5. 工具、provider 与安全约束

### 5.1 统一工具流水线与单调 guard

**源码事实**：`ToolsService` 负责 scoped tool 注册、step-time admitted tool set、executor 选择和 guard。`ToolExecutionPipeline.prepare()` 顺序为：快照输入 → 取消检查 → `tools/pre-execute` → 必要时 approval → monotonic guards → 执行前取消检查。之后执行、后置转换、结果正规化、内容 finalizer 与不可变结果通知按公共流水线收口。PTC 子调用也被纳入流水线，而不是直接访问工具函数。[ToolsService][u-tools]、[ToolExecutionPipeline][u-pipeline]、[流程说明][u-tool-flow]。

两个重要限制：

1. 源码里 `tools/pre-execute` 无监听器时的 fallback 是 `allow`；guard 也是注册的贡献。单靠“采用同样插件架构”不能推出安全默认值。
2. Cordis 插件与宿主同进程时仍可直接导入 Node API。工具门禁只保护经过门禁的能力调用，不隔离恶意同进程代码。

**DeepCode 建议**：保留已有不可绕过的中央政策，并把它明确表达为组装准入约束和执行 broker。正常产品 profile 必须证明 policy、approval、sandbox、credential boundary、审计贡献都存在，删除或替换关键服务必须在新工作准入前拒绝。可扩展 hook 可以收紧策略，不能清除 hard deny。第三方插件继续走受限 subprocess/capability RPC；可信第一方插件才在宿主内挂载。安全属性可由插件实现，但其存在与边界不能变成可选的 host 参数。

### 5.2 Provider 是能力注册，不是 loop 分支

**源码事实**：`LlmRuntime` 是 adapter registry。`PreparedLlmCall` 捕获 provider 注册、调用配置、重试策略、模型上下文、输入 modality、system/tool update 能力；loop 使用该已绑定调用，避免准备请求和发出请求期间模型注册变化造成错配。DeepSeek adapter 是独立 `llm-deepseek` 包。[LlmRuntime][u-llm]、[DeepSeek adapter 入口][u-deepseek]。

**DeepCode 建议**：现有 DeepSeek/多模型支持应迁移成 provider 插件，保留 pricing、cache token 计价与 capability gates；当前模型不能支持的图片、effort、工具更新或 reasoning 行为应由能力契约明说，不能宣称换上 Harness 包就获得完全一致能力。

### 5.3 执行环境是完整世界

**上游声明**：能力 seam 由接口、provider、consumer 三种角色组成；文件系统与进程 provider 要处于同一个执行世界，远程化才能同时覆盖 Bash、PTY 和 LSP。[架构说明][u-architecture]。

**DeepCode 建议**：为 fs、process、network、terminal、worktree 提供一致的 workspace/路径语义；远程执行是后续 provider，不应先让 Bash 远程而 Read/Edit 仍默默落在本机。逻辑上要分角色，不要求每个角色都拆成一个 npm 包。

## 6. 持久化不是把所有事件写进一个文件

**源码事实**：`SessionPersistence` 是独立 service definition，暴露 `create/open/stat/list/export` 与每会话 `SessionHandle`；write handle 原子取得单 writer ownership，read handle 不取得写权。`append` 与 `flush` 的 durability 语义分开，后者才是等待持久化完成的屏障。[SessionPersistence][u-persistence]。

JSONL provider 独立拥有 framing、压缩、lease、generation 选择和发布。当前格式迁移先 decode 与校验，读模式只做内存映射，写模式在旧 generation 旁排他发布新 generation；已提交历史 generation 不重命名、不替换、不删除。`generation.ts` 显式处理源文件在迁移期间变化、目标版本路径冲突与最终文件校验。[generation][u-generation]、[JSONL provider][u-jsonl]。

**DeepCode 建议**：保留 legacy 双读单写和原文件只读，保持现有 thread store 的协议事实源身份。新插件事件必须有 schema、版本、已缺失插件时的保留规则；不能让卸载插件导致历史日志无法读取。迁移会话时应生成可校验新文件与迁移报告，回滚切回原 reader；不在老文件原地改写，也不假装能恢复老版本从未记录的模型输入。

上游 v4 是其内部数据格式，不是 DeepCode 必须采用的格式。若后续需要导入 dsh session，应成为独立只读导入 adapter，固定支持版本、记录来源、拒绝未来格式、保留原数据；不得把该能力混入本次架构迁移的默认承诺。

## 7. Host / Client / Desktop 的插件化

**源码事实**：`api/gateway` 把 Cordis 服务和注册 provider 暴露为 Typert Remote；单次调用由 Connection 承载，流使用 Gateway 管理的 WebSocket mux。`SessionController` 在 host 持有 session 读取与 live control，调用 `remoteAccess` 做资源过滤。[Gateway][u-gateway]、[SessionController][u-controller]。

`client/modules` 的 Node half 扫描声明 `dsh.client` 的包，构建 `window.__DSH_BOOT__` 图并提供客户端 bundle。浏览器使用独立入口与模块图，功能 UI 按客户端贡献装配；不是把 host 的 Context 直接序列化到浏览器。[ClientModuleRegistry][u-modules]、[Web entry][u-web-entry]。

`apps/desktop-host/src/index.ts` 接收私有认证信息后，调用共享 CLI `runProfile()`，以 `127.0.0.1` 和端口 `0` 启动 desktop profile；Node IPC 传递启动、就绪和关闭等壳控制信息。Web entry 等待 desktop boot 注入并接到 Host。[Desktop Host][u-desktop-host]、[Web entry][u-web-entry]。

**DeepCode 建议**：延续 app-server 与 Tauri sidecar 的可信后端，renderer/webview 只收到可公开的插件目录、能力、事件和 UI 贡献。保留现有 JSON-RPC 的稳定方法；增加插件发现、状态、配置诊断等 capability 时采用协议版本协商。不能把“所有服务都可替换”解释为“所有方法都可远程调用”。前端 registry 应覆盖 timeline item renderer、tool presentation、panel、settings、command，最终由 CLI/desktop/IDE 各自选择可消费贡献。

### 7.1 UI slot 与三类协议面

**源码事实**：`client/ui-slots` 提供 single/list/keyed/chain/hoc 等类型化槽位及 root/session scope；这使前端不只是呈现后端工具结果，而能用同一生命周期组成完整应用。`script-realm-iframe` 明确使用 same-origin iframe、共享普通引用：它隔离全局环境，不能隔离恶意第三方代码。[UI slots][u-ui-slots]、[iframe realm][u-iframe]。

Web 的 Typert Remote、`HarnessSdkJsonRpcServer` 的 subprocess JSON-RPC、ACP automation bridge 是三个适配面。SDK 的 `resolveDshBinFromManifests()` 要求 SDK 与 dsh 同版本，不能把“都是JSON”理解为任意客户端可互换。[SDK server][u-sdk-server]、[SDK launcher][u-sdk-launch]、[ACP][u-acp]。

**DeepCode 建议**：保留现有protocol，另做能力协商/版本adapter；Web与Tauri复用客户端图，第三方任意JS UI需独立安全边界。SDK引擎内部prompt和压缩不一定可观察，不能将native请求重建保证扩展到外部loop。

### 7.2 插件安装与外部服务

**源码事实**：上游 plugin manager 的工具入口对每个action使用既有full-access授权或`approveEscalation`，并区分 applied/cancelled/restart-required 等状态。批准安装host插件意味着执行可信宿主代码；配置中的build授权不是本地workspace sandbox。MCP manager管理连接与重连生命周期；subagent activation使用root tree容量和精确epoch区分运行实例。[Plugin manager tools][u-plugin-tools]、[MCP manager][u-mcp-manager]、[Subagent activation][u-subagent-activation]。

**DeepCode 建议**：插件安装、构建、激活分阶段；授权绑定实际hash/权限集合。MCP准入仍进工具管线，但远端服务内部副作用不受本地file contract和OS sandbox约束。必须单独描述本地stdio与远端transport的保证；取消连接不能证明远端操作停止。

## 8. DeepCode 已经吸收了哪些能力

当前主分支已经有上一轮采纳的实现，不能再将它们作为新缺项：

| 能力                  | 当前源码入口                                                                             | 本轮工作                                                             |
| --------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| repeat/deadline guard | [`guard/`](../../packages/core/src/guard/)                                               | 从 loop/dispatcher 内嵌逻辑迁移为有 scope 的策略贡献，保留已验证语义 |
| 持久 shell            | [`tools/shell.ts`](../../packages/core/src/tools/shell.ts)                               | 纳入 process/terminal 生命周期与统一取消，保持现有命令兼容           |
| session 检索          | [`tools/session-search.ts`](../../packages/core/src/tools/session-search.ts)             | 抽成查询服务 + 工具，继续落实 workspace 授权                         |
| 工具 presentation     | [`tools/presentation.ts`](../../packages/core/src/tools/presentation.ts)                 | 成为 registry 贡献并供多客户端消费                                   |
| 多模型配置            | [`providers/configured.ts`](../../packages/core/src/providers/configured.ts)             | 迁移 adapter 注册、模型能力、凭据引用，保留用户配置                  |
| RuntimeHost 安全组装  | [`runtime/host.ts`](../../packages/core/src/runtime/host.ts)                             | 转成统一启动/兼容 facade；安全不退回每个客户端手工选择               |
| 第三方插件执行边界    | [`plugins/runtime/subprocess.ts`](../../packages/core/src/plugins/runtime/subprocess.ts) | 保留信任边界，新增插件生命周期不等于放开同进程执行                   |

这张表仅列本报告直接定位的入口，完整迁移清单由主改造方案维护。第一轮的 spill、重复调用护栏、逐工具超时、持久 shell、session 检索和工具展示等已交付能力应保留，不能随着重新组装被删除再重做。模型无关的历史结果剪枝尚未实现，由主方案 H05 完成。

## 9. 采用、调整、暂不直接复用

| 结论           | 内容                                                | 理由                                                                     |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| 采用           | 内部能力也是插件；显式依赖、scope、effect ownership | 解决现有运行时组装耦合，而不仅增加外部扩展入口                           |
| 采用           | Profile / Bundle / Patch 与可检查有效配置           | 将“产品是什么”变成可审核、可测试的组合                                   |
| 采用           | loop / registry / session / projection 分工         | 可替换驱动，同时保留 durable state 和客户端协议                          |
| 采用           | provider 绑定调用、模型能力与请求重建               | 防止热切换、重试和上下文注入造成隐式错配                                 |
| 采用           | 公共工具流水线、单调 guard、不可变结果              | 扩展不会绕过权限或使观察到的结果与模型所见不一致                         |
| 调整           | 无特权产品内核                                      | 保留不可被产品配置删掉的组合准入与安全约束；不是任意第三方代码与宿主同权 |
| 调整           | UI 双入口与远程契约                                 | 沿用现有 Tauri/JSON-RPC，分阶段增加前端贡献；暂不为框架迁移重写壳与协议  |
| 调整           | seam 的三个角色                                     | 逻辑分离；按实际依赖和独立发布需要拆包，不以 382 个包为完成指标          |
| 不直接复用     | 上游整个仓库作为产品运行依赖                        | Node/构建/版本/原生模块/发布范围差异大，且是快速变化的 preview           |
| 不默认开放     | `!!js` 配置与任意热卸载                             | 项目配置执行与活跃 turn 资源重载需更严格边界                             |
| 不作为本轮必达 | 上游所有实验插件、云服务、账户系统                  | 架构同构不等于复制上游所有实验产品能力；需独立定义用户收益与验收         |

## 10. 实现前必须由原型回答的问题

以下问题不能由静态源码阅读代替实测，但主方案应给出负责阶段与失败后的替代路径：

1. 固定版本 Cordis runtime/loader 在 Node 22 与现有 TypeScript、sidecar 打包中是否工作；若不工作，是小范围适配、单独版本迁移还是延后依赖选择。
2. 同 scope 重复注册、缺失 required service、依赖消失、setup 中途取消、并发 dispose、cleanup 抛错时，资源是否全部收回且无后续写入。
3. profile patch 删除关键政策服务时是否在接收任务前拒绝；第三方 subprocess 插件能否伪造 contribution、跨 scope 调用或接触凭据。
4. 现有 thread rollout 经 adapter 后，输入、工具事件、approval、resume/fork、CLI JSONL 是否保持兼容；缺失插件与未知事件是否仍可安全读取。
5. CLI、桌面与至少一个 IDE 客户端是否使用同一组合语义；在无系统 Node 的安装机上，sidecar、插件加载与退出是否成立。
6. UI 插件崩溃、缺失、版本不兼容时能否局部降级；renderer bundle 是否仍无法触及 host credential/process/fs API。

本报告没有上游运行结果，因此这些是实施验收要求，不是已完成状态。上游 [SAFETY][u-safety] 也声明仍是未经安全审计的 developer preview；引用它的架构不构成 DeepCode 安全或生产成熟度的证明。

[u-package]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/package.json
[u-vendor]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/vendor/README.md
[u-context]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/vendor/cordis/src/context.ts
[u-fiber]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/vendor/cordis/src/fiber.ts
[u-profile]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/boot/app-boot/src/profile.ts
[u-boot]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/boot/app-boot/src/index.ts
[u-base]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/bundle/base/cordis.patch.yml
[u-web-bundle]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/bundle/web-app/cordis.patch.yml
[u-agent]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/agent/src/index.ts
[u-agent-loop]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/agent-loop/src/index.ts
[u-react-agent]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/agent-loop/src/agent.ts
[u-session]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/session/src/index.ts
[u-session-types]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/session/src/types.ts
[u-assistant-stream]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/agent-loop/src/assistant-stream.ts
[u-tools]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/tools/src/index.ts
[u-pipeline]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/core/tools/src/pipeline.ts
[u-tool-flow]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/tool-execution-pipeline.zh.md
[u-llm]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/llm/llm/src/index.ts
[u-deepseek]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/llm/llm-deepseek/src/index.ts
[u-persistence]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/session/session-persistence/src/index.ts
[u-generation]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/session/session-persistence-jsonl/src/generation.ts
[u-jsonl]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/session/session-persistence-jsonl/src/index.ts
[u-gateway]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/api/gateway/src/index.ts
[u-controller]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/api/session-controller/src/index.ts
[u-modules]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/modules/src/index.ts
[u-web-entry]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/apps/web/src/main.ts
[u-desktop-host]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/apps/desktop-host/src/index.ts
[u-architecture]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/docs/architecture.zh.md
[u-safety]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/SAFETY.zh.md
[u-ui-slots]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/ui-slots/src/index.ts
[u-iframe]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/client/script-realm-iframe/src/client/iframe.ts
[u-sdk-server]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/sdk/server/src/server.ts
[u-sdk-launch]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/sdk/client/src/launch.ts
[u-acp]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/acp/acp/src/index.ts
[u-plugin-tools]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/boot/plugin-manager/src/tools.ts
[u-mcp-manager]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/mcp/mcp-manager/src/index.ts
[u-subagent-activation]: https://github.com/deepseek-ai/deepseek-harness/blob/39163dd30f703a79079e2d2446545cff3c453738/packages/subagent/subagent/src/activation.ts
