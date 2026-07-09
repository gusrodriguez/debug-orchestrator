---
description: "Sets up cross-repo debugging. Configures frontend and backend repos, scaffolds MCP server, helps create a builder, and wires up .mcp.json. Run this before /start."
---

# Debug Orchestrator Setup

You are a setup assistant. Follow these steps exactly.

**IMPORTANT: Do NOT call ANY MCP tools (backend_overview, search_backend_routes, etc.)
in Steps 1 through 6. Only read local files with the Read tool. MCP tools are ONLY
allowed in Step 7.**

**IMPORTANT: How to ask questions.**
- For **free-text input** (paths, app aliases, package names): output the question as
  plain text and wait for the user to type their answer. Do NOT use the AskUserQuestion
  tool — it forces option selection which is wrong for free-text.
- For **choices** (yes/no, pick from a list): use the AskUserQuestion tool.

## Step 1 — Detect current state

Use the **Read** tool to read `debug-config.json` at the repo root. Do NOT call any
MCP tools.

Based on what you find:

- **`debug-config.json` does not exist** → go to **Step 2**.
- **`debug-config.json` exists** → read it, then also read `.mcp.json`. Ask the user:

  > Configuration found with backend `<name>` and frontend at `<frontend.repoPath>`.
  > Is the MCP server connected in this session?
  >
  > 1. **Yes** — it's connected, let's debug
  > 2. **No** — I need to restart first
  > 3. **Reconfigure** — I want to change the setup

  - If **Yes** → go to **Step 7**.
  - If **No** → go to **Step 6C**.
  - If **Reconfigure** → go to **Step 2**.

## Step 2 — Configure frontend

Ask the user:

> **What is the path to the frontend repo?**
>
> Open a terminal in the frontend repo's root folder and run **`pwd`**, then paste
> the output here.

Validate the path exists using Bash. Remove any trailing slash.

Then ask:

> **Which frontend apps are in this repo?**
>
> For each app, provide an alias and its path within the repo.
>
> **Example:**
> ```
> ground-audits = apps/ground-audits-admin
> turnaround = apps/turnaround-inspection
> ```

Validate that each path exists within the frontend repo using Bash.

## Step 2B — Frontend profile (CLAUDE.md)

Check if `<frontend-repo-path>/CLAUDE.md` exists using Bash.

### If CLAUDE.md exists

Read it. Check if it already contains the section header
`## Debug Orchestrator — Frontend Profile`.

- **Section exists** → tell the user: `Frontend profile found in CLAUDE.md. Using it.`
  Skip to Step 3.

- **Section does not exist** → tell the user:

  > Your frontend repo has a `CLAUDE.md` file. I can add a **Debug Orchestrator**
  > section with a route map and service layer summary. This helps the Scout agent
  > jump directly to relevant files instead of scanning the whole codebase — saving
  > tokens and improving accuracy.
  >
  > The section will be **appended** to your existing file, clearly delimited. Your
  > current content will not be modified.
  >
  > 1. **Yes, generate and append** — I'll scan the frontend and add the section
  > 2. **Skip** — I'll skip this for now (you can add it later)

  - If **1 (Generate):** Spawn the **Profiler** agent. Read `agents/profiler.md` from
    this repo, extract the body after frontmatter, and spawn a Task (model: sonnet)
    with:
    - The Profiler instructions
    - Frontend repo path
    - The apps mapping from Step 2

    Wait for the Profiler to return. **Append** its output to the existing CLAUDE.md
    with a blank line separator. Do NOT modify any existing content in the file.

  - If **2 (Skip):** Continue.

### If CLAUDE.md does not exist

Tell the user:

> No `CLAUDE.md` found in the frontend repo. I can generate one with a route map
> and service layer summary. This helps the Scout agent navigate your codebase
> efficiently when debugging.
>
> 1. **Yes, generate it** — I'll scan the frontend and create CLAUDE.md
> 2. **Skip** — I'll skip this (the Scout will explore the codebase manually)

- If **1 (Generate):** Spawn the **Profiler** agent (same as above). Write its output
  as a new `CLAUDE.md` at `<frontend-repo-path>/CLAUDE.md`.

- If **2 (Skip):** Continue.

## Step 3 — Configure backends

