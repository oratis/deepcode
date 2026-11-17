# Harness runtime v2：组合、执行与迁移契约

> 状态：目标架构契约；H01 统一执行、H02 kernel 原型及 H03/H04 bootstrap/journal 基线已实现，具体边界见 [实施进度](../HARNESS_IMPLEMENTATION_PROGRESS.md)。其余契约仍待实现；与 [完整改造方案](../HARNESS_TRANSFORMATION_PLAN.md) 和 [ADR 0003](../adr/0003-plugin-composed-harness.md) 共同约束后续实施。
>
> 基线：DeepCode `3421a3c`；上游 `39163dd3`；2026-11-17。
>
> 本文的 TypeScript、JSON、包路径和方法名是拟定契约；不得当作现有 SDK 使用。

## 1. 两类插件与一个安全根

**Runtime plugin**：随 DeepCode 构建、审阅并固定版本的第一方代码，运行在可信 host 的 Cordis Context 中，可提供 agent loop、provider、session、工具等服务。它属于可信计算基础；进程内 JavaScript 能 import fs/process，不能仅靠类型或隐藏 ctx 字段宣称隔离。

**Extension plugin**：外部安装的第三方贡献。默认提供声明式 skills、commands、MCP、UI card；需要执行代码时运行在受 OS sandbox 约束的独立进程中，通过 capability RPC 申请副作用。外部包不能导出任意 Cordis host service 并直接挂进可信 Context。高级开发者若运行自己的 host fork，属于独立信任/发行模式，不沿用默认安全保证。

**Root services**：bootstrap 持有 policy enforcement、credential broker、resource supervisor、journal commit 授权及可信实现清单。实现可以采用内部 Cordis plugin，但用户 patch、extension、model output 无权卸载或替换。每个 execution profile 启动时验证这些服务的实际 owner/version，缺失则失败。

## 2. 注册、依赖与资源所有权

### 2.1 生命周期

```text
discovered -> validated -> waiting-dependencies -> activating -> active
                                  |                 |           |
                                  +---------> failed <----------+
                                                    |           |
                          explicit retry/update <---+     quiescing
                                                               |
                                                            disposed
```

- `activate` 完成前 contributions 不对消费者可见；失败撤销已创建的资源和注册。
- 注册返回拥有 ownerId/generation/scope 的 disposal handle。禁止插件借别人的 handle 卸载服务。
- 单实现服务重复注册是错误；多实现 registry 使用稳定 contribution id 与明确优先级，禁止隐式“最后一个赢”。
- 服务缺失时有界等待，启动期限后给出依赖链诊断；循环依赖在 admission 阶段拒绝。
- 先关闭依赖消费者并 drain，再撤销 provider；失败服务只能通过显式 retry/update 恢复，不能静默落到权限更宽的 provider。
- 本设计契约通过 Cordis adapter 实现并测试，不假定上游全部 API 正好具有所需安全语义。

### 2.2 Scope

| Scope          | 所有者                       | 典型资源                                    | 结束条件                                          |
| -------------- | ---------------------------- | ------------------------------------------- | ------------------------------------------------- |
| app            | bootstrap                    | profile graph、transport、credential broker | 停止新请求并排空全部子 scope                      |
| workspace      | canonical workspace identity | 配置视图、MCP连接池、索引、contract         | 最后一个消费者退出或显式关闭                      |
| session        | thread/session writer        | inbox、context、shell registry、任务关系    | archive/close/reload要求；脱离任务先转交明确owner |
| turn           | 一个用户请求                 | provider请求、审批、默认子agent、tool批次   | 请求及子副作用完成/失败/取消                      |
| invocation/job | 调用或显式后台任务           | deadline、process group、stream cursor      | drain后终态；不是仅UI隐藏                         |

MCP 连接可在 workspace 复用，工具可见性和授权仍按 session/turn 裁剪。后台 shell 是 session/job 资源；某个 turn 结束不必杀死空闲 shell，但其正在执行的命令默认受该 turn 的取消约束。只有显式后台转交产生新的 owner、记录和用户可见 job；不能把任意任务从取消树中偷偷移走。

每个 runtime generation 持有不可变配置和插件版本集合。active turn 固定 generation；配置变化创建候选图，验证后在安全边界切换。紧急撤销权限优先于固定 generation：立即撤销 grant 并停止相关执行，不能让旧 shell 继续享有已撤销权限。

