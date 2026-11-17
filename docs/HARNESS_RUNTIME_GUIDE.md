# Harness profile 与 session-v2 使用说明

H03/H04 将现有 CLI 与 app-server 接入统一 bootstrap 和新的会话提交层。agent loop 仍为现有 native 或显式启用的 Claude SDK；完整 `harness-v2` backend、Web、ACP 和插件领域拆分仍按后续工作包推进。

> 桌面/编辑器用户请使用 v0.5.1 或更新版本。v0.5.0 的 stdio decoder 漏接了部分已声明方法，会拒绝会话列表、fork/archive/delete、rename、文件历史及 runtime capabilities 请求；v0.5.1 修复传输准入，未改变会话存储格式。

## 组合 profile

```bash
deepcode profile inspect
deepcode profile inspect --profile headless
deepcode -p "解释这个项目" --profile headless
deepcode app-server --profile desktop
```

当前支持 `interactive`、`headless`、`app-server`、`desktop`、`editor`，共享固定的 `base-coding` bundle。CLI 和 headless 分别默认选前两项；普通 app-server 默认选 `app-server`；Tauri/VS Code 分发入口分别显式选择 `desktop`/`editor`。profile 不替代模型/provider 配置或定时任务 profile，也不隐式改变审批模式。

加载顺序：bundle 默认 → `<data>/profiles/<name>.json` → `<data>/runtime-profile.json` → **已信任** workspace 的 `.deepcode/runtime-profile.json` → host 显式 startup 层。CLI 默认 data 为 `~/.deepcode`；app-server 使用自己的 data 目录。

示例：

```json
{
  "schemaVersion": 1,
  "bundles": ["base-coding"],
  "tools": {
    "allow": ["Read", "Grep", "Glob"],
    "deny": ["Bash"]
  }
}
```

`allow` 跨层取交集，`deny` 取并集；空 `allow` 表示不允许任何工具。没有 `allow` 表示保留宿主已有工具上限，仍需通过权限、contract 和 sandbox 检查。即使选择 `bypassPermissions`，profile 排除的工具也不会执行。

未知字段、重复工具名、未知 schema/bundle、切换 entrypoint profile 的 patch 都会拒绝。此版本不开放配置替换 root owner、加载任意宿主 JS、修改 credential/endpoint/engine 或卸载安全服务。外部插件仍使用隔离 extension host。 外部 command hook 通过 Bash broker，保留 JSON stdin 与 hook 环境；审批针对完整包装命令。MCP/外部 command hook 的决策输出被截断时拒绝本次调用，不会把不完整 JSON 当作允许。

`profile inspect` 显示 profile、插件图、root owner/version、代际标识与字段来源；来源记录不包含配置值、凭据。运行时固定配置快照，活跃 turn 固定代际。`AppBootstrap.reload()` 仅在空闲时接受；失败保留当前图。真实运行入口将最近成功的 profile 写入 `<data>/runtime-generations/<name>.last-good.json`。它是恢复检查点，启动时遇到无效新配置会报错，不会偷偷回退到权限更宽的配置。恢复时检查该文件并显式修复 profile，再重启。

CLI 的 flags、slash commands、退出码与 JSON/JSONL 输出保持原契约。CLI 与 server 的 memory/skills/MCP 领域组合暂保留迁移 adapter；领域插件拆分与彻底去重属于 H05–H09。

## 会话存储与兼容

新会话以及旧 native 会话的后续写入使用独立的 `<data>/sessions-v2/<id>/`。原 `sessions/` 和 `threads-v1/` 不再接收新会话的写入。读取仍支持 core-v0、desktop-v0、canonical-v1。只看历史不触发迁移；首次续写 native JSONL 会话才导入。

每个 v2 会话包含：

- `manifest.json`：唯一已提交可见点，记录 schema、generation、字节数、cursor、SHA-256。
- `journal-<generation>.jsonl`：无压缩追加事件；默认不记录 token delta。
- `leases/`：不可覆盖的跨进程租约代次及释放记录。
- snapshots、SDK continuation 等受保护资源；资源登记事件在 journal 中。

