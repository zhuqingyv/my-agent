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
    "baseURL": "http://localhost:11434/v1",
    "model": "qwen2.5",
    "apiKey": "ollama"
  },
  "mcpServers": {
    "exec": {
      "command": "node",
      "args": ["./mcp-servers/exec.js"]
    },
    "fs": {
      "command": "node",
      "args": ["./mcp-servers/fs.js"]
    }
  }
}
```

## Usage

```bash
# Start interactive chat with default config
my-agent chat

# Specify config file
my-agent chat --config ./config.json
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
