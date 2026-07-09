# Writing a Builder

The builder is the only framework-specific part of the debug orchestrator. It scans your
backend source code and produces a `.code-index/` directory that the generic MCP server
reads.

## What the builder produces

The builder outputs four files in `<package-root>/.code-index/`:

### `manifest.json`

Top-level index with package info, summary counts, and a list of all endpoints.

```json
{
  "schemaVersion": 1,
  "package": "@my-org/my-service",
  "version": "1.0.0",
  "root": "my-service",
  "summary": {
    "functions": 12,
    "prismaModels": 5,
    "sourceFiles": 45
  },
  "files": {
    "overview": "overview.md",
    "functions": "functions.json",
    "prismaModels": "prisma-models.json"
  },
  "functions": [
    {
      "name": "get-users",
      "triggerType": "http",
      "route": "api/users",
      "methods": ["GET"],
      "queueName": null,
      "topicName": null,
      "schedule": null,
      "summary": "List all users with optional filters",
      "detailPath": "functions/get-users.json"
    }
  ]
}
```

### `functions/<name>.json`

Per-endpoint detail. One file per function/endpoint.

```json
{
  "name": "get-users",
  "trigger": {
    "name": "get-users",
    "type": "http",
    "options": { "route": "api/users", "methods": ["GET"] }
  },
  "handlerFile": "src/routes/users/handler.ts",
  "logicFile": "src/routes/users/get-users.ts",
  "schemaFile": "src/routes/users/schema.ts",
  "testFiles": ["src/routes/users/get-users.test.ts"],
  "localImports": ["./get-users", "#/shared/pagination"],
  "exportedSymbols": [
    { "name": "getUsers", "kind": "function" },
    { "name": "GetUsersQuery", "kind": "type" }
  ],
  "schemaFields": ["page", "limit", "search", "role"],
  "prismaUsages": [
    { "model": "user", "operations": ["findMany", "count"] }
  ],
  "openapi": {
    "path": "/api/users",
    "method": "GET",
    "summary": "List all users with optional filters",
    "operationId": "getUsers"
  }
}
```

### `prisma-models.json`

Database models with fields and relations. Use an empty array `[]` if your backend
does not use Prisma or an ORM.

```json
[
  {
    "name": "User",
    "tableName": "users",
    "fields": ["id", "email", "name", "role", "createdAt"],
    "relations": ["posts:Post[]", "profile:Profile?"]
  }
]
```

### `overview.md`

Human-readable summary. The MCP server returns this when `backend_overview` is called.

```markdown
# My Service Code Index

## Functions

- get-users: GET /api/users - List all users with optional filters
- create-user: POST /api/users - Create a new user

## Prisma Models

- User -> users
- Post -> posts
```

## How to write a builder

### 1. Start from the template

Copy the Azure Functions builder or the custom placeholder:

```bash
# From the debug-orchestrator repo
cp scripts/builders/azure-functions.ts /path/to/backend/scripts/builders/my-framework.ts
```

### 2. Understand the structure

A builder is a TypeScript script that:

1. Resolves its own location to find the package root
2. Scans the source directory for endpoints/routes
3. For each endpoint, extracts metadata (method, path, handler, schema, DB usage)
4. Writes the four output files to `.code-index/`

### 3. Adapt for your framework

The key function to change is the one that scans for endpoints. For different frameworks:

**Express/Fastify/Hono:**
- Scan for `router.get()`, `app.post()`, etc.
- Or scan for route files if using file-based routing

**NestJS:**
- Scan for `@Controller()` and `@Get()`, `@Post()` decorators
- Extract route paths from decorator arguments

**AWS Lambda:**
- Scan `serverless.yml` or `template.yaml` for function definitions
- Map each function to its handler file

**Generic REST:**
- Scan for files matching a naming convention (e.g., `*.route.ts`, `*.controller.ts`)
- Extract route metadata from comments, decorators, or configuration files

### 4. Run and verify

```bash
npx tsx scripts/builders/my-framework.ts
cat .code-index/manifest.json | head -20
```

### 5. Register in setup

When running `/debug-orchestrator/setup`, the setup command will detect your builder
and record it in `debug-config.json`.

## Using the Guide agent

If you prefer assistance, run `/debug-orchestrator/setup` and choose "Create with Guide"
when prompted for a builder. The Guide agent (Sonnet) will:

1. Inspect your backend code structure
2. Ask targeted questions about your framework and patterns
3. Generate a builder script
4. Test it once to verify the output

## Tips

- The MCP server searches `manifest.json` fields by keyword, so good `summary` strings
  help the orchestrator find relevant endpoints.
- Include all schema/validation fields — these help the Cartographer diagnose parameter
  mismatches between frontend and backend.
- Include Prisma/ORM usages per endpoint — these help diagnose join and relation bugs.
- The `localImports` field helps the orchestrator understand which files are related.
- Keep the `overview.md` concise. It is returned in full by `backend_overview`.
