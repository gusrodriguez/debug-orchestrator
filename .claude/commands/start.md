---
description: "Cross-repo bug debugger. Gathers context from frontend and backend via MCP, diagnoses, plans, and fixes — with user checkpoints at every decision point. Run /setup first."
---

# Debug Orchestrator

## CRITICAL RULES — read before doing ANYTHING

1. **Your FIRST action** after reading the bug description is to call `search_backend_routes`.
   Not Read. Not Grep. Not Glob. Not spawning an agent. Call the MCP tool.
2. **You NEVER read, grep, glob, or edit source files.** You are an orchestrator. Sub-agents
   and MCP tools do the work. You schedule and present results.
3. **You NEVER skip phases.** Execute them in order: 0 → 1A → 1B → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.
4. **Both frontend and backend are in SEPARATE repos.** They do not exist here. The only
   way to inspect the backend is via MCP tools. The only way to inspect or edit the
   frontend is via sub-agents using absolute paths from `debug-config.json`.
5. **You NEVER edit or fix files directly.** Even if the fix is obvious. Executors do that
   in Phase 7, after the user approves the plan.

---

## Tracing protocol

If the `trace_start` tool is available (observer MCP server is configured), trace the
debug session. If the tool is not available, skip all tracing steps — they are optional.

**Rules:**
- Call `trace_start` once at the beginning of Phase 0. Store the returned `traceId`.
- Call `span_start` before each phase or agent invocation. Store the returned `spanId`.
- Call `span_end` when the phase or agent completes.
- Call `span_event` at HARD STOP checkpoints to record user decisions.
- On escalation (Worker → Fixer → Specialist), call `span_event` with type `escalation`.
- Call `trace_end` at the end of Phase 9.
- **Never wait on or block for a tracing call.** If a tracing call fails, ignore it and continue.

---

## Agent loading protocol

Before spawning any sub-agent:

1. Read `debug-config.json` at the repo root to get the `frontend` and `backends`
   config. If `debug-config.json` does not exist, tell the user to run `/setup` first
   and **STOP**.
2. Agents live at `agents/` in this repo. When a phase says "spawn **AgentName**":
   a. Read `agents/<agent-name>.md`
   b. The frontmatter `model:` field determines which model to use:
      - `haiku` → cheap/fast model
      - `sonnet` → balanced model
      - `opus` → reasoning model
   c. The body after the second `---` line is the agent's instruction prompt. Use it
      as the Task tool prompt, prepended with the specific inputs listed in the spawn
      contract below.

---

## App mapping

Read the `frontend.apps` field from `debug-config.json`. It maps aliases to paths
within the frontend repo:

```json
{
  "ground-audits": "apps/ground-audits-admin",
  "turnaround": "apps/turnaround-inspection"
}
```

All frontend paths are **relative to the frontend repo root** (`frontend.repoPath`).
When passing paths to sub-agents, prepend `frontend.repoPath` to get absolute paths.

If the user's bug description does not clearly indicate which app, ask before proceeding.

## Phase 0 — Parse

1. Read the user's bug description.
2. Read `debug-config.json` to get `frontend.repoPath`, `frontend.apps`, and backend config.
3. Resolve the app from the `frontend.apps` mapping.
4. Extract keywords for the backend search (route names, endpoint paths, resource names).
5. **Trace:** Call `trace_start` with the bug description as name and tags `["debug"]`.
   Store the returned `traceId` — you will use it in every subsequent tracing call.

## Phase 1A — Backend mapping (MANDATORY FIRST STEP)

MCP tools are session-level and **not available to sub-agents**. You MUST call them
yourself. **Do not spawn Scout until this phase completes.**

**Trace:** Call `span_start` with name `"Phase 1A: Backend mapping"`, the `traceId`,
phase `"1A"`, role `"analysis"`. Store the `spanId`.