### 2.3 取消屏障

`interrupt` 顺序：关闭 turn 入队 → 撤销 capability grants → abort provider/摘要/hooks/交互等待 → cancel子任务与命令 → 有界排空与进程回收 → 提交 terminal event → 响应客户端。

发出取消时立即启动独立监督计时器，使有界drain与进程组SIGTERM→SIGKILL升级并行；不能等待挂起工具返回后才启动强杀。到期仍未排空则隔离该owner，停止受影响host接收新工作；必要时终止整个受影响host。无法证明停止时报告cleanup_incomplete，不开放该会话继续执行。

为每次运行分配 `runEpoch`；晚到 callback/approval/output 使用旧 epoch 时拒绝。进程回收失败返回 `failed/cleanup_incomplete`，附资源诊断，不能报告 completed。已经提交到 OS 的写入不能撤回，需保留 unknown/partial 说明；禁止在宣布中断后启动新业务写入。

## 3. 服务契约

以下是跨包边界的最低要求；实现 PR 再生成具体 schema/type。

| 服务                      | 必需接口                                                  | 不负责什么                             |
| ------------------------- | --------------------------------------------------------- | -------------------------------------- |
| AppBootstrap              | resolveProfile、validateGraph、start、shutdown、inspect   | 不持有客户端UI状态                     |
| AgentRegistry             | create/resume/get、owned handle、inbox、interrupt         | 不硬编码模型或工具                     |
| AgentEngineRegistry       | register engine descriptor、create driver                 | 不将SDK loop嵌套进native loop          |
| ProviderRegistry          | resolve selection、capabilities、prepareCall              | 不由renderer读取key                    |
| ContextService            | assemble、checkpoint、derive、prune、compact              | 不删除journal事实                      |
| ToolRegistry              | register scoped contribution、resolve admitted set        | 不直接提供免审批执行入口               |
| ToolExecutionService      | execute/executeBatch、cancel/drain                        | 不允许调用者传一个可关闭安全的布尔值   |
| SessionRepository         | detect/open/read/append/flush/fork、lease、migrate        | 不把UI snapshot作为唯一事实源          |
| JobService                | create/claim/cancel/finish/list、owner/epoch/dependencies | 不把活进程序列化成“可恢复进程”         |
| ExtensionHost             | inspect/install/activate/revoke/dispose                   | 不授予任意host代码权限                 |
| ClientContributionService | typed slots、commands、renderers、settings schema         | 不执行任意后端handler或接触credentials |

拟定 engine descriptor 至少包括 `engineId/version`、provider需求、resume/fork/steer/compact/subagent/tool-bridge能力、private session格式。当前 native/claude-sdk 标识保持；backend=`legacy|harness-v2` 与 engine 字段正交。

一个 turn 只能有一个驱动 provider/tool循环的 engine。SDK engine 保留其私有 context、resume token和压缩；公共 timeline只是投影，不伪造 native history。模型/engine不支持某操作时，在启动前拒绝并返回能力原因。

## 4. 唯一工具执行管线

### 4.1 调用范围

native loop、Claude SDK受控MCP桥、普通MCP serve、第三方extension capability RPC、hook派生调用、workflow、subagent和用户发起的工具动作，均只能通过同一个 `ToolExecutionService` 进入副作用。registry lookup不能返回可被普通消费者直接调用的裸handler。

本地stdio MCP进程与extension一样需要sandbox、env allowlist和进程owner。远端MCP只能在DeepCode侧约束endpoint、credential scope、tool准入、参数和调用预算；远端服务内部的文件/网络副作用不受本地OS sandbox或file contract强制约束。其工具effects必须声明并经信任校验，未知效果默认ask/deny；read-only profile不能仅凭工具自报readOnly就允许远端写能力。连接中断不等于远端操作已取消，状态未知须如实显示。

```text
request + caller identity + session/turn + generation
  -> validate schema / limits / admitted tool set / cancellation
  -> snapshot args + tool identity + requested effects
  -> scope/permission/file-contract/sandbox preflight
  -> trusted hooks may restrict or request approval
  -> bind approval to immutable invocation identity
  -> recheck policy + canonical paths after awaits
  -> snapshot/checkpoint + durable execution intent
  -> root broker issues bounded effect grants
  -> executor runs with abort/deadline/process ownership
  -> drain + collect actual effect/outcome
  -> redact / bounded output / spill / post hooks
  -> journal settlement + ledger linkage + client projection
```

