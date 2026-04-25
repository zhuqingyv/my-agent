# my-agent

本地模型驱动的 CLI Agent，基于 [Ink](https://github.com/vadimdemedes/ink) 构建终端 UI，支持动态注入 MCP 工具、图片输入、Session 持久化与危险命令守护。

## 功能

- **本地模型** — 兼容任何 OpenAI API 接口（LM Studio、Ollama、vLLM 等）
- **动态 MCP 注入** — 在配置声明 MCP Server，启动时自动发现并注入工具
- **内置 MCP**
  - `exec` — 命令行执行
  - `fs` — 文件读写
  - `fs-edit` — 结构化文件编辑
  - `grep` — 代码/文本搜索
  - `web` — 网页抓取 + DuckDuckGo 搜索
- **图片输入** — 剪贴板粘贴图片并随消息上送（multi-modal model）
- **自驱动 Task 栈** — 模型通过 `create_task` 自主拆解任务，LIFO 栈驱动逐个执行
- **Session 持久化** — 对话自动存档，支持 `--resume` 续跑
- **Danger Guard** — 对 `rm -rf /`、`:(){:|:&};:`、`dd` 等高危命令拦截并二次确认
- **Context 压缩** — 工具输出超长自动压缩（TOON 编码）
- **AGENT.md** — 自动读取 cwd 与上级目录的 `AGENT.md`，注入到 system prompt
- **Ink TUI** — React 驱动的终端 UI，彩色 Markdown、思考条、任务进度、状态栏

## 快速开始

```bash
git clone git@github.com:zhuqingyv/my-agent.git
cd my-agent
npm install

# 交互式配置（写入全局配置 + 安装 ma 命令）
npm run init

# 或直接传参
npm run init -- http://localhost:1234 qwen3-30b-a3b

npm run build
ma
```

> `npm run init` 自动补全 `/v1` 后缀，检测并安装全局 `ma` 命令（失败时 fallback 到 `sudo npm link`）。

## 命令行

```bash
ma                       # 默认进入 chat
ma chat                  # 同上
ma chat --resume         # 恢复最近一次会话
ma chat --resume <id>    # 恢复指定会话
ma dev                   # 开 debug 日志（~/.my-agent/debug.log）
ma sessions              # 列出最近会话
ma sessions --prune      # 清理老会话（保留最近 20 条）
ma init <baseURL> <model> [apiKey]  # 写入全局配置
ma version
```

## 交互命令

启动后在 REPL 中输入：

| 命令 | 说明 |
|------|------|
| `/quit` `/exit` | 退出 |
| `/tools` | 查看所有已发现的工具 |
| `/stack` | 查看当前 Task 栈（current / pending / completed） |
| `/abort` | 清空待办 Task |
| `/archive <id>` | 查看某 Task 的完整执行记录 |
| `/clear` | 清空对话历史 |
| `/models` | 列出模型 server 上可用的模型 |
| `/model <name>` | 运行时切换模型 |

Session 管理从 CLI 子命令入口：`ma sessions [--prune]`、`ma chat --resume`。

## 快捷键

| 按键 | 说明 |
|------|------|
| `Ctrl+V` | 从系统剪贴板读取图片（macOS），随下条消息上送 |
| `Ctrl+X` | 清除当前待发送的图片队列 |
| `ESC` | 中断正在进行的模型响应 / 工具调用 |
| `Ctrl+C` | 退出程序 |

## 配置

配置分两层，深度合并（项目级覆盖全局）：

### 全局配置 `~/.my-agent/config.json`

`npm run init` 自动生成：

```json
{
  "model": {
    "baseURL": "http://localhost:1234/v1",
    "model": "qwen3-30b-a3b",
    "apiKey": "lm-studio"
  },
  "mcpServers": {
    "exec":    { "command": "/abs/node_modules/.bin/tsx", "args": ["/abs/servers/exec-mcp.ts"] },
    "fs":      { "command": "/abs/node_modules/.bin/tsx", "args": ["/abs/servers/fs-mcp.ts"] },
    "fs-edit": { "command": "/abs/node_modules/.bin/tsx", "args": ["/abs/servers/fs-edit-mcp.ts"] },
    "grep":    { "command": "/abs/node_modules/.bin/tsx", "args": ["/abs/servers/grep-mcp.ts"] },
    "web":     { "command": "/abs/node_modules/.bin/tsx", "args": ["/abs/servers/web-mcp.ts"] }
  }
}
```

### 项目配置 `./config.json`（可选）

在具体工作目录下放置，覆盖或追加 MCP / systemPrompt：

```json
{
  "mcpServers": {
    "comm": { "command": "node", "args": ["./your-comm-mcp.js"] }
  },
  "systemPrompt": "你是测试机 agent，收到任务后拉代码跑 E2E。"
}
```

### AGENT.md

`ma` 启动时会从 cwd 向上逐层扫描 `AGENT.md`（最多 5 层），以及 `~/.my-agent/AGENT.md`，将内容注入 system prompt。单文件超过 32KB 自动截断。

## Task 栈机制

模型通过内置 `create_task` 工具将复杂任务拆成多个子任务：

- **LIFO 栈** — 后入先出，子任务优先完成
- **防重复** — 每轮注入 current / pending / completed 列表，模型自行去重
- **上限** — maxTasks=50、maxDepth=8
- **归档** — Task 完成后原始记录折叠为摘要，可通过 `/archive <id>` 展开

## 架构

```
ma (Ink TUI)
 └── Agent Core (OpenAI SDK, Task 栈驱动 tool-calling loop)
      ├── Danger Guard (高危命令拦截)
      ├── Context 压缩 (TOON 编码大输出)
      ├── AGENT.md 注入
      ├── Session Store (持久化 + resume)
      └── MCP Loader (spawn 子进程, JSON-RPC stdio)
           ├── exec / fs / fs-edit / grep / web (内置)
           └── ... (config 中声明的任意 MCP)
```

## 开发

```bash
npm run dev              # tsx watch
npm test                 # node --test
npm run e2e              # bash test/e2e.sh
npm run visual           # Playwright 视觉回归
```

## 安全提示

> 本工具将 shell 执行和文件系统读写能力直接交给 LLM，无沙箱隔离。Danger Guard 只是兜底，不是边界。仅在受信环境中使用。

## License

MIT