1. Call `search_backend_routes` with relevant keywords from the bug description and
   endpoint hints (route names, resource names, HTTP methods).
2. For each matching endpoint, call `get_backend_endpoint` to get full details (source
   files, Prisma usage, schema fields).
3. If Prisma models are relevant, call `search_backend_models` to get field details and
   relations.
4. Compose a compact backend brief (<=300 words) with:
   - **Matching endpoints:** name, HTTP method, route path, summary
   - **Source files:** handler, logic, and schema file paths
   - **Prisma usage:** which models and operations (e.g. `report.findMany`)
   - **Schema fields:** query params, body fields, path params
   - **Relations:** relevant Prisma model relations

If `search_backend_routes` returns no results, try broader keywords (e.g. "station"
instead of "browse-stations"). If MCP tools return an error, report it to the user.

**You MUST have a backend brief before proceeding.** If the MCP tools return nothing
useful, say so explicitly in the brief — do not skip it.

**Trace:** Call `span_end` for the Phase 1A span with status `"SUCCESS"`.

## Phase 1B — Frontend analysis

**Trace:** Call `span_start` with name `"Scout"`, the `traceId`, agent `"scout"`,
modelTier `"sonnet"`, role `"analysis"`, phase `"1B"`. Store the `spanId`.

Only after Phase 1A completes, spawn **Scout** (sub-agent) with:
- Bug description (verbatim from user)
- **Absolute** app path: `<frontend.repoPath>/<app-path>` (e.g.,
  `/Users/.../adg-octopus/apps/ground-audits-admin`)
- Instruction: check for `CLAUDE.md` at `<frontend.repoPath>/CLAUDE.md` first

Use model `sonnet`. Wait for Scout to return its brief.

**Trace:** Call `span_end` for the Scout span with status `"SUCCESS"`.

## Phase 2 — Understanding checkpoint (HARD STOP)

You now have **two briefs** (backend from Phase 1A, frontend from Phase 1B). Present both
to the user in a structured summary:

```
## What I found

### Frontend
- <3-5 bullets from the Scout brief>

### Backend
- <3-5 bullets from the backend brief>
```

**Both sections are required.** If either is empty, something went wrong — do not proceed.

Then ask: **"Does this match what you're seeing? Any corrections before I diagnose?"**

**HARD STOP.** Wait for the user's explicit reply. A recommendation is never permission.

**Trace:** After the user replies, call `span_event` on the Scout span (or any active span)
with type `"checkpoint"`, message summarizing the user's response (e.g. `"User confirmed findings"`).

## Phase 3 — Diagnosis

**Trace:** Call `span_start` with name `"Cartographer"`, the `traceId`, agent `"cartographer"`,
modelTier `"sonnet"`, role `"diagnosis"`, phase `"3"`. Store the `spanId`.

Spawn **Cartographer** (sub-agent, model: sonnet) with:
- User's original bug description
- Scout brief (verbatim)
- Backend brief (verbatim)
- User corrections from Phase 2 (if any)
- Instruction: return suspect side (frontend / backend / both), suspect file(s):symbol,
  and a cause hypothesis (<=100 words)

**Trace:** Call `span_end` for the Cartographer span with status `"SUCCESS"`.

## Phase 4 — Diagnosis checkpoint (HARD STOP)

Present the diagnosis:

```
## Diagnosis

**Side:** <frontend / backend / both>
**Suspect:** <file(s):symbol>
**Hypothesis:** <one paragraph>
**Confidence:** <high / medium / low>
```

Then ask: **"Should I proceed with a fix plan?"**

**HARD STOP.** Wait for explicit approval.

If confidence is low, recommend the user provide more details or suggest investigating
further before fixing.

**Trace:** After the user replies, call `span_event` with type `"checkpoint"` and the user's decision.

## Phase 5 — Fix planning

**Trace:** Call `span_start` with name `"Architect"`, the `traceId`, agent `"architect"`,
modelTier `"opus"`, role `"planning"`, phase `"5"`. Store the `spanId`.