如果 hook 修改参数，重新进入 schema/policy/approval流程，不能沿用旧授权。普通 hook只能收紧决定；deny优先。未知tool/capability、缺审批端、未知政策状态和不支持sandbox均 fail closed。用户明确选择的 full-access 仍按仓库既有产品策略处理并记录，不能被插件配置或错误恢复隐式选择。

### 4.2 Effect capability

拟定 grant 由 host 内部生成，不接受插件序列化的 `approved: true`：

```ts
interface InvocationIdentity {
  callId: string;
  sessionId: string;
  turnId: string;
  runEpoch: number;
  generation: string;
  toolId: string;
  argsHash: string;
}

interface EffectGrantDescription {
  invocation: InvocationIdentity;
  effects: Array<'fs.read' | 'fs.write' | 'process.spawn' | 'net.request'>;
  expiresAt: string;
  policyRevision: string;
}
```

以上仅是可审计描述，不是可伪造的授权本体。broker通过隔离通道关联实际caller、单次token、scope及revocation；拒绝跨plugin/session重放。审批绑定参数、路径/域、版本和权限差异，权限变更或epoch变化后失效。

权限层级：根用户授权 ∩ workspace contract ∩ session模式 ∩ 子agent限制 ∩ plugin声明/已批准grant。write/file与process/network能力分开；filesystem realpath预检不能消除所有并发TOCTOU，写路径使用可行的OS/descriptor约束并保留已知限制。shell内容无法靠AST或文件contract完美约束，仍依靠OS sandbox和真实效果审计。

插件进程只继承 allowlist 环境（必要PATH、locale、受控HOME/TMP等），secret通过明确 broker引用解析。SDK/helper/provider也需分别列出环境策略，不用不断增加厂商key黑名单。

### 4.3 并发、输出和崩溃

只读调用可以在有界并发下执行；同路径写入、共享shell和review restore串行或持资源锁，不能只靠工具名字猜无副作用。批次工具结果按调用id结算，失败批次补齐必要结果，未知执行保持 unknown。

spill在session资源域中存全文，默认有大小/保留预算与受控检索；model result与UI artifact引用分开。PostToolUse失败不抹掉已发生的工具副作用。ledger与journal通过callId关联；关键审计无法提交时停止后续副作用并报告部分结果，不能声称事务回滚工具。

## 5. Session v2 与上下文

### 5.1 日志和投影

新存储逻辑版本称 DeepCode session-v2，**不等于上游 session-v4**，也不自动改变公开 protocolVersion。

```ts
interface JournalEnvelope {
  schemaVersion: 2;
  seq: number;
  eventId: string;
  sessionId: string;
  turnId?: string;
  stepId?: string;
  callId?: string;
  runEpoch: number;
  timestamp: string;
  type: string;
  payloadVersion: number;
  payload: unknown; // 持久化前由type对应schema验证
}
```

durable事件：session创建/lineage、用户输入入队和接收、turn/step起止、模型选择、request快照引用、assistant完整message或失败attempt、工具intent/result、审批请求/结论、context checkpoint、job状态、review动作和artifact引用。

transient事件：token delta、未结算progress、短期连接状态；重连不靠它们恢复事实。不得把 raw reasoning/secret 默认加入公共DTO。provider需要的私有continuation可存受保护的私有记录，其公开投影脱敏。

四种纯投影：model history、Thread/Turn/Item、任务/资源视图、检索/诊断索引。每个projection记录版本和cursor，checkpoint可删重建；append-only日志为唯一新会话事实源。未知插件事件通过通用envelope保留；需要未知语义才能续跑时拒绝恢复，不能忽略后继续执行。

### 5.2 请求可重建

native engine的每个step在provider调用前固化 `engine/provider/model/effort`、能力版本、profile generation、prompt sections、admitted tool schema、journal范围、context checkpoint、附件引用和有效参数。native模型可见的新输入必须有对应事件或有来源的受保护artifact。

SDK等外部loop仅承诺记录host可观察的输入、工具桥事件、有效配置、engine版本/绑定及受保护私有session引用；内部prompt、压缩和逐次模型请求可能不对host公开。其capability明确标记requestReplay不支持或部分支持，不伪造完整请求快照。SDK私有恢复依赖其版本和会话接口，公共journal只重建可观察timeline。

