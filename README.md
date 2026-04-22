# my-agent

CLI agent tool with local model support and dynamic MCP injection.

## Features

- **OpenAI SDK** — compatible with any OpenAI-API-compatible endpoint (ollama, vLLM, etc.)
- **Local Model Support** — configurable baseURL and model via config file
- **Dynamic MCP Injection** — load MCP servers from config, auto-discover tools for agent
- **Built-in MCP Servers**
  - `exec` — command line execution
  - `fs` — file read/write

## Config

```jsonc
// config.json
{
  "model": {
    "baseURL": "http://localhost:1234/v1",
    "model": "qwen3-30b-a3b",
    "apiKey": "lm-studio"
  },
  "mcpServers": {
    "exec": {
      "command": "tsx",
      "args": ["src/mcp-servers/exec.ts"]
    },
    "fs": {
      "command": "tsx",
      "args": ["src/mcp-servers/fs.ts"]
    }
  },
  "systemPrompt": "You are a helpful assistant. You can execute commands and read/write files using the available tools."
}
```

> Note: `model.model` must match the model name currently loaded in LM Studio. Open LM Studio, check the loaded model's identifier, and update this field accordingly.

## Usage

```bash
# Start interactive chat (uses ./config.json by default)
npm start

# Or run the CLI directly via tsx
npx tsx src/cli.ts chat

# Specify a custom config file
npx tsx src/cli.ts chat --config ./config.json
```

## Architecture

```
CLI (commander)
 └── Agent Core (OpenAI SDK, tool-calling loop)
      └── MCP Loader (spawn MCP servers, discover tools, bridge to OpenAI function calling)
           ├── exec-mcp (built-in)
           ├── fs-mcp (built-in)
           └── ... (any MCP from config)
```

## License

MIT