### Step 3A — Backend repo path

Ask the user:

> **What is the path to the backend repo?**
>
> Open a terminal in the backend repo's root folder and run **`pwd`**, then paste the
> output here.

Validate the path exists using Bash. Remove any trailing slash.

### Step 3B — Package path

Ask the user:

> **What is the package path within the repo?**
>
> This is the folder containing the service's source code, relative to the repo root.
>
> **Example:** `packages/form-engine-service`

Validate that `<repo-path>/<package-path>` exists using Bash.

Derive the service name from the package path (last segment):
- `packages/form-engine-service` → `form-engine-service`
- `packages/my-api` → `my-api`

Derive the repo name from the repo path (last segment):
- `/Users/gustav/Documents/p/sas/adg-reports` → `adg-reports`

### Step 3C — Check for MCP server

Check if `<repo-path>/<package-path>/scripts/mcp-server.ts` exists using Bash.

- **Exists** → tell the user: `MCP server found at <path>. Using it.`
- **Does not exist** → tell the user:

  > No MCP server found. I'll create one from the template.

  Read the MCP server template from this repo at `scripts/mcp-server.ts` and copy it
  to `<repo-path>/<package-path>/scripts/mcp-server.ts`. Create the `scripts/`
  directory if it does not exist.

### Step 3D — Check for builder

Check if any builder script exists at `<repo-path>/<package-path>/scripts/builders/`
or at `<repo-path>/<package-path>/scripts/*build-index*` or
`<repo-path>/<package-path>/scripts/*build*index*` using Bash/Glob.

- **Found** → ask the user to confirm which builder to use and its framework name.
  Record the builder path relative to the repo root.

- **Not found** → offer choices:

  > **No builder found.** The builder is the only framework-specific part — it scans
  > your source code and produces a `.code-index/` that the MCP server reads.
  >
  > 1. **Azure Functions + Prisma** — copy the reference builder (works if your backend
  >    uses Azure Functions in `src/functions/` and Prisma)
  > 2. **Create with Guide** — I'll inspect your code and help you write a builder
  > 3. **Custom placeholder** — create a minimal placeholder you'll fill in yourself

  - If **1 (Azure Functions):** Read `scripts/builders/azure-functions.ts` from this
    repo and copy it to `<repo-path>/<package-path>/scripts/builders/azure-functions.ts`.
    Create the `scripts/builders/` directory if needed. Builder name = `azure-functions`.

  - If **2 (Create with Guide):** Spawn a sub-agent using the Guide agent instructions.
    Read `agents/guide.md` from this repo, extract the body after frontmatter, and
    spawn a Task (model: sonnet) with:
    - The Guide instructions
    - Backend repo path: `<repo-path>`
    - Package path: `<package-path>`
    - Reference builder path: the absolute path to `scripts/builders/azure-functions.ts`
      in this repo

    Wait for the Guide to finish. It will create the builder and report its location.
    Record the builder path and framework name.

  - If **3 (Custom placeholder):** Create a minimal builder at
    `<repo-path>/<package-path>/scripts/builders/custom.ts`:

    ```typescript
    import { mkdirSync, writeFileSync } from 'node:fs';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';

    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    const packageRoot = path.resolve(scriptDir, '..', '..');
    const outputDir = path.join(packageRoot, '.code-index');

    mkdirSync(outputDir, { recursive: true });

    // TODO: Implement your custom builder here.
    // Scan your source code and produce the following files in .code-index/:
    //
    // manifest.json    — package info + endpoint list with route/method/trigger
    // functions/<name>.json — per-endpoint detail (handler, schema, database usage)
    // prisma-models.json   — database models with fields and relations (or [])
    // overview.md      — human-readable summary
    //
    // See the azure-functions builder for a reference implementation.

    const manifest = {
      schemaVersion: 1,
      package: '<service-name>',
      version: '0.0.0',
      root: packageRoot,
      summary: { functions: 0, prismaModels: 0, sourceFiles: 0 },
      files: { overview: 'overview.md', functions: 'functions.json', prismaModels: 'prisma-models.json' },
      functions: [],
    };

    writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    writeFileSync(path.join(outputDir, 'functions.json'), '[]');
    writeFileSync(path.join(outputDir, 'prisma-models.json'), '[]');
    writeFileSync(path.join(outputDir, 'overview.md'), '# Code Index\n\nNo endpoints indexed yet.\n');

    console.log('Placeholder code index created. Edit this file to scan your source code.');
    ```

    Replace `<service-name>` with the actual service name. Builder name = `custom`.

    Tell the user:

    > A placeholder builder has been created. It produces an empty code index. Edit
    > `scripts/builders/custom.ts` to scan your service's source code.

