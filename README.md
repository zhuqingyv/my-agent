# MA

**English** | [中文](README.zh-CN.md)

Local-first multi-model coding agent for your terminal.

MA is built for developers who switch between local models and remote APIs, work inside real repositories, and want a terminal agent that is pleasant to configure instead of painful to babysit.

`v0.1.0-alpha` supports LM Studio local models and DeepSeek official API today. More OpenAI-compatible providers are next.

Website: https://zhuqingyv.github.io/my-agent/  
Release: https://github.com/zhuqingyv/my-agent/releases/tag/v0.1.0-alpha

## Why MA

- **Multi-model by default**: LM Studio local models plus DeepSeek profiles; switch with `/model`.
- **Good setup UX**: `ma init` is interactive, discovers models, and writes a usable config.
- **Secure remote keys**: DeepSeek API keys are stored in macOS Keychain; config stores only `secretRef`.
- **Real project tools**: built-in MCP tools for shell, files, structured edits, grep, and web.
- **Keyboard-first TUI**: slash command suggestions, Tab completion, sessions, revert, and model picker.
- **Local instructions**: reads `AGENT.md` from your project and global config.
- **Skills**: project-local `.ma/skills/*.md` commands with YAML frontmatter.

## Benchmark

MA passes its alpha L0-L2 internal benchmark with a local Qwen3-30B model through LM Studio:

| Model | Runtime | Tasks | L0 | L1 | L2 |
| --- | --- | ---: | ---: | ---: | ---: |
| Qwen3-30B local | LM Studio | 70 | 100% | 98.7% | 95.3% |

This benchmark covers connectivity, stable tool use, and multi-turn local project work. It is a release gate for MA's local-agent loop, not a universal coding-agent leaderboard.

See [docs/benchmark-results.md](docs/benchmark-results.md).

## Install

### Portable bundle

Download the release asset for your platform:

- `ma-*-macos-arm64.tar.gz`
- `ma-*-linux-x64.tar.gz`
- `ma-*-windows-x64.zip`

macOS / Linux:

```bash
tar -xzf ma-*.tar.gz
cd ma-*
./ma init
./ma
```

Windows:

```powershell
Expand-Archive ma-*.zip
cd ma-*
.\ma.cmd init
.\ma.cmd
```

The portable bundle includes Node.js and production dependencies. No global Node or npm install is required.

### From source

```bash
git clone https://github.com/zhuqingyv/my-agent.git
cd my-agent
npm install
npm run build
npm link
ma init
ma
```

## Quick Start

```bash
ma init
ma
```

During init:

1. Choose model source: LM Studio local or DeepSeek official.
2. Enter base URL if needed.
3. Enter API key for remote providers.
4. Pick a discovered model with arrow keys.

Inside MA:

```text
/          show slash command suggestions
/model     switch model/profile with arrow keys
Tab        complete selected command
Enter      run selected slash command
ESC ESC    switch session
```

## Commands

User-facing slash commands:

| Command | Purpose |
| --- | --- |
| `/model` | Open the model/profile picker |
| `/help` | Show user-facing commands |
| `/clear` | Clear current conversation |
| `/exit` | Exit MA |

CLI commands:

```bash
ma                         # chat
ma chat --resume           # resume latest session
ma chat --resume <id>      # resume specific session
ma sessions                # list sessions
ma profiles                # list model profiles
ma profile use <profile>   # set default profile
ma secrets list            # list secure credentials
ma secrets view <id>       # view masked key after system auth
ma secrets delete <id>     # delete key after system auth
ma secrets repair <id>     # repair macOS Keychain trusted access
ma init                    # interactive setup
ma version
```

## Model Profiles

MA separates credentials from model profiles.

Example model ids:

```text
LMStudio-local/qwen/qwen3.6-27b
DeepSeek/deepseek-v4-flash
```

`/model` aggregates models from configured providers, prefixes them by credential/provider name, and remembers the last selected profile.

## Built-In Tools

MA starts with built-in MCP servers:

- `exec`: shell command execution with danger guard
- `fs`: file read/write
- `fs-edit`: structured file edits
- `grep`: code/text search
- `web`: DuckDuckGo search and web fetch with curl fallback

## Skills

Create `.ma/skills/deploy.md`:

```markdown
---
name: deploy
description: Deploy this project
arguments:
  - name: environment
    description: Target environment
    required: false
    default: staging
---

Deploy this project to {{environment}}.
Run tests first, build, deploy, then verify.
```

Use it:

```text
/deploy environment=production
```

Skills appear in slash command suggestions unless they conflict with a built-in command.

## Configuration

Global config:

```text
~/.my-agent/config.json
```

Project config:

```text
./config.json
```

Project config overrides global config. `AGENT.md` files are loaded from the current directory upward, plus `~/.my-agent/AGENT.md`.

## Security

MA can run shell commands and edit files. Use it in trusted workspaces.

Current safeguards:

- dangerous shell command confirmation
- macOS Keychain for remote API keys
- explicit `ma secrets view/delete` authentication
- session-local runtime secret loading for unattended agent work

Known alpha boundary: the current Keychain helper is good enough for local alpha use, but stricter process-level trust would require a signed helper/ACL design.

## Development

```bash
npm run dev
npm test
npm run build
npm run release:check
```

## License

MIT
