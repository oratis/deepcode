# ADR 0003：将 DeepCode 改造成插件组合的 Harness

- 日期：2026-11-17
- 状态：**Accepted；用户已授权按方案实施 H01/H02，后续工作包仍按门禁推进**
- 基线：DeepCode `3421a3c77a4955d428b2bc9b5169c128b85c1279`；DeepSeek Harness `39163dd30f703a79079e2d2446545cff3c453738`
- 范围：[完整改造方案](../HARNESS_TRANSFORMATION_PLAN.md)、[运行时契约](../design/harness-runtime-v2.md)、[源码研究](../research/deepseek-harness-architecture-2026-11.md)

## 背景与决策变化

旧 [DSH 采纳方案](../DSH_ADOPTION_PLAN.md) 拒绝 Cordis 重写，理由是当时目标只是补齐上下文经济学和工具体验，DeepCode没有插件平台的产品前提。本次用户要求“将deepcode完整改造成这样的模式”，明确把插件组合本身设为目标。继续仅采纳spill、guard等功能不能满足该目标。

最新DeepCode已完成上一轮大部分安全host、协议和薄客户端改造，也有多模型及experimental Claude SDK引擎。新方案从这些实际成果出发，不把历史缺陷当现状，也不把当前manifest扩展误认为完整运行时插件SDK。

上游的核心价值是生命周期、依赖、scope、配置组合和服务边界，不是包数量或桌面框架。上游同进程插件属于可信代码；其tools/pre-execute fallback为allow，安全服务可替换。因此完整采用组合模式仍必须保留DeepCode不可绕过权限约束。

## 决策

1. **采用Cordis组合模型与实际实现**。第一方agent/session/context/provider/tool/jobs/UI都以有类型的插件服务和可逆贡献注册；所有运行入口使用canonical bootstrap/profile。`core`最终成为兼容facade，不再持有独立生产composition。
2. **保留受保护的安全根**。安全组件可内部插件化，但bootstrap固定可信实现，用户patch和外部扩展不能删除policy、credential、resource supervisor和审计提交约束。第三方代码默认进受限进程，不能直接获得Cordis宿主权限。
3. **以DeepCode契约隔离上游版本**。固定研究commit，优先核验`@deepseek-ai/cordis`发布物；不能核验时采用最小vendor闭包和来源/补丁清单。普通npm `cordis`不视作已验证等价。MIT版权和第三方依赖license随分发保留。
4. **保留Tauri与现有protocol公共面**。共享Web/UI插件图不要求迁到Electron。Thread/Turn/Item、CLI flags/JSONL和IDE适配继续有效；上游Web/SDK/ACP通过模式参考与独立adapter对接，不承诺wire兼容。
5. **新事件会话旁写迁移**。session-v2 journal成为新事实源，模型history/UI是投影。旧core/desktop/v1/snapshot只读；SDK私有session与engine binding保留。迁移与降级不能覆盖旧会话。
6. **运行环境升级单独证明**。本轮保持Node22/pnpm9；上游Node24.9、Zstd和原生锁不可隐式引入。框架/锁/PTY/packaging spike通过后才能扩大分发。
7. **分阶段替换**。先统一executor和验证Cordis/产物，再迁profile、session、loop与功能，最后迁全部客户端和生态。每个生产入口只有一个backend和loop owner，禁止影子重放真实写工具。

该决策已获实施授权，取代旧DSH方案“拒绝Cordis化”的结论及上一轮Codex计划中的内部组装方案；继续保留 [ADR 0001](0001-desktop-runtime-sidecar.md) 的可信sidecar边界和 [ADR 0002](0002-multi-model-agent-engine.md) 的engine/provider分离、SDK实验状态和会话隔离。

## 备选方案与取舍

