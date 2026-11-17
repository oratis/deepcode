# @oratis/deepcode

DeepCode CLI —— DeepSeek 驱动的命令行编程 agent，在真实代码库里读文件、改代码、跑命令、
审阅 diff，并把每一次改动记账。

## 安装

v0.5.1 未发布 npm 包，请使用 Node 22 与 pnpm 9 从源码构建。此版本的 VSIX 可从 [GitHub Release](https://github.com/oratis/deepcode/releases/tag/v0.5.1) 安装。

```bash
# Node 22 + pnpm 9
git clone --branch v0.5.1 https://github.com/oratis/deepcode.git
cd deepcode
pnpm install --frozen-lockfile
pnpm build
deepcode_checkout="$PWD"
deepcode() { node "$deepcode_checkout/apps/cli/dist/cli.js" "$@"; }
deepcode --help
```

`deepcode` 函数在当前 shell 中有效。首次启动会引导填入 `DEEPSEEK_API_KEY`。

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
