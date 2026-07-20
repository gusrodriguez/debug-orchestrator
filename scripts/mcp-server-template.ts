// This file is a template. It is copied into backend repos during /setup and
// runs as-is via tsx. If you maintain multiple backends, consider publishing
// this as a standalone npm package instead of copying the template each time.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type FunctionManifestEntry = {
  name: string;
  triggerType: string | null;
  route: string | null;
  methods: string[];
  queueName: string | null;
  topicName: string | null;
  schedule: string | null;
  summary: string | null;
  detailPath: string;
};

type Manifest = {
  schemaVersion: number;
  package: string;
  version: string;
  root: string;
  summary: { functions: number; prismaModels: number; sourceFiles: number };
  files: { overview: string; functions: string; prismaModels: string };
  functions: FunctionManifestEntry[];
};

type FunctionIndexEntry = {
  name: string;
  trigger: { name: string | null; type: string | null; options: Record<string, JsonValue> } | null;
  handlerFile: string | null;
  logicFile: string | null;
  schemaFile: string | null;
  testFiles: string[];
  localImports: string[];
  exportedSymbols: { name: string; kind: string }[];
  schemaFields: string[];
  prismaUsages: { model: string; operations: string[] }[];
  openapi: { path: string | null; method: string | null; summary: string | null; operationId: string | null };
};

type PrismaModel = {
  name: string;
  tableName: string | null;
  fields: string[];
  relations: string[];
};

// Resolve paths — all configurable via env vars for portability.
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = process.env.PACKAGE_ROOT
  ? path.resolve(process.env.PACKAGE_ROOT)
  : path.resolve(scriptDir, '..');
const defaultIndexPath = path.join(packageRoot, '.code-index');
const indexPath = process.env.CODE_INDEX_PATH ?? defaultIndexPath;
const backendRepoRoot = process.env.BACKEND_REPO_PATH ?? path.resolve(packageRoot, '..', '..');
const serviceName = process.env.SERVICE_NAME ?? 'code-index';

// Auto-rebuild the code index on every server start.
// The builder is configurable via BUILD_SCRIPT env var.
const buildScript = process.env.BUILD_SCRIPT
  ? path.resolve(process.env.BUILD_SCRIPT)
  : path.join(scriptDir, 'builders', 'azure-functions.ts');
const tsxBin = path.resolve(backendRepoRoot, 'node_modules', '.bin', 'tsx');
try {
  execFileSync(tsxBin, [buildScript], { cwd: packageRoot, timeout: 30_000, stdio: 'pipe' });
  console.error('Code index rebuilt successfully.');
} catch (err) {
  console.error(`Warning: failed to rebuild code index: ${(err as Error).message}`);
}

const cache = new Map<string, unknown>();

const loadJson = <T>(relativePath: string): T => {
  if (cache.has(relativePath)) return cache.get(relativePath) as T;

  const filePath = path.join(indexPath, relativePath);
  const data = JSON.parse(readFileSync(filePath, 'utf8')) as T;
  cache.set(relativePath, data);
  return data;
};

const loadText = (relativePath: string): string => {
  const filePath = path.join(indexPath, relativePath);
  return readFileSync(filePath, 'utf8');
};

const server = new McpServer({ name: serviceName, version: '1.0.0' });

// Tool 1: Backend overview
server.registerTool('backend_overview', {
  description:
    'Get a high-level overview of the backend service: package info, function count, Prisma model count, and a summary of all endpoints and models.',
  annotations: { readOnlyHint: true },
}, async () => {

  const manifest = loadJson<Manifest>('manifest.json');
  const overview = loadText('overview.md');

  return {
    content: [
      {
        type: 'text' as const,
        text: [
          `Package: ${manifest.package} v${manifest.version}`,
          `Functions: ${manifest.summary.functions}`,
          `Prisma models: ${manifest.summary.prismaModels}`,
          `Source files: ${manifest.summary.sourceFiles}`,
          '',
          overview,
        ].join('\n'),
      },
    ],
  };
});

// Tool 2: Search backend routes
server.registerTool('search_backend_routes', {
  description:
    'Search for backend endpoints by route pattern, function name, HTTP method, or keyword in the summary. Returns matching functions with their route, method, trigger type, and description.',
  inputSchema: {
    query: z.string().describe('Search term matched against function name, route, summary, queue name, or topic name'),
    method: z.string().optional().describe('Filter by HTTP method (GET, POST, PUT, DELETE, PATCH)'),
  },
  annotations: { readOnlyHint: true },
}, async ({ query, method }) => {

  const manifest = loadJson<Manifest>('manifest.json');
  const lowerQuery = query.toLowerCase();
  const upperMethod = method?.toUpperCase();

  const matches = manifest.functions.filter(fn => {
    const matchesQuery =
      fn.name.toLowerCase().includes(lowerQuery) ||
      fn.route?.toLowerCase().includes(lowerQuery) ||
      fn.summary?.toLowerCase().includes(lowerQuery) ||
      fn.queueName?.toLowerCase().includes(lowerQuery) ||
      fn.topicName?.toLowerCase().includes(lowerQuery) ||
      fn.triggerType?.toLowerCase().includes(lowerQuery);

    if (!matchesQuery) return false;
    if (upperMethod) return fn.methods.includes(upperMethod);
    return true;
  });

  if (matches.length === 0) {
    return { content: [{ type: 'text' as const, text: `No endpoints found matching "${query}"${method ? ` with method ${method}` : ''}.` }] };
  }

  const lines = matches.map(fn => {
    const parts = [
      fn.methods.length ? fn.methods.join(',') : fn.triggerType,
      fn.route ? `/${fn.route}` : fn.queueName ?? fn.topicName ?? fn.schedule,
      fn.name,
      fn.summary,
    ].filter(Boolean);
    return parts.join(' | ');
  });

  return {
    content: [{ type: 'text' as const, text: `Found ${matches.length} endpoint(s):\n\n${lines.join('\n')}` }],
  };
});

