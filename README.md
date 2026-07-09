# Debug Orchestrator

Cross-repo debugging toolkit for Claude Code. Diagnoses and fixes bugs that span frontend and backend repositories.

## How it works

The system has three layers:

| Layer | Generic? | Purpose |
|-------|----------|---------|
| **Builder** | No | Scans backend source code, produces `.code-index/` JSON |
| **MCP server** | Yes | Reads `.code-index/`, exposes search tools to Claude Code |
| **Orchestrator** | Yes | Calls MCP tools, spawns sub-agents, applies fixes |

You write (or generate) a builder for your backend framework. Everything else is generic.

## Quick start

### 1. Clone this repo

```bash
git clone <repo-url> /path/to/debug-orchestrator
```

### 2. Link commands into your frontend repo

```bash
cd your-frontend-repo
ln -s /path/to/debug-orchestrator/commands .claude/commands/debug-orchestrator
```

### 3. Run setup

Open Claude Code in your frontend repo and run:

```
/debug-orchestrator/setup
```

The setup command will:
- Ask for your frontend app paths and backend repo location
- Scaffold the MCP server into your backend if needed
- Help you create a builder script (or copy the Azure Functions template)
- Generate `.mcp.json` and `debug-config.json`

### 4. Restart and debug

After setup, restart your Claude Code session. Then:

```
/debug-orchestrator/start
```

Describe a bug and the orchestrator handles the rest: maps the backend, analyzes the frontend, diagnoses, plans, and fixes.

## Sub-agents

| Agent | Model | Role |
|-------|-------|------|
| Scout | Sonnet | Analyzes frontend code, returns compact brief |
| Cartographer | Sonnet | Maps code structure, diagnoses bugs |
| Architect | Opus | Creates detailed fix plans with exact edits |
| Worker | Haiku | Applies plan steps mechanically |
| Fixer | Sonnet | Retries failed steps with drift tolerance |
| Specialist | Opus | Last-resort executor with full reasoning |
| Guide | Sonnet | Helps create builder scripts for new backends |

## Documentation

- [Architecture](docs/architecture.md) — how the system works end-to-end
- [Writing a builder](docs/writing-a-builder.md) — how to create a builder for your backend framework
