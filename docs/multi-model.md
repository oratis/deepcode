# 多模型与可选 Claude Agent SDK 引擎

DeepCode 默认使用原生引擎。此分支新增 Kimi、GLM 的 OpenAI Chat Completions 适配，并提供显式启用的 Claude Agent SDK 实验引擎。预设是 `kimi-k2.5`、`glm-4.7`；真实厂商验收尚未完成。架构决定和验收范围见 [ADR 0002](adr/0002-multi-model-agent-engine.md)。

## 原生引擎配置

密钥放在后端进程的环境中，不写进项目配置或 renderer：

```bash
export MOONSHOT_API_KEY="<your-kimi-api-key>"
export GLM_API_KEY="<your-glm-api-key>"
deepcode --model kimi-k2.5
deepcode --model glm-4.7 -p "概括这个项目" --mode plan
```

`/model kimi-k2.5`、`/model glm-4.7` 支持在原生会话内切换。DeepSeek 继续支持 `DEEPSEEK_API_KEY`、`DEEPSEEK_AUTH_TOKEN` 和既有 Keychain/凭证文件。DeepSeek 的解析优先级为成功的 `apiKeyHelper` → 环境变量 → 已存凭证；Kimi/GLM 不会读取 legacy helper/store。缺少对应密钥时明确失败。

在用户 `~/.deepcode/settings.json` 中设置默认项，或使用 `deepcode --settings /absolute/path/settings.json`：

```json
{
  "engine": "native",
  "provider": "kimi",
  "model": "kimi-k2.5",
  "providers": {
    "kimi": {
      "apiKeyEnv": "MOONSHOT_API_KEY",
      "baseURL": "https://api.moonshot.cn/v1"
    },
    "glm": {
      "apiKeyEnv": "GLM_API_KEY",
      "baseURL": "https://open.bigmodel.cn/api/paas/v4"
    }
  }
}
```

已知 `kimi-`/`glm-`/`deepseek-` 前缀选择相应 provider；其他自定义模型 ID 使用 `provider` 指定的适配器。`providers.<id>.model` 是该 provider 的默认模型，顶层 `model` 优先。自定义 profile 可提供正整数 `contextWindow` 与 `maxOutput`；未知模型上下文按保守的 32,000 预算处理，输出按 8,192 限制，均不是厂商能力声明。

本次预设对 Kimi 的输出最多使用 16,384 tokens、GLM 最多 32,768 tokens，是应用的保守限制。`effort` 控制输出预算，不宣称等同于厂商推理强度。Kimi/GLM 不发送 DeepSeek 的 temperature。未知价格显示“不可估算”；费用以厂商账单为准。

不同区域、国际端点或 Coding Plan 必须显式配置该产品对应的 URL 和密钥环境变量名，不能混用套餐凭证。OpenAI 与 Anthropic 端点分别配置，不自动改写 URL。端点须 HTTPS；仅本机 loopback 测试可 HTTP。不可信项目的 `engine/provider/providers/model/baseURL` 会被 trust gate 移除，保留用户级配置。

桌面、VS Code/LSP 的 app-server 使用同一后端 resolver。桌面模型菜单读取共享预设，也允许 `/model` 输入自定义 ID；自定义 profile 的 UI 上下文标签暂不反映后端覆盖值。桌面进程必须实际继承密钥环境变量；本次没有新增前端密钥存储表单。

## Claude Agent SDK 实验引擎

源码 workspace 的可选依赖锁定为 `@anthropic-ai/claude-agent-sdk@0.3.310`。正常 `pnpm install --frozen-lockfile` 会安装可用平台的运行文件。没有可选依赖时 native 仍可运行；显式选择 SDK 会给出安装或回滚提示。当前桌面/VS Code 发布包不附带 SDK 运行文件。

用户配置示例：

```json
{
  "engine": "claude-sdk",
  "provider": "kimi",
  "model": "kimi-k2.5",
  "providers": {
    "kimi": {
      "apiKeyEnv": "MOONSHOT_API_KEY",
      "anthropicURL": "https://api.moonshot.cn/anthropic"
    },
    "glm": {
      "apiKeyEnv": "GLM_API_KEY",
      "anthropicURL": "https://open.bigmodel.cn/api/anthropic"
    }
  }
}
```

GLM 改为 `provider: "glm"` 与 `model: "glm-4.7"`。profile 配了自定义 `baseURL` 时，SDK 必须同时显式配置 `anthropicURL`，防止密钥被发送到推测的地址。DeepSeek 暂只支持 native。

SDK 独占 agent loop；DeepCode 的内置文件/命令工具经受控 MCP 桥进入同一审批与 sandbox。SDK 内置工具、自动 settings/plugin 加载均禁用，运行环境只注入选中厂商的凭证。当前桥接范围为 Read、Write、Edit、Bash、Grep、Glob、WebFetch、WebSearch、AskUserQuestion 及 review 工具；第三方 MCP/plugin 工具、Task、持久 shell 和 agent/mcp_tool/prompt hooks 尚未支持。SDK 检测到启用中的不支持 hook 类型时会拒绝启动，避免静默跳过。command hooks 和凭证 helper 必须在调用内完成工作；shell 结束时会清理其后台子进程，持久任务应通过原生任务系统运行。

SDK 自行管理上下文。CLI `/compact` 和会话 rewind 会说明不可用，文件 rewind 保留；`/clear` 建立新 SDK 会话。不要把 DeepCode 的 UI 消息投影当成 SDK 的完整历史。SDK session 与 engine 绑定保存在 `sessions/<id>/`，不修改 `~/.claude`。

回滚时设置 `"engine": "native"` 并新建会话。旧 SDK 记录保留；同一 session 不能直接切换引擎，SDK session 不能中途改 provider/model/endpoint；CLI 更换模型前须先 `/clear`。绑定文件丢失或版本不支持时会拒绝恢复，原历史仍保留。该限制避免重复执行工具和错误恢复。当前不提供跨引擎自动历史导入。

## 验证

```bash
pnpm typecheck
pnpm test
# 安装的真实 SDK 进程 + 本地模拟 Messages 服务；不调用厂商
DEEPCODE_SDK_SMOKE=1 pnpm --filter @deepcode/app-server exec vitest run src/engines/claude-sdk.smoke.test.ts
# 显式联网验证；只对配置了密钥的 provider 执行，会消耗对应账户额度
DEEPCODE_LIVE_TESTS=1 pnpm --filter @deepcode/core exec vitest run src/providers/multi.live.test.ts
```

截断和循环预算耗尽不再报告成功：headless 返回退出码 4；server 返回 failed 和原因。取消覆盖模型请求、审批、用户问答、摘要、命令/HTTP hooks 和受控工具队列。文件工具拒绝 workspace 之外（含 symlink）的写入，除非显式增加可写目录或使用 danger-full-access；read-only 仍然禁止写入。workspace 模式拒绝硬链接文件写入；审批后会重新检查路径，review 恢复也遵守文件限制。SDK 快照编号跨轮次延续，回滚记录指向实际修改前快照；关闭快照时不会提供虚构的回滚引用。

当前 SDK 仍是实验功能：本地协议与权限测试不能证明非 Claude 厂商完全兼容，也不代表签名安装包、Linux sandbox 和真实长任务验收已完成。具体结果与剩余工作记录在 ADR。
