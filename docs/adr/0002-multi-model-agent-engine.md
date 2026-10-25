# ADR 0002：Claude Code 引擎与多模型接入审查及对齐方案

- 日期：2026-10-24（2026-10-25 提交前复审）
- 状态：已实施 P1 修复与原生多模型接入；SDK 实验引擎已实现，尚未通过真实厂商及分发验收
- 审查基线：`origin/main@cedeb85`
- 范围：模型适配、Agent 生命周期、配置与凭证、会话、权限、CLI/headless、桌面、VS Code/LSP、构建与发布门禁

## 1. 结论与决策

目标调整为：DeepCode 提供统一的编码产品与安全边界，支持 DeepSeek、Kimi、GLM 等模型，并验证复用 Claude Code Agent 引擎的可行性。

审查基线是自研 Agent，不是 Claude Code 的封装。core 依赖 OpenAI SDK，CLI 与 server 显式构造 `DeepSeekProvider`，仓库没有 Claude Agent SDK 依赖。当时的 Claude 配置兼容与工具命名不能视为已经复用 Claude Code 框架。下文发现的行号指向审查基线，实施后的代码见第 8 节。

建议保留现有 app-server、Thread/Turn/Item、客户端和数据兼容层，在可信后端引入 `AgentEngine` 接口。以 Claude Agent SDK 实验引擎验证 Kimi/GLM；原生引擎保持默认和回滚入口。通过兼容、安全与打包验收后，再决定是否将 Claude 引擎设为默认。用户选择的模型不应强制绑定某个引擎。

Claude SDK 已包含 Agent loop、工具与上下文管理，属于引擎替换；不能作为 `Provider.runTurn()` 内的模型请求适配器，否则会产生两层循环和两套工具执行权。

## 2. 最新代码与审查方法

原工作区 `docs/v0.3.0-report@04c09e8` 无未提交变更。执行 `git pull --ff-only` 后，该分支自身已最新，但与最新 main 相比有 1 个独立提交、落后 38 个提交。为保留文档分支，在独立工作区审查最新 main，未将分叉历史强行合并。

审查覆盖生产入口与关键调用链、相关单元/协议测试、CI 和发布门禁。不是逐行形式验证。复审后增加了针对凭证、取消、路径与 SDK 工具桥接的测试；实际验证范围见第 8 节。

## 3. 发现：按修复优先级排序

