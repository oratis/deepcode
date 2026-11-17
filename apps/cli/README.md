# @oratis/deepcode

DeepCode CLI —— DeepSeek 驱动的命令行编程 agent，在真实代码库里读文件、改代码、跑命令、
审阅 diff，并把每一次改动记账。

## 安装

需要 Node 22 或更新版本。以 [GitHub Release](https://github.com/oratis/deepcode/releases/latest) 中的实际发布渠道为准；下载其中的 CLI `.tgz` 后可在任意目录安装：

```bash
npm install -g ./oratis-deepcode-<version>.tgz
deepcode --help
```

若该版本已发布 npm registry，也可以使用 `npm install -g @oratis/deepcode`。可选的 Claude SDK 会随 npm 安装；不使用该实验性引擎时可加 `--omit=optional`。SDK 缺失时原生 DeepSeek 引擎继续可用，选择 SDK 引擎则给出明确安装提示。

也可以使用 Node 22 与 pnpm 9 从源码构建：

```bash
# Node 22 + pnpm 9
git clone https://github.com/oratis/deepcode.git
cd deepcode
pnpm install --frozen-lockfile
pnpm build
deepcode_checkout="$PWD"
deepcode() { node "$deepcode_checkout/apps/cli/dist/cli.js" "$@"; }
deepcode --help
```

`deepcode` 函数在当前 shell 中有效。首次启动会引导填入 `DEEPSEEK_API_KEY`。

## 发布包验证

维护者执行 `pnpm build && pnpm --dir apps/cli package:check`。输出是
`apps/cli/dist/npm/oratis-deepcode-<version>.tgz`；它包含 CLI 与原生运行时、内建 skills、settings schema 和第三方许可证。源码工作区继续使用原有 `tsc` 输出。

验证会在仓库外离线安装实际 tarball，清空运行时 PATH，并检查版本、帮助、内建 skills、profile、stdio 会话操作、重启恢复以及可选 SDK 缺失/安装后的解析。该检查无需真实模型密钥，SDK 路径使用本地 fixture。

仅发布通过验证的 `.tgz`，不要直接从 `apps/cli` 执行 `pnpm publish`：工作区 manifest 中的私有 `@deepcode/*` 依赖不能由普通用户从 npm 安装。产物详情和验证结果在 `apps/cli/dist/npm/package-report.json`。

## 用法

```bash
deepcode                                  # 交互式 REPL
deepcode -p "fix the bug in src/auth.ts"  # headless 一次性
deepcode --mode plan                      # 只读规划，出计划等批准
deepcode --model deepseek-reasoner --effort high
```

工具、权限、沙箱、MCP、skills、plugins、hooks、后台任务与定时任务的完整说明见
[quickstart](https://github.com/oratis/deepcode/blob/main/docs/quickstart.md) 与
[CLI flags](https://github.com/oratis/deepcode/blob/main/docs/cli-flags.md)。

## 治理

- [`deepcode contract`](https://github.com/oratis/deepcode/blob/main/docs/file-contract.md)
  —— 路径维度的读/写/执行契约，与既有权限规则按"最严者胜"合成，只能收紧。
- [`deepcode ledger`](https://github.com/oratis/deepcode/blob/main/docs/change-ledger.md)
  —— 变更账本：每次改动配上驱动它的请求和可回滚的检查点。
- `deepcode doctor` —— 打印运行时能力声明与契约告警。

## 关于包名

二进制始终是 `deepcode`。npm 上的包名换过两次：`deepcode-cli` 与 `@deepcode/cli`
都属于无关的第三方项目，无法发布。当前且长期的名字是 **`@oratis/deepcode`**。

## License

MIT