重试复用同一请求快照，新增attempt记录；不再次入队同一用户输入或重复执行已结算工具。provider切换需新请求系列和能力核验；推理签名/continuation不跨模型回传。

compaction生成新的context checkpoint与摘要事件，**保留完整原journal**。结果剪枝仅作用model projection，保留tool call/result配对、失败诊断、用户引用和仍有效来源。server改用journal cursor投影，替换当前 `history.slice(baselineLength)`，否则不能开启自动压缩。

### 5.3 存储与writer

拟定路径为独立的 `<data>/sessions-v2/<id>/`，包含versioned journal generation、manifest、artifacts及可重建indexes。目录0700、私有文件0600；新data root不得让旧程序误读为v1。

先使用Node22可支持的无压缩JSONL，避免将Zstd/原生锁依赖带进首个迁移PR。单writer由app-server ownership和跨进程lease共同保证；不能仅靠“每条append都是原子”假设。

当前TS/Rust已有锁约定需做双进程/崩溃测试。H04必须选定并证明host单writer+可靠lease实现：不能仅凭TTL抢走活writer；锁所有者无法确认时拒绝写打开。若需要OS flock/named mutex helper，由独立打包spike提供，发布前验证。跨进程排他未证明前，不开放面向用户数据的可持久化v2 profile，仅允许每次独立临时目录的spike；“约定只有一个host”不能代替互斥。

关键边界flush后才对客户端确认durable：用户请求接收、工具intent（副作用之前）、工具结果、审批结论、turn终态。明确append/flush/OS耐久性的差别；不承诺断电绝不丢数据。崩溃后只允许修复未提交尾记录；中段损坏隔离并提供诊断，不能悄悄跳过。

### 5.4 迁移算法

1. detect源格式/engine/version，取得可验证的冻结只读快照与源hash；使用源writer协议的读屏障或先停止源writer。不能取得一致快照时拒绝导入，未来版本/SDK绑定异常也拒绝。
2. 归一化现有meta/messages/items；未保存的审批/工具过程标缺失，不虚构历史。
3. 构造独立目标generation，记录sourceId/hash/version和lineage；引用资源先核验权限。
4. 校验序号、引用、tool配对、engine binding、projection输出及全部资源。
5. 写入并flush不可读取/不可续跑的staged manifest，在源屏障仍有效时完成最终hash和一致性校验。若源变化则拒绝激活并重新导入，不能让reader看到未验证的候选。
6. 独占、原子发布committed manifest，作为唯一可见提交点，再释放源屏障并显示成功。冲突时比较来源，不能覆盖已有writer。后续源续写不自动流入目标，需新导入候选或用户显式切换。

旧文件永远不修改。导入操作幂等，但源后续变化产生新的导入候选；失败临时数据有明确清理范围。archive/delete/retention由host管理，不等于插件dispose；资源被fork引用时不能提前GC。

## 6. Profile、配置和热更新

### 6.1 配置类型与优先级

组合profile描述bundles/plugins；模型profile描述provider/endpoint/model/credentialRef；trigger profile描述无人值守权限和预算。schema与UI分别命名，避免 `--profile` 含义冲突。

普通参数按“发行bundle默认 → 用户profile → 用户global → 已信任workspace → 显式启动参数”计算；session只允许声明可变字段。无信任project只贡献受限非执行偏好。**安全字段使用上层grant交集或显式提权流程，不服从普通覆盖规则**；credentials/engine/endpoint/安装脚本/host插件不得被仓库patch静默修改。

所有patch按稳定row id修改；一次完整config replacement与局部field merge必须在schema区分，禁止含糊的深合并。检查未知字段、重复id、依赖冲突和非法service替换；有效配置支持value-free来源诊断，密钥只显示引用是否可用。

```json
{
  "schemaVersion": 1,
  "profileId": "interactive",
  "bundles": ["@deepcode/base-coding", "@deepcode/client-cli"],
  "plugins": [{ "id": "context-pruning", "enabled": true, "config": { "preserveRecentSteps": 4 } }]
}
```

这是拟定示意，不是上游 `cordis.patch.yml` 语法或现有DeepCode配置。

### 6.2 激活事务

解析 → 校验来源/依赖/权限差异 → 构建候选graph → 预热无副作用服务 → 取得generation切换锁 → 停止新turn → 排空或显式取消受影响调用 → 原子激活 → 保存last-known-good。