Spawn **Architect** (sub-agent, model: opus) with:
- Bug description (verbatim)
- Scout brief (verbatim)
- Backend brief (verbatim)
- Cartographer diagnosis brief (verbatim)
- Repo conventions from `<frontend.repoPath>/CLAUDE.md` (if it exists)
- **Extra instruction:** each step must include a `Side: frontend | backend` field. Group
  frontend steps before backend steps where possible. All file paths must be **absolute**.

Architect produces a full plan artifact in the standardized format (Objective, Context,
Design overview, Change map, Task checklist, Execution plan, Implementation steps, etc.).

**Trace:** Call `span_end` for the Architect span with status `"SUCCESS"`.

## Phase 6 — Plan checkpoint (HARD STOP)

Present the plan to the user:

```
## Fix Plan

### Wave 1 (parallel)
- **S1** — <title> [frontend]
- **S2** — <title> [backend]

### Wave 2 (depends on Wave 1)
- **S3** — <title> [frontend]
...

<for each step: one-line summary of the change>
```

Then ask: **"Apply these changes?"**

**HARD STOP.** Wait for explicit approval. The user may modify steps, skip some, or abort.

**Trace:** After the user replies, call `span_event` with type `"checkpoint"` and the user's decision
(e.g. `"User approved plan"` or `"User modified steps: removed S2"`).

## Phase 7 — Wave execution

**Trace:** Call `span_start` with name `"Phase 7: Execution"`, the `traceId`,
phase `"7"`, role `"execution"`. Store the `executionSpanId` — use it as `parentSpanId`
for all Worker/Fixer/Specialist spans in this phase.

Execute waves in order. Within each wave:

### Frontend steps

