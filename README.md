# my-agent

本地模型驱动的 CLI Agent，支持动态注入 MCP 工具。

## 功能

- **本地模型** — 兼容任何 OpenAI API 接口（lmStudio、ollama、vLLM 等）
- **动态 MCP 注入** — 配置文件声明 MCP Server，启动时自动发现工具
- **内置工具**
  - `exec` — 命令行执行
  - `fs` — 文件读写
- **自驱动 Task 栈** — 模型自主拆解任务，LIFO 栈驱动逐个执行
- **全局 CLI** — `ma` 命令全局可用，任意目录直接启动

## 快速开始

```bash
git clone git@github.com:zhuqingyv/my-agent.git
cd my-agent
npm install

# 一条命令完成配置（自动写入全局配置 + 安装 ma 命令）
npm run init -- http://localhost:1234 qwen/qwen3.6-35b-a3b

# 启动
ma
```

> `npm run init` 会自动补全 `/v1` 后缀，检测并安装全局 `ma` 命令。

## 配置

配置分两层，深度合并（项目级覆盖全局）：

### 全局配置 `~/.my-agent/config.json`

`npm run init` 自动生成，存放模型信息和内置 MCP：

```json
{
  "model": {
    "baseURL": "http://localhost:1234/v1",
    "model": "qwen/qwen3.6-35b-a3b",
    "apiKey": "lm-studio"
  },
  "mcpServers": {
    "exec": { "command": "/绝对路径/node_modules/.bin/tsx", "args": ["/绝对路径/src/mcp-servers/exec.ts"] },
    "fs": { "command": "/绝对路径/node_modules/.bin/tsx", "args": ["/绝对路径/src/mcp-servers/fs.ts"] }
  }
}
```

### 项目配置 `./config.json`（可选）

在具体项目目录下放，覆盖或追加 MCP：

```json
{
  "mcpServers": {
    "comm": { "command": "node", "args": ["./your-comm-mcp.js"] }
  },
  "systemPrompt": "你是测试机 agent，收到任务后拉代码跑 E2E。"
}
```

## 交互命令

启动后进入 REPL，支持以下命令：

| 命令 | 说明 |
|------|------|
| `/tools` | 查看所有可用工具 |
| `/stack` | 查看当前 Task 栈 |
| `/abort` | 清空待办 Task |
| `/archive <id>` | 查看某 Task 的完整执行记录 |
| `/clear` | 清空对话历史 |
| `/quit` | 退出 |

## Task 栈机制

模型有一个内置工具 `create_task`，可以自主将复杂任务拆解为多个子任务：

```
用户: 重构 parser 并写单测

模型思考 → create_task("分析 parser 导出") → create_task("重构") → create_task("写单测")

[task] → [t_1] 分析 parser 导出
  ... 执行 ...
[task] ok [t_1] → next: [t_2]
[task] → [t_2] 重构
  ... 执行 ...
[task] ok [t_2] → next: [t_3]
[task] → [t_3] 写单测
  ... 执行 ...
[task] ok [t_3] → (stack empty)
```

- 栈（LIFO）：后入先出，子任务优先完成
- 防重复：每轮注入当前/待办/已完成列表，模型自行判断
- 防爆：maxTasks=50，maxDepth=8
- 折叠：Task 完成后消息折叠为摘要，原始记录可通过 `/archive` 查看

## 架构

```
ma (CLI)
 └── Agent Core (OpenAI SDK, Task 栈驱动 tool-calling loop)
      └── MCP Loader (spawn 子进程, JSON-RPC stdio, 自动发现 tools)
           ├── exec-mcp (内置)
           ├── fs-mcp (内置)
           └── ... (config 中声明的任意 MCP)
```

## 安全提示

> **本工具将 shell 命令执行和文件系统读写能力直接交给 LLM，无沙箱隔离。仅在受信环境中使用。**

## License

MIT