不允许预热过程中执行工具、hook命令、模型请求或插件安装脚本。更新失败撤销候选，旧graph保持；不可逆外部动作不纳入“自动回滚成功”的承诺。HMR先只支持无active turn的配置更新；代码hot reload在生命周期证据通过后再启用。

### 6.3 插件安装与SDK

manifest最少包含稳定id/version、engine/SDK range、entry类型、host/client贡献、capabilities、integrity和license。source URL、安装路径和package name不决定信任。

inspect/resolve → 固定内容hash → 展示权限差异 → download/staging → 验证archive路径与依赖闭包 → 隔离构建（默认禁install scripts）→ 准备activation → 原子更新profile指针。trust绑定具体内容和权限集合；升级增加权限需要新的host-issued grant。

插件卸载先停止新admission并撤销grant，再按取消屏障有界drain/回收进程，最后移除服务/UI registration和包引用；用户数据保留并提供独立清理动作。作者SDK提供版本化schema、能力RPC、取消/超时、测试host和三种样例：声明式skill+command、隔离工具、timeline card。现有manifest兼容adapter不得赋予旧trust没有的权限。

## 7. 协议和客户端

### 7.1 稳定边界

保留 `packages/protocol` v1的方法/字段和CLI JSONL投影；内部Cordis事件不直接暴露为公共wire。新增可选能力用initialize协商；不兼容状态/方法推出v2 adapter。旧客户端读完成items snapshot；新客户端可以订阅journal-backed cursor视图。

拟定新增能力包括profile/graph inspect、model/engine capabilities、jobs、context checkpoint、extension registry和replay cursor。host只返回可展示公共DTO，禁止把Context、service实例、callback或credential反序列化到前端。

### 7.2 重连与背压

host为每个session持单调cursor和snapshot generation。建立订阅并缓冲后获取snapshot/cursor，丢弃已覆盖重复事件；gap要求重新取snapshot。client消息按eventId去重，按connection generation拒绝晚到ready。有限队列溢出后发resync-required，不能无界内存缓存。

turn/start接受clientRequestId并去重；断连不重新执行工具。owner与observer分开，observer不能答审批。审批有owner、deadline、callId和epoch；断连后的转交需显式host策略，无人接管则拒绝/取消，不自动批准。进程重启后pending审批失效，执行状态需重新确认。

### 7.3 三种carrier

- **stdio/IDE/SDK**：单连接owner，stdout仅协议，日志走stderr；启动canonical profile并检查版本范围。
- **Web**：loopback默认，随机bootstrap secret、Origin/Host/CSRF检查、WebSocket身份和请求大小限制；远端监听需单独认证/TLS配置，不自动暴露LAN。
- **Tauri**：保留bundled Node sidecar与权限最小化；优先现有受控IPC，复用同一UI图。若引入loopback则使用等价认证。校验sidecar/client/profile/assets版本，更新前排空，崩溃后保留会话状态并给重启入口。

ACP是独立automation adapter，协议能力不能映射时明确拒绝；Web RPC、SDK JSON-RPC和ACP不共用未经验证的同一消息schema。LSP继续只负责编辑器协议，不把所有服务伪装为LSP command。

### 7.4 UI contributions

typed slots按root/workspace/session声明，注册有owner和dispose。renderer根据tool/node的语义数据选择表现，缺插件/未知版本显示generic可读卡片。UI actions带schema、能力要求和明确host method映射，不能携带任意命令执行代码。

第三方JS iframe必须用独立opaque origin、严格CSP与限权postMessage通道；宿主校验source、nonce、schema和action grant，不能套用Web主RPC的Origin许可。它不继承Tauri API或凭证。这个边界未实现前只发布声明式第三方UI。

## 8. 兼容、验证与删除条件

`RuntimeHost`、旧tool export和core入口在迁移期适配新服务；所有旧调用最终仍进入broker。迁移结束只保留有真实消费者的public API facade，内部旧composition/重复executor移除。

契约测试必须包括真实profile启动、插件依赖/卸载、跨入口安全、取消竞态、两进程writer、所有legacy格式、SDK私有绑定、前端无credential、CLI golden与产物安装测试。不能只测试手工拼出的Context。

H14删除旧backend的前提：至少两个正式版本观察期、所有现有功能迁移表签收、旧入口扫描零生产使用、原始数据只读adapter仍可用、恢复/回滚说明经过演练。回滚到上一个受测native host/profile；禁止恢复renderer runtime或关闭policy来“临时兼容”。