目录使用 0700，新 journal/manifest/租约文件使用 0600。输入接收、审批、工具 intent/result、turn 终态经过日志 fsync、manifest 原子替换和目录同步后才确认。工具 intent 提交失败时不启动工具；结果提交失败时停止本轮正常完成。此耐久性边界不等于保证所有文件系统、硬件断电或远端工具都可事务回滚。

同一会话从 turn 入队到终态提交、取消排空及资源释放只允许一个写入者。不能靠等待时间接管活进程；同机进程确认退出后才允许接续，跨主机或无法确认的 owner 拒绝写入。租约依赖本机文件系统的独占 hard-link 发布和目录同步；不要把会话目录放到不提供这些语义的网络共享。平台不能完成这些操作时启动写入失败，不降级为无锁模式。

重启读取只接受 manifest 指定的已提交前缀。后续写入可截掉未提交尾巴；已提交中段损坏、checksum 不符、未知必要事件、未来版本直接报错。保留事件日志即可重建模型 history、timeline、资源与检索投影；model checkpoint 不删除历史事实。app-server 的完整 items/lifecycle 快照也作为 journal 事件保存，`threads-v1/*.json` 不再是新会话事实源。

崩溃留下的 in-progress turn 会标成 interrupted，保存已经提交的消息，并标明外部效果可能部分完成；不会重新执行工具。正常取消及分批保存终态时崩溃也保留本轮已提交的完整消息。模型 history 中悬空的工具调用在下一次用户输入前补充本轮已有 durable 结果，或明确的 unknown 结果；重复 call ID 不会借用其他 turn 的结果。`cleanup_incomplete` 会隔离会话，避免未确认停止的进程获得下一轮写入机会。

## 旧格式迁移边界

迁移在 TS/Rust 共用的 `<id>.writer.lock` 屏障内读取、计算 source hash、校验版本/engine、复制资源并再次核对 hash。候选 journal 在 committed manifest 发布前不可见。导入来源、格式与缺失的旧审批/执行过程显式记录，不虚构旧事件。原会话文件及原资源保持字节不变；重试相同导入幂等。

历史 thread snapshot 没有可靠的旧 writer 屏障，因此原 JSONL 是 native 自动导入的来源；旧 snapshot 文件保留。只有 thread snapshot、没有对应 JSONL 的会话可以查看，但拒绝自动续写。旧 SDK 私有 continuation 也没有完整运行期的共享锁，因此继续只读，拒绝自动复制为新 SDK/native 会话；可使用上一版本继续该会话，或显式开始新会话。新建 v2 SDK 会话保留 engine 绑定和独立私有 continuation，仍拒绝跨 engine 恢复及不受支持的 fork。

旧 writer 后来续写原文件，不会自动同步到已导入的 v2。请停止旧客户端再迁移，不要交替使用两代客户端编辑同一逻辑会话。遇到遗留 `.writer.lock` 时不自动删除：先确认所有旧 writer 已停止，再由操作者处理旧锁；无法确认时保持只读。

迁移后的 rename/archive/delete 由 app-server journal 所有者处理；桌面通过新增的可协商 `sessionJournal` 能力使用 rename 和文件历史接口，protocolVersion 仍为 1。旧 sidecar 未声明该能力时才使用旧 Rust 接口；新接口报错时不会绕过所有者改写 v1。

归档是 journal 状态，不删除历史。用户明确删除会话时移除 v2 私有 payload 与对应旧文件，保留不含会话内容的 tombstone/租约元数据以阻止缓存复活；这是显式删除操作，不属于只读迁移。普通 plugin dispose、bootstrap close 和配置重载不删除会话。

## 回滚

停止当前 host，使用上一个受测版本打开原 `sessions/` 会话。原文件没有迁移写入，因此旧版仍可读取；它看不到 v2 后续追加。保留 v2 目录供新版本恢复，不能直接改名为 v1，也不能把 SDK 公共 timeline 当作 native 可恢复历史。已经显式删除的会话不承诺可回滚恢复。

native 每 step 请求快照、完整 context/checkpoint 生产者、跨 turn jobs/resource retention、cursor 重连与 Web/ACP 能力仍属于 H05/H08/H10/H11。此版本没有对未暴露的 SDK 内部模型请求宣称可重放。
