# Debug Orchestrator

Cross-repo debugging toolkit for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Diagnoses and fixes bugs that span frontend and backend repositories.

## How it works

You describe a bug. The orchestrator maps the backend (via a pre-built code index
served through MCP), analyzes the frontend (via a sub-agent), diagnoses the root
cause, creates a fix plan, and executes it across both repos. You confirm at
three hard stops: after analysis, after diagnosis, and before execution.

### Why this exists

Cross-repo bugs are hard to debug with Claude Code because frontend and backend
live in separate repositories. Claude Code sees one repo at a time. This orchestrator
sits in a third repo, queries the backend through MCP tools, and sends sub-agents
into the frontend, coordinating both sides without opening either repo directly.

### Backend code index

The orchestrator never reads backend source files. Instead, a builder script runs
once and indexes every endpoint: route, HTTP method, handler file, schema fields,
Prisma model usage. An MCP server serves that index as searchable tools. When the
orchestrator needs to find what handles `GET /stations?region=...`, it calls
`search_backend_routes("stations")` and gets the handler, its source file, and
database operations in one response. No file scanning. No token costs.

| Layer | Generic? | Purpose |
|-------|----------|---------|
| **Builder** | No | Scans backend source code, produces `.code-index/` JSON |
| **MCP server** | Yes | Reads `.code-index/`, exposes search tools to Claude Code |
| **Orchestrator** | Yes | Calls MCP tools, spawns sub-agents, applies fixes |

You write (or generate) a builder for your backend framework. Everything else is generic.

### Token cost breakdown

The only phase that scans source code is frontend analysis — Scout (Sonnet) reads
the relevant components. This cost is reduced further if a `CLAUDE.md` profile
exists in the frontend repo, since Scout can jump directly to the right files
instead of exploring the codebase.

Backend mapping has **zero model cost**. It queries the code index through MCP tools,
no LLM involved. Diagnosis and planning (Cartographer, Architect) work from
compact briefs, not source code. Execution (Workers) receives one step block per
sub-agent.

The most expensive model call is the Architect (Opus), which plans the fix. It
spawns as a sub-agent with a fresh context window containing only the bug
description, the diagnosis, and the identified source files, not the full
conversation history. Opus sees a narrow, focused input.

```
Backend mapping      → MCP tool calls, no model cost
Frontend analysis    → Sonnet, reads source code (one-time scan)
Diagnosis            → Sonnet, works from briefs (~2k tokens input)
Fix planning         → Opus, works from briefs + diagnosis (~3k tokens input)
Execution per step   → Haiku, one step block (~500 tokens input)
```

### Escalation ladder

Execution starts with Worker (Haiku), the cheapest model. Most steps are mechanical
edits that succeed at this tier. When a Worker fails, you choose: retry with Fixer
(Sonnet, handles shifted line numbers), retry with Specialist (Opus, applies
judgment), have the Architect rewrite the step, or skip it. The orchestrator never
auto-escalates — you decide whether a failure is worth retrying with a more
expensive model.

## Quick start

### 1. Run setup

Open Claude Code **in this repo** and run the skill:

```
/setup
```

The setup command will:
- Ask for your frontend repo path and app directories
- Offer to generate a frontend profile in `CLAUDE.md` (route map, service layer summary) — appends to your existing file if one exists
- Ask for your backend repo path and service package
- Scaffold the MCP server into your backend if needed
- Help you create a builder script (or copy the Azure Functions template)
- Generate `debug-config.json` and `.mcp.json`

### 2. Restart and debug

After setup, restart your Claude Code session (still in this repo). Then:

```
/start
```

Describe a bug and the orchestrator handles the rest: maps the backend, analyzes the frontend, diagnoses, plans, and fixes — across both repos.

## Sub-agents

The orchestrator delegates work to specialized agents, each optimized for its task:

| Agent | Model | Role |
|-------|-------|------|
| **Scout** | Sonnet | Analyzes frontend code, returns compact brief |
| **Cartographer** | Sonnet | Maps code structure, diagnoses root cause |
| **Architect** | Opus | Creates fix plans with exact before/after edits |
| **Worker** | Haiku | Applies plan steps mechanically (zero judgment) |
| **Fixer** | Sonnet | Retries failed steps with drift tolerance |
| **Specialist** | Opus | Last-resort executor with full reasoning |
| **Guide** | Sonnet | Helps create builder scripts for new backends |
| **Profiler** | Sonnet | Generates frontend profile for CLAUDE.md |

## Project structure

```
debug-orchestrator/
├── .claude/commands/
│   ├── setup.md              # /setup — configure frontend + backend
│   └── start.md              # /start — 9-phase debug orchestrator
├── agents/
│   ├── cartographer.md       # Diagnoses bugs
│   ├── architect.md          # Creates fix plans
│   ├── worker.md             # Executes steps (Haiku)
│   ├── fixer.md              # Retries with drift tolerance
│   ├── specialist.md         # Last-resort executor (Opus)
│   ├── scout.md              # Analyzes frontend code
│   ├── guide.md              # Helps create builders
│   └── profiler.md           # Generates frontend profile
├── scripts/
│   ├── mcp-server.ts         # Generic MCP server
│   └── builders/
│       └── azure-functions.ts # Reference builder
├── docs/
│   ├── architecture.md       # How it all works
│   └── writing-a-builder.md  # Custom builder guide
├── debug-config.json         # Generated by /setup (gitignored)
└── .mcp.json                 # Generated by /setup (gitignored)
```

## Observability

This project is the reference use case for [AI Agent Observer](https://github.com/gusrodriguez/ai-agent-observer), a standalone observability toolkit I also built for tracing multi-agent workflows.

The integration is kept external to the orchestrator:

* `.mcp.json` registers the observer's MCP server.
* `start.md` references its reusable tracing protocol.

This allows the observer to capture agent calls, escalations, human checkpoints, token usage, and cost without SDK imports or application code changes. The integration is optional; the orchestrator continues normally when the observer is unavailable.

See the [AI Agent Observer repository](https://github.com/gusrodriguez/ai-agent-observer) for setup instructions, architecture, tracing tools, and dashboard documentation.