// Tool 3: Get backend endpoint details
server.registerTool('get_backend_endpoint', {
  description:
    'Get full details of a specific backend function/endpoint, including source file paths, Prisma model usage, schema fields, exported symbols, and OpenAPI metadata. Use search_backend_routes first to find the function name.',
  inputSchema: {
    name: z.string().describe('The function name (e.g. "browse-reports")'),
  },
  annotations: { readOnlyHint: true },
}, async ({ name }) => {

  try {
    const entry = loadJson<FunctionIndexEntry>(`functions/${name}.json`);

    const sections = [
      `# ${entry.name}`,
      '',
      entry.openapi.summary ? `**Summary:** ${entry.openapi.summary}` : null,
      entry.openapi.method && entry.openapi.path ? `**Endpoint:** ${entry.openapi.method} ${entry.openapi.path}` : null,
      entry.trigger ? `**Trigger:** ${entry.trigger.type}` : null,
      '',
      '## Source files',
      entry.handlerFile ? `- Handler: ${entry.handlerFile}` : null,
      entry.logicFile ? `- Logic: ${entry.logicFile}` : null,
      entry.schemaFile ? `- Schema: ${entry.schemaFile}` : null,
      ...entry.testFiles.map(f => `- Test: ${f}`),
      '',
      entry.schemaFields.length ? `## Schema fields\n${entry.schemaFields.join(', ')}` : null,
      '',
      entry.prismaUsages.length
        ? `## Prisma usage\n${entry.prismaUsages.map(u => `- ${u.model}: ${u.operations.join(', ')}`).join('\n')}`
        : null,
      '',
      entry.exportedSymbols.length
        ? `## Exported symbols\n${entry.exportedSymbols.map(s => `- ${s.kind} ${s.name}`).join('\n')}`
        : null,
      '',
      entry.localImports.length ? `## Local imports\n${entry.localImports.join('\n')}` : null,
    ];

    return {
      content: [{ type: 'text' as const, text: sections.filter(Boolean).join('\n') }],
    };
  } catch {
    return {
      content: [{ type: 'text' as const, text: `Function "${name}" not found. Use search_backend_routes to find available functions.` }],
      isError: true,
    };
  }
});

// Tool 4: Search backend Prisma models
server.registerTool('search_backend_models', {
  description:
    'List or search Prisma database models used by the backend, including their fields, table names, and relations to other models.',
  inputSchema: {
    query: z.string().optional().describe('Filter models by name, table name, or field name. Omit to list all models.'),
  },
  annotations: { readOnlyHint: true },
}, async ({ query }) => {

  const models = loadJson<PrismaModel[]>('prisma-models.json');

  const filtered = query
    ? models.filter(m => {
        const lower = query.toLowerCase();
        return (
          m.name.toLowerCase().includes(lower) ||
          m.tableName?.toLowerCase().includes(lower) ||
          m.fields.some(f => f.toLowerCase().includes(lower))
        );
      })
    : models;

  if (filtered.length === 0) {
    return { content: [{ type: 'text' as const, text: `No models found matching "${query}".` }] };
  }

  const text = filtered
    .map(m => {
      const lines = [
        `## ${m.name}${m.tableName ? ` (table: ${m.tableName})` : ''}`,
        `Fields: ${m.fields.join(', ')}`,
        m.relations.length ? `Relations: ${m.relations.join(', ')}` : null,
      ];
      return lines.filter(Boolean).join('\n');
    })
    .join('\n\n');

  return { content: [{ type: 'text' as const, text }] };
});

// Tool 5: Get backend repo root path
server.registerTool('get_backend_repo_path', {
  description:
    'Returns the absolute path to the backend repo root and the service package root. Use this to construct absolute file paths when editing backend files via sub-agents.',
  annotations: { readOnlyHint: true },
}, async () => {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        repoRoot: backendRepoRoot,
        serviceRoot: packageRoot,
        srcRoot: path.join(packageRoot, 'src'),
      }),
    }],
  };
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`${serviceName} MCP server running on stdio`);