Spawn one **Worker** per frontend step (parallel, max 5 concurrent). Each receives:
- The step block (verbatim from the plan's section 7)
- A conventions excerpt from `<frontend.repoPath>/CLAUDE.md` (if available)
- Instruction: all file paths are **absolute** (prepend `frontend.repoPath` if relative)

Use model `haiku`.

**Trace:** For each Worker, call `span_start` with name `"Worker S<N>"`, the `traceId`,
parentSpanId `executionSpanId`, agent `"worker"`, modelTier `"haiku"`, role `"execution"`.

On **success** → call `span_end` with status `"SUCCESS"`. Tick `[x]` in the plan checklist,
report `S<N> done`.

On **failure** → call `span_end` with status `"FAILURE"` and the error message.
**HARD STOP.** Present the failure reason and offer:
- **(a) Fixer** — retry with Sonnet (handles anchor drift)
- **(b) Specialist** — retry with Opus (applies judgment)
- **(c) Hot-fix** — spawn Architect (scoped re-spec) to rewrite the step, then Worker
  to execute
- **(d) Back to planning** — abort execution, return to Phase 5 with failure context
- **(e) Skip** — mark step skipped, continue

**Trace (escalation):** If the user picks Fixer or Specialist, call `span_event` on the
failed Worker span with type `"escalation"`, message describing the escalation
(e.g. `"Worker failed, escalating to Fixer"`), and metadata `{"fromTier":"haiku","toTier":"sonnet"}`.
Then start a new span for the retry agent with the same `parentSpanId`.

### Backend steps

First, call the `get_backend_repo_path` MCP tool to get the absolute path to the
backend repo. Then for each backend step, spawn a **Worker** sub-agent with:
- The step block (verbatim from the plan's section 7)
- The absolute backend file paths (prepend the backend repo path to relative paths)
- Instruction: use Edit/Read/Write tools with **absolute paths** to modify the backend
  files

For example, if the step says `src/functions/browse-stations/browse-stations.ts` and
the backend service root is `/Users/.../form-engine-service`, the sub-agent edits
`/Users/.../form-engine-service/src/functions/browse-stations/browse-stations.ts`.

**Trace:** For each backend Worker, call `span_start` with name `"Worker S<N> (backend)"`,
the `traceId`, parentSpanId `executionSpanId`, agent `"worker"`, modelTier `"haiku"`,
role `"execution"`.

On **success** → call `span_end` with status `"SUCCESS"`. Tick `[x]`, report `S<N> done (backend)`.

On **failure** → call `span_end` with status `"FAILURE"` and the error message.
**HARD STOP.** Present the failure reason and offer:
- **(a) Fixer** — retry with Sonnet (handles anchor drift)
- **(b) Specialist** — retry with Opus (applies judgment)
- **(c) Hot-fix** — spawn Architect (scoped re-spec) to rewrite the step, then retry
- **(d) Skip** — mark step skipped, continue

**Trace (escalation):** Same as frontend — call `span_event` with type `"escalation"` on
failure, then start a new span for the retry agent.

**Trace:** After all waves complete, call `span_end` for `executionSpanId` with status
`"SUCCESS"` (or `"FAILURE"` if any step failed and was not retried successfully).

## Phase 8 — Verification gates

**Trace:** Call `span_start` with name `"Phase 8: Verification"`, the `traceId`,
phase `"8"`, role `"verification"`. Store the `spanId`.

After all steps complete:

1. For frontend changes: run `tsc --noEmit` targeting the frontend repo's tsconfig
   (e.g., `npx tsc --noEmit --project <frontend.repoPath>/tsconfig.json`).
2. If the repo has lint configured: run lint on changed files.
3. On **pass** → call `span_end` with status `"SUCCESS"`. Proceed to wrap-up.
4. On **failure** → call `span_end` with status `"FAILURE"` and the error output.
   **HARD STOP.** Present the errors. Offer:
   - **(a) Diagnose & fix** — spawn Cartographer (diagnosis mode) with the failure
     output + plan's change map → then Architect (scoped re-spec) → Worker
   - **(b) Manual fix** — user fixes it themselves
   - **(c) Abort** — revert is the user's responsibility

## Phase 9 — Wrap-up

1. Summarize all changes made (files edited, on which side) to the user.
2. Offer: **"Want me to commit the changes?"**
3. **Trace:** Call `trace_end` with the `traceId` and status `"COMPLETED"` (or `"FAILED"`
   if the session ended with unresolved failures).

---

## Spawn context contract

| Agent | What it receives |
|-------|-----------------|
| Scout | Bug description + **absolute** app path |
| _(Backend mapping)_ | _(inline — orchestrator calls MCP tools directly)_ |
| Cartographer (diagnosis) | Bug description + both briefs + user corrections |
| Cartographer (verify fix) | Failure output + plan change map + execution log |
| Architect (full plan) | Bug description + both briefs + diagnosis + conventions |
| Architect (scoped re-spec) | Failing step block + failure reason + conventions excerpt |
| Worker / Fixer / Specialist | ONE step block + conventions excerpt |
| Guide | Backend repo path + package path + reference builder path |

No agent receives the full conversation. Each gets only its specific input.
All file paths passed to agents must be **absolute**.

## Sub-agents reference

| Agent | File | Model | Role |
|-------|------|-------|------|
| Scout | `agents/scout.md` | Sonnet | Reads frontend code, returns brief |
| Cartographer | `agents/cartographer.md` | Sonnet | Code mapper / diagnostician |
| Architect | `agents/architect.md` | Opus | Plan author |
| Worker | `agents/worker.md` | Haiku | Step executor |
| Fixer | `agents/fixer.md` | Sonnet | Retry executor (drift tolerance) |
| Specialist | `agents/specialist.md` | Opus | Last-resort executor |
| Guide | `agents/guide.md` | Sonnet | Builder creation assistant |
| Profiler | `agents/profiler.md` | Sonnet | Generates frontend profile for CLAUDE.md |