| 编号 | 级别 | 代码证据与触发条件                                                                                                                                               | 影响与建议                                                                                                                                                            |
| ---- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | P1   | `packages/core/src/agent.ts:680`：provider 返回非 `tool_use` 一律 `finish('end_turn')`；`apps/server/src/runtime-executor.ts:172` 附近只将 `error` 映射为 failed | `max_tokens` 被标为正常完成；`max_turns`、`blocked` 也缺少客户端可区分的结束原因。保留 stop reason，增加 termination reason 与可恢复提示；不自动无限续写。            |
| F2   | P1   | `packages/core/src/compaction/index.ts:68` 默认摘要模型为 `deepseek-chat`；`agent.ts` 自动压缩未提供当前模型 fallback                                            | 将 base URL 改成 Kimi/GLM 后，长任务摘要仍向该端点发送 DeepSeek 模型名。建立 main/summary/subagent/approval 模型角色解析，默认继承当前 provider 的有效模型。          |
| F3   | P1   | `CompactionOpts` 无 AbortSignal，摘要 `runTurn()` 没传 signal；`agent.ts:1054` 等待摘要完成                                                                      | 压缩期间取消无法中止该模型请求，取消延迟与后续 history 替换缺少保证。signal 贯穿压缩、hook 与提交边界，取消后禁止替换 history。                                       |
| F4   | P1   | `packages/core/src/credentials/index.ts` 的 `resolveCredentials()` 只解析 helper/store；CLI/server 错误信息要求设置 `DEEPSEEK_API_KEY`                           | 仅设置该环境变量时，生产 resolver 不读取它；CLI onboarding 虽检查变量，后续仍取不到凭证。统一环境变量、Keychain、文件、helper 的优先级与来源诊断，并测试全部入口。    |
| F5   | P1   | CLI `/model` 在 `apps/cli/src/commands.ts:269` 仅允许 chat/reasoner；desktop `slash-commands.ts:27` 与 `Repl.tsx:139` 重复两项列表                               | 无法从正常交互选择 Kimi/GLM，甚至 core 已声明的两个 v4 ID 也不在列表。后端提供模型目录，所有客户端消费同一 DTO。                                                      |
| F6   | P1   | `default-runtime.ts:44`、CLI repl/headless 均直接 new DeepSeekProvider；`Provider` 只有 name/runTurn                                                             | 自定义地址并不构成多协议、多模型支持。抽出统一 resolver、协议 adapter 与 provider capability；Anthropic Messages 和 OpenAI Chat Completions 分别处理。                |
| F7   | P1   | `runtime-executor.ts:99`、CLI repl/headless 使用 DeepSeek `EFFORT_PARAMS`；`model-metadata.ts` 未知模型默认 128K                                                 | effort 被转换为固定输出预算/温度，无法表达厂商 thinking/effort 差异；未知上下文可能错误触发压缩。按 provider/model 解析上下文、输出上限和可用参数；未知能力显式诊断。 |
| F8   | P1   | `deepseek.ts` 转换 assistant history 时明确丢弃 thinking；流请求固定发送 temperature、stream_options                                                             | 目前不能保证其他模型需要的推理状态回传、参数支持与工具流格式。保留适配器私有 continuation 数据，并用逐型号 fixture/live contract 验证；不把原始思考默认暴露到 UI。    |
| F9   | P2   | `pricing.ts:estimateCost()` 对未知模型回退 chat 单价；desktop/CLI 消费该估算                                                                                     | 新模型显示错误费用。未知价格显示“不可估算”；按 provider/model/currency/生效日期记录价格与缓存、reasoning 的计费关系。                                                 |
| F10  | P2   | CLI repl/headless 自行装配 provider/tools/hooks/MCP；server 另有 `composeRuntime()`                                                                              | RuntimeHost 安全基础已共享，但 CLI 尚未按旧计划成为协议薄客户端；摘要策略、插件、模型目录仍可能分叉。先提取共同 composition，保持 CLI 输出兼容，再逐步迁移协议。      |
| F11  | P2   | protocol `TurnSnapshot` 无 engine/provider/有效参数快照；模型主要藏在消息 payload/legacy metadata                                                                | 跨模型恢复时难以确认实际执行来源，SDK session 也无法直接映射。新增兼容的执行描述和引擎私有 session 引用；跨引擎采用显式 fork/import。                                 |

F8 是多模型适配缺口，不声称所有 Kimi/GLM 型号都要求同一种 thinking 回传。应由选定型号的官方接口契约与实际请求决定。

已有能力应保留：RuntimeHost 默认策略、工具 dispatcher、项目 trust/hook 审核、后端持有凭证、桌面 sidecar、协议审批/中断、legacy 双读、review apply/revert、worktree 保留语义及 release gate。旧计划中的原始 P0 列表是历史审查，不能直接当成最新 main 仍有相同漏洞。

## 4. 官方依据与支持边界

以下资料于审查日读取，端点与型号仍须随实现版本验证：