| 选项                                      | 收益                           | 代价/不选原因                                                        |
| ----------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| 继续局部采纳                              | 最小短期改动                   | 无法实现用户要求的插件组合；composition和跨端差异仍在                |
| 给旧runAgent包一层plugin                  | 快速展示容器                   | 内部生命周期/执行/存储仍耦合，不构成完整重构                         |
| 整仓fork dsh或以其CLI作后端               | 很快拥有上游表面功能           | 用户资产、DeepCode协议/治理/IDE不兼容；Node/桌面/安全/发布成本不可控 |
| 自研类Cordis容器                          | 可控依赖                       | 重新承担依赖/卸载/竞态语义，不符合采用成熟模式的收益目标             |
| 直接允许任意上游host插件                  | 插件数量多                     | 同进程任意代码可绕过本地权限，违背仓库约束                           |
| **Cordis最小框架 + DeepCode服务与安全根** | 真正统一组合，复用既有产品资产 | 需要契约、适配与迁移工程；接受该成本并以阶段门禁约束                 |

## 兼容范围和代价

新增完整插件生命周期、配置代际、schema、安装激活事务、公共SDK和客户端slot，带来固定维护成本。插件包及数据版本必须纳入发布兼容矩阵。上游源码存在并不证明第三方插件可直接安装或所有能力稳定。

现有多模型、file contract、ledger、skills、MCP、review、shell、cron和worktree全部迁移；SDK继续显式启用和能力受限，不能由本ADR顺带默认化。新UI可拓展但缺插件时必须可读降级。

H01优先处理静态发现的CLI插件直调、过宽env继承、sandbox mode解析和重复桥；H02验证依赖/Node22/产物预算。任一失败不得跳过安全门禁，只阻止新backend默认化，旧受测host继续可用。

## 回滚路径

保留`legacy`与`harness-v2` backend，和`native|claude-sdk` engine分开。新会话标记backend/generation；新存储独立目录，单writer互斥。profile激活保留last-known-good，失败候选被撤销。

回滚选择上一个受测native host/profile及旧会话；保留新generation只读可导出。v2续写不自动倒灌旧session，用户需显式摘要fork才能转移上下文。SDK私有历史不混写native。回滚不恢复renderer agent，不禁用policy，不删除未合并worktree，也不声称可撤销已执行脚本/命令的副作用。

默认切换条件与H00–H14验收见主方案。至少两个正式发布周期观察后，才能通过独立清理PR删除旧backend；legacy只读adapter继续保留。

## 验收与状态记录

接受条件：用户审阅目标与路线；H01/H02安全和分发spike通过；后续每PR附边界测试、迁移/安全影响和文档。完成条件为全部既有领域与客户端迁完、插件开发安装闭环可用、无重复生产composition/executor、质量与发布门禁通过。

H01/H02 实现、实际 Cordis 4.1.0 来源差异、生命周期测试、Node22/sidecar/VSIX 预算与回滚路径见 [实施进度](../HARNESS_IMPLEMENTATION_PROGRESS.md)。这是 H01/H02 阶段的验收记录；后续 H03/H04 决策见下节。尚未发布，完整迁移不能由局部工作包替代。

## H03/H04 实施决策（2026-11-17）

生产入口先接固定、不可配置替换的第一方安全根与 base-coding；领域组合拆分继续由后续工作包承担。profile patch 首版只收紧工具集合，不允许凭据、endpoint、engine 或宿主代码注入。last-good 持久检查点不作为无效配置的静默回退路径。

session-v2 使用 JSONL + 已提交 manifest。租约使用不可覆盖的连续 owner 代次，atomic hard-link 发布避免 stale-lock unlink 的 ABA 竞争；同机 PID 明确死亡或正常释放才可接续。依赖本地文件系统语义，不宣称网络共享或未验证平台的互斥保证。

native 旧 JSONL 在原 TS/Rust writer 屏障内导入。无旧屏障的 SDK 私有 continuation 与 snapshot-only 文件保留只读；不以两次 hash 替代 writer 排他证明。故障恢复记录 unknown/partial，不重放外部效果。显式用户删除可清理旧源和 v2 payload，普通迁移/重载不得清理。

真实入口、边界测试、已知限制和回滚操作见 [实施进度](../HARNESS_IMPLEMENTATION_PROGRESS.md) 与 [使用说明](../HARNESS_RUNTIME_GUIDE.md)。