### Step 3E — Check dependencies

Check if the required packages exist in the backend repo:

```bash
ls <repo-path>/node_modules/@modelcontextprotocol/sdk 2>/dev/null
ls <repo-path>/node_modules/zod 2>/dev/null
ls <repo-path>/node_modules/tsx 2>/dev/null
```

If any are missing, tell the user:

> The MCP server requires these dependencies. Run in the backend repo:
>
> ```bash
> yarn add -D @modelcontextprotocol/sdk zod tsx
> ```

### Step 3F — Add another backend?

Ask:

> **Do you want to add another backend service?**
>
> 1. **Yes** — add another backend
> 2. **No** — done, continue with setup

If yes, repeat from Step 3A. If no, continue.

## Step 4 — Write debug-config.json

Write `debug-config.json` to **this repo's root** (the debug-orchestrator repo):

```json
{
  "frontend": {
    "repoPath": "<absolute-frontend-repo-path>",
    "apps": {
      "<alias>": "<app-path>",
      ...
    }
  },
  "backends": [
    {
      "name": "<service-name>",
      "repo": "<repo-name>",
      "repoPath": "<absolute-repo-path>",
      "packagePath": "<package-path>",
      "mcpScript": "<package-path>/scripts/mcp-server.ts",
      "builder": {
        "name": "<builder-name>",
        "script": "<package-path>/scripts/builders/<builder-name>.ts"
      }
    }
  ]
}
```

Adjust `builder.script` if the builder was found at a non-standard location (e.g.,
`scripts/azure-functions-build-index.ts` instead of `scripts/builders/azure-functions.ts`).

## Step 5 — Write .mcp.json

Write `.mcp.json` at **this repo's root**. Generate one entry per backend:

```json
{
  "mcpServers": {
    "<name>": {
      "type": "stdio",
      "command": "<repoPath>/node_modules/.bin/tsx",
      "args": [
        "<repoPath>/<mcpScript>"
      ],
      "env": {
        "SERVICE_NAME": "<name>",
        "BUILD_SCRIPT": "<repoPath>/<builder.script>",
        "BACKEND_REPO_PATH": "<repoPath>",
        "PACKAGE_ROOT": "<repoPath>/<packagePath>"
      }
    }
  }
}
```

Then proceed to **Step 5C**.

## Step 5C — Restart required

Tell the user:

> **Setup complete.** The following has been configured:
>
> **Frontend:** `<frontend.repoPath>`
> **Apps:** <list of aliases and paths>
>
> | Service | Repo | Builder |
> |---------|------|---------|
> | `<name>` | `<repo>` | `<builder.name>` |
>
> The MCP server activates when Claude Code starts, so you need to **restart your
> session**.
>
> Close this session and start a new one, then run:
>
> ```
> /start
> ```
>
> On first launch, Claude Code will ask you to approve the MCP server — accept it.

**STOP here.** Do not continue. The MCP tools are not available in this session.

## Step 7 — Connected — show summary and start

**Now** call the `backend_overview` MCP tool to get service details.

Read `debug-config.json` to get the frontend and backend info.

Present:

> **Frontend:** `<frontend.repoPath>`
> **Apps:** <list of aliases and paths>
>
> **Active backend:** `<name>` (repo: `<repo>`)
> **Builder:** `<builder.name>`
> **Index:** <function count> functions, <model count> Prisma models
>
> **What would you like to do?**
>
> 1. **Debug a bug** — describe the issue and I'll start the orchestrator
> 2. **Reconfigure** — change the frontend, backend, or app settings

**Wait for the user's choice.**

- If the user picks **1** or describes a bug → read the start command from
  `.claude/commands/start.md` and follow its workflow from **Phase 0**.
- If the user picks **2** → go to **Step 2**.

**STOP here and wait for the user's response.**