- [Claude Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)：SDK 可嵌入 Claude Code 的 loop、工具、上下文与会话能力。
- [Anthropic gateway 支持边界](https://code.claude.com/docs/en/llm-gateway)：Anthropic 不支持通过网关将 Claude Code 路由至非 Claude 模型。
- [Kimi 官方 Claude Code 指南](https://platform.kimi.com/docs/guide/claude-code-kimi)：提供 Anthropic 兼容端点 `https://api.moonshot.cn/anthropic` 与环境变量配置。
- [智谱官方 Claude Code 指南](https://docs.bigmodel.cn/cn/coding-plan/tool/claude)：提供 `https://open.bigmodel.cn/api/anthropic`；Coding Plan 与标准 API 凭证须按产品区分。
- [SDK permissions](https://platform.claude.com/docs/en/agent-sdk/permissions)：部分调用可能在 `canUseTool` 前获批，全面门禁需要覆盖每次调用的 hook；`allowedTools` 不是工具白名单。

厂商提供 Claude Code 指南，不等于已证明 SDK 嵌入、桌面分发、DeepCode 权限映射和全部功能兼容。版本配对、SDK/运行文件的分发条件、所选套餐对应用的可用性，应在 spike 中核实并记录；不将订阅凭证冒用为其他产品 API Key。

## 5. 目标架构

```text
CLI / desktop / VS Code / LSP
              ↓
app-server / 共享执行服务
  配置来源、模型目录、Thread/Turn/Item、审批、审计、恢复
              ↓
AgentEngine（每个 turn 只有一个执行 owner）
  ├─ native：现有 RuntimeHost + agent loop + provider adapters
  └─ claude-sdk：Claude Code loop + SDK event/session adapter
              ↓
统一强制策略 + 受控工具执行边界 + OS sandbox / 进程监督
```

将 engine、provider、protocol、model、credentialRef 分开。本次配置采用 `engine: native|claude-sdk`、`provider: deepseek|kimi|glm`；profile 使用 `baseURL` / `anthropicURL` 分开表达协议，以 `apiKeyEnv` 引用密钥。自定义模型 ID 归属显式 provider；没有新增 `custom` 协议适配器。密钥只由后端解析。国内/国际端点、Coding Plan/标准 API 建不同 profile，避免自动猜测。

原生 Provider 增加能力描述：contextWindow/maxOutput、tool calling、parallel tools、stream usage、图片输入、thinking/effort、continuation 格式、计费定义。UI 只展示公共能力；厂商私有参数留在 adapter。模型目录优先版本化配置与已验证 preset，远端发现仅做补充。

不要让原生 loop 调用 SDK loop，也不要让 SDK 工具绕过现有策略。第一版 SDK spike 优先禁用内置可执行工具，通过受控 MCP 暴露现有工具，并验证工具集合、参数、错误与所有调用路径。这样可以保留快照和 review 语义，但工具别名和质量成本也必须实测。若改用 SDK 内置工具，必须先完成每次调用策略 hook、路径/命令约束、外部沙箱、快照和子代理继承的完整验收，不能只接 `canUseTool`。

SDK 自有会话作为引擎私有事实源，DeepCode 保存稳定映射和 UI 事件投影；不伪造完整原生可恢复 history。引擎间切换保留旧数据，并以摘要+上下文建立新会话，向用户明确标记 fork/import。原始 reasoning/签名等数据根据协议需要存放在受保护的引擎记录，不默认进入公共 DTO、日志或导出。

## 6. 实施顺序与验收

| PR  | 工作范围                                                            | 必须通过的验收                                                                                                                                              |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 修复 F1–F4：结束原因、摘要模型、取消、凭证解析                      | 输出截断/循环预算不伪装成功；摘要按当前 profile 路由；取消摘要后不提交 history；环境变量-only 与 helper/store 优先级覆盖 CLI/server。                       |
| 2   | profile/credentialRef、统一模型目录与 provider resolver；修复 F5–F9 | 同一配置在 CLI/headless/desktop/editor 解析一致；未知模型不伪造价格或能力；不可信项目不能改 endpoint/credentialRef/engine 或继承敏感环境。                  |
| 3   | native Kimi/GLM adapters 与 fixture contract                        | 按所选协议完成流文本、多工具、错误、429/5xx、半截 JSON、usage、thinking 多轮及 abort；显式 opt-in 小额 live smoke。保留 DeepSeek 回归。                     |
| 4   | AgentEngine 接口与 Claude SDK 有界 spike                            | 固定 SDK/Claude 版本；Kimi、GLM 各验证一种型号：读→编辑→测试→审批拒绝→中断→重启恢复；保存脱敏证据。未达标保持 experimental。                                |
| 5   | SDK 权限/沙箱、事件投影、引擎会话映射                               | 计划模式无写入；symlink/路径逃逸/命令注入/恶意 MCP/子代理不可绕过；断连解除审批；取消后无延迟写与孤儿进程；review apply/revert 可用或明确 capability 禁用。 |
| 6   | 客户端统一与桌面分发                                                | CLI 既有参数/JSONL golden 不回退；模型与 effort 来自目录；renderer 无密钥；无系统 Node/Claude 的安装机可启动；签名/公证与升级回滚通过后再发布。             |

PR 1–3 可在 SDK 决策前独立交付。PR 4 通过后才扩大 SDK 集成；不以“成功回答一句话”作为切换默认引擎的依据。新增 app-server 能力需要协商，并保留旧客户端可识别的状态投影。

SDK 默认化条件：连续工具与长任务评测至少不低于 native 基线；审批、取消、恢复、沙箱与打包门禁全部通过；没有重复执行；明确支持的版本和型号组合。比较同一代码快照、任务、测试判据与预算，记录成功率、人工介入、首次工具延迟、总耗时和真实用量，不凭模型名称评判。

## 7. 迁移与回滚

旧 `model/baseURL` 与凭证映射为 legacy DeepSeek profile；旧文件继续只读，不删除 Keychain 项，不写入用户 `~/.claude` 配置。新增字段纳入 schema、来源诊断、trust gate 与脱敏导出，尤其防止项目 endpoint 获得全局 key。

引擎选择按 thread 固定并记录实际 engine/provider/model；中途改引擎建立新 thread。每个 turn 记录请求参数与解析后的有效参数，拒绝重复 turn id 执行；重启后的未知执行结果标为 interrupted/unknown，而非自动重放写工具。

回滚设置 `engine=native` 并关闭 SDK capability；保留 SDK 私有会话与映射但不再续写。新格式采用版本检测与双读单写，不要求降级客户端理解 SDK 会话。现有 release 包体/冷启动预算若因 SDK 增大，应提交实测差异与独立引擎包方案，不能静默放宽。

## 8. 复审后实施决定与结果

复审再次沿 CLI → RuntimeHost、app-server → RuntimeHost、provider/摘要、SDK → MCP → dispatcher 链路检查，以可验证边界缩小首批落地范围。已实现内容：

| 范围               | 实施结果                                                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 结束原因        | native 保留 max_tokens/stop_sequence/error；server 将预算耗尽、blocked 映射为 failed 并附原因；headless 输出预算耗尽退出 4；SDK 保留 result.stop_reason。                                                           |
| F2–F3 摘要与取消   | 摘要默认继承主模型；signal 贯穿请求、命令/HTTP hook 与提交前检查；CLI Ctrl+C 取消当前 turn。未响应取消的摘要不会替换 history。                                                                                      |
| F4 凭证            | helper → 环境变量 → legacy store；Kimi/GLM 只读取独立环境变量，绝不回退 DeepSeek 密钥或 URL；没有新增密钥文件迁移。                                                                                                 |
| F5–F8 多模型       | 同一 ConfiguredProvider 服务 CLI/server；版本化目录和自定义模型 ID；Kimi/GLM 不发送 DeepSeek temperature；推理 continuation 仅回传同 provider/model；未完整结束的流不会伪装成功。配置支持 contextWindow/maxOutput。 |
| F9 费用            | 未知价格显示不可估算；CLI 混合模型累计用量不按当前单一模型重算；desktop 逐 turn 累加已知价格，遇未知价格标记不可估算。                                                                                              |
| SDK 引擎           | 锁定 @anthropic-ai/claude-agent-sdk 0.3.310，显式 engine=claude-sdk；真实 SDK 进程拥有 loop；禁用内置工具、自动 settings/plugin 加载与环境凭证继承，SDK 只连接受控 DeepCode MCP 工具桥。                            |
| 权限与恢复         | SDK 工具通过统一 dispatcher、sandbox、审批、快照和 ledger；串行执行并在退出前 drain；引擎绑定和 SDK session 映射独立保存，拒绝原地跨引擎/跨模型恢复；文本及工具事件作为 UI 投影。                                   |
| 复审追加的边界修复 | 直接文件工具检查 workspace/额外可写目录及 symlink 真实路径，read-only 不能被 bypassPermissions 覆盖；auto 分类器错误、缺失或截断不能 fallback allow。                                                               |

实现边界与后续顺序：

1. **先真实厂商验收**：本机没有 Kimi/GLM 密钥。已提供 opt-in native live smoke；SDK 已跑真实进程 + 本地 Messages fixture 的写入、审批与重启恢复，不能替代真实 Kimi/GLM 任务矩阵。Anthropic 不保证非 Claude 模型，保持 experimental。
2. **再做 capability 与会话统一**：当前目录为共享纯数据模块，尚未新增协议模型发现接口；桌面自定义 profile 的上下文/预算标签仍是 preset 显示。native app-server 尚未启用自动压缩，不能直接套用 CLI 的 history 截断，否则损坏基于消息偏移的 durable projection。后续需独立 context checkpoint 与执行参数 DTO。
3. **再扩展 SDK 工具**：首版桥接 Read/Write/Edit/Bash/Grep/Glob/WebFetch/WebSearch/AskUserQuestion/SubmitReviewFinding/RestoreReviewAction。Task、持久 shell、第三方 MCP/plugin 工具、agent/mcp_tool/prompt hooks 暂不支持；SDK 自动压缩自有上下文，CLI /compact 与 conversation rewind 明确拒绝，/clear 新建 SDK 会话。原生引擎保留这些既有功能。
4. **最后分发与默认化**：SDK 是可选依赖，桌面/VS Code release bundle 将其 external，不将 SDK 原生可执行文件偷偷塞入现有包。独立安装、签名/公证、无系统 Node/Claude 冷启动以及跨平台包体测量通过前，不将 SDK 设为默认。当前发布路径默认 native。

路径检查使用 realpath 预检，未声称消除并发 symlink 替换竞态；shell 仍依赖既有 OS sandbox。原生历史保留现有 thinking 行为；SDK 私有完整历史不导入原生 loop。SDK 文件默认 0600、目录 0700，不修改用户 ~/.claude。

2026-10-25 提交前验证（macOS arm64，Node 22.23.4 / pnpm 9.12.0）：

| 检查                                                           | 结果                                                                                                                               |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 冻结依赖安装、typecheck、lint、format:check、build、docs:check | 通过                                                                                                                               |
| 完整 pnpm test                                                 | 1,754 passed，23 skipped（包含平台限定与 opt-in 用例）                                                                             |
| Claude SDK 本地实际进程测试                                    | Kimi、GLM 两种配置共 2 项通过；模拟 Messages 端点，真实工具执行与重启恢复；无厂商请求                                              |
| 桌面 Playwright                                                | 7 项通过；初次缺少 Chromium，安装测试依赖后通过                                                                                    |
| cargo test --locked                                            | 30 项通过                                                                                                                          |
| release:check                                                  | status=ok；VS Code app-server 700,692 bytes（上限 786,432），VSIX 216,702 bytes（上限 262,144）；权限/架构扫描通过                 |
| 桌面前端、sidecar 与 Node 22 资源构建                          | 通过；desktop sidecar 700,736 bytes；仅本地 ad-hoc 签名运行文件，无发行签名/公证                                                   |
| 额外 cargo fmt --check                                         | 未通过：基线未改动的 commands.rs、credentials.rs、file_preview.rs、settings.rs、voice.rs存在格式差异；本次不混入无关 Rust 格式修改 |

新增测试覆盖：环境/helper/store 优先级及取消、跨 provider 密钥与 reasoning 隔离、未信任 profile、半截流/工具批次、预算耗尽失败投影、自定义模型限制、路径/denyWrite/symlink、hook 子进程取消、SDK 审批拒绝/计划模式/无人值守终止、取消 pending approval、旧 native 历史保护、SDK 恢复及原生回滚拒绝混写。CLI 新增模型/预算、混合费用和 SDK /clear 行为也有回归。

创建 PR 时未完成的外部验收：真实 Kimi/GLM 请求、Linux bwrap/netns、真实长任务质量对比、发行签名/公证安装包。后续 CI 结果见第 10 节。没有凭证时 live 测试跳过而非报告通过；上述本地通过不等于生产兼容认证。

## 9. 提交前再次复审与修复

再次以最新 `origin/main@cedeb85` 核对完整变更，沿正常执行、权限拒绝、取消和恢复四条路径复审。以下问题均在本次提交中修复并加入回归测试：

| 级别 | 问题与修复                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1   | SDK 快照序号每轮从零开始，ledger 可能指向修改后快照或不存在的编号。现在从持久清单最大编号继续，只记录真实修改前快照；补齐读取来源，未启用快照时不伪造回滚位置。native 同样按最大编号递增。 |
| P1   | 审批等待期间路径变化可能绕过此前检查。native 与 SDK 在审批后及实际执行前再次检查真实路径，并拒绝 workspace 模式下的硬链接写入；review 恢复检查实际目标的 sandbox 和文件 contract。         |
| P1   | AskUserQuestion 的宿主回调不返回时，取消可能无法完成。现在取消立即解除等待；CLI slash 命令、初始化摘要和交互问题传递 signal，取消后不继续提交摘要或后续审计写入。                          |
| P1   | SDK 丢失 binding 时可能丢弃旧上下文重新开始。现在保留已有历史并拒绝恢复，校验绑定版本；CLI 阻止有历史的 SDK 会话原地切换模型。SDK 的晚到传输错误也不能覆盖成成功。                         |
| P1   | hook/helper shell 退出后仍可能留下后台子进程写文件。现在结束时清理进程组，取消/超时同时关闭管道；空摘要也不得替换原历史。                                                                  |
| P2   | SDK 初始化或关闭异常可能跳过工具排空、监听器解绑与临时目录清理。现在这些异常均经过收尾路径，报告失败；显式禁用的 hooks 不再错误阻止 SDK 启动。                                             |

补充兼容性：CLI 识别只配置 `DEEPSEEK_AUTH_TOKEN` 的启动方式，模型切换后的后台请求使用当前模型预算；SDK 工具桥遵守调用方的 spill 配置。snapshot 编号、修改前回滚、硬链接、审批后 symlink 替换、文件恢复限制、交互取消、孤儿进程、空摘要、SDK 绑定丢失/版本错误及清理失败均有定向测试。

native 默认和显式回滚路径不变：`engine: "native"` 加新会话；已有 SDK 记录保留且不混写。额外 Rust 格式检查的失败来自未修改的基线文件，未混入格式修复。真实厂商与发行安装包仍按第 8 节作为外部验收项，不能由本地 fixture 测试代替。

## 10. 2026-10-26 CI 验证与持续门禁

核对提交 `6a102c7` 的 [CI 运行记录](https://github.com/oratis/deepcode/actions/runs/40199497883)，5 项检查全部通过：Ubuntu/macOS 的类型、lint、格式、测试与发布门禁，以及桌面端到端、Rust、文档检查。Ubuntu 测试为 1,766 passed / 11 skipped，macOS 为 1,754 passed / 23 skipped。Ubuntu 的 bwrap 集成 11 项、netns 集成 2 项实际执行并通过，Linux sandbox 不再列为待验收。

首次 CI 的 SDK 实际进程 smoke 属于 opt-in，尚未执行；本次将其加入 Ubuntu/macOS 矩阵的独立必跑步骤。两种模型配置连接本地 Messages fixture，使用假密钥，验证安装的 SDK 可执行文件、受控工具写入与会话恢复，不依赖厂商密钥，也不消耗厂商额度。该步骤失败会阻止 CI 通过；最新提交的结果记录在 [PR #296](https://github.com/oratis/deepcode/pull/296)。

仍待验收：真实 Kimi/GLM 端点和套餐、多轮长任务质量与成本、SDK 独立安装及发行签名/公证包、无系统 Node/Claude 的冷启动和升级回滚。SDK 保持实验功能，native 默认不变。

## 11. 独立 agent 审查与发布前修复

独立 agent 对 `5df23ab` 进行只读审查并发布 [COMMENT review](https://github.com/oratis/deepcode/pull/296#pullrequestreview-5644341351)，三项发现均已复现并修复：

- **P1 取消后启动写入**：native/SDK 在最后一次异步路径核验后再次检查 signal；Write/Edit/NotebookEdit 在异步准备后、实际写入前检查取消，并向文件 I/O 传递 signal。回归测试在最终 stat、mkdir 和原文件读取完成时注入取消，确认不启动 handler 或不覆盖原文件。已经提交到操作系统的写入不承诺事务回滚。
- **P2 额外目录丢失**：共享目录合并器按有效 sandbox mode 处理默认和 mode-only 配置，CLI/server 的额外目录都进入 allowWrite；native 与 SDK 测试同时验证 read-only/denyWrite 优先。
- **P2 SDK 会话分叉丢失来源**：CLI 和 canonical protocol store 在复制前统一验证源会话。SDK、未知版本或丢失 binding 但仍有 SDK 目录的会话拒绝分叉；原生及旧原生会话继续可用。失败不会创建目标会话，也不修改源历史。

发布准备同步 `0.4.0` 的六处版本号和 CHANGELOG，并把 SDK 实际进程 smoke 加入标签发布验证。按既有发布流程，缺少 Apple/npm 凭证时只发布 VSIX 与源码；SDK 可选运行文件仍不附带到 VSIX，native 仍是默认。合并与发布以独立复审和最新 CI 通过为条件；最终证据记录在 PR。

独立复审确认三项均修复，额外运行 core 49 项、CLI 恢复 9 项、server store 8 项全部通过。修复后的本地全量测试为 1,778 passed / 23 skipped；SDK 实际进程 2 项、桌面 E2E 7 项、Rust 30 项通过。冻结安装、类型、lint、格式、构建、文档与发布检查通过；VS Code app-server 701,845 bytes、VSIX 216,965 bytes，均在既有预算内。
