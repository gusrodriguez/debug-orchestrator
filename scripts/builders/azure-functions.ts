import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type AzureTrigger = {
  name: string | null;
  type: string | null;
  options: Record<string, JsonValue>;
};

type CodeSymbol = {
  name: string;
  kind: string;
};

type PrismaUsage = {
  model: string;
  operations: string[];
};

type FunctionIndexEntry = {
  name: string;
  trigger: AzureTrigger | null;
  handlerFile: string | null;
  logicFile: string | null;
  schemaFile: string | null;
  testFiles: string[];
  localImports: string[];
  exportedSymbols: CodeSymbol[];
  schemaFields: string[];
  prismaUsages: PrismaUsage[];
  openapi: {
    path: string | null;
    method: string | null;
    summary: string | null;
    operationId: string | null;
  };
};

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

type PrismaModel = {
  name: string;
  tableName: string | null;
  fields: string[];
  relations: string[];
};

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, '..');
const functionsRoot = path.join(packageRoot, 'src/functions');
const prismaSchemaPath = path.join(packageRoot, 'prisma/schema.prisma');
const outputDir = path.join(packageRoot, '.code-index');
const functionsOutputDir = path.join(outputDir, 'functions');
const manifestPath = path.join(outputDir, 'manifest.json');
const functionsManifestPath = path.join(outputDir, 'functions.json');
const prismaModelsPath = path.join(outputDir, 'prisma-models.json');
const overviewPath = path.join(outputDir, 'overview.md');

const toPackagePath = (absolutePath: string) => path.relative(packageRoot, absolutePath).split(path.sep).join('/');

const readText = (filePath: string) => readFileSync(filePath, 'utf8');

const listFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) return listFiles(entryPath);
    return [entryPath];
  });
};

const createSourceFile = (filePath: string) =>
  ts.createSourceFile(filePath, readText(filePath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const getStringLiteralValue = (node: ts.Node): string | null => {
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
};

const getPropertyName = (name: ts.PropertyName): string | null => {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
};

const literalToJson = (node: ts.Expression): JsonValue => {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => literalToJson(element as ts.Expression));

  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(
      node.properties
        .filter(ts.isPropertyAssignment)
        .map(property => [getPropertyName(property.name) ?? 'unknown', literalToJson(property.initializer)])
    );
  }

  if (ts.isIdentifier(node)) return node.text;
  return node.getText();
};

const findAzureTrigger = (filePath: string): AzureTrigger | null => {
  if (!existsSync(filePath)) return null;

  const sourceFile = createSourceFile(filePath);
  let trigger: AzureTrigger | null = null;

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app'
    ) {
      const [nameArg, optionsArg] = node.arguments;

      trigger = {
        name: nameArg ? getStringLiteralValue(nameArg) : null,
        type: node.expression.name.text,
        options: optionsArg && ts.isObjectLiteralExpression(optionsArg) ? (literalToJson(optionsArg) as Record<string, JsonValue>) : {},
      };
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return trigger;
};

const getLocalImports = (filePaths: string[]) => {
  const imports = new Set<string>();

  filePaths.filter(Boolean).forEach(filePath => {
    if (!existsSync(filePath)) return;

    createSourceFile(filePath).forEachChild(node => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)) return;

      const importPath = node.moduleSpecifier.text;
      if (importPath.startsWith('.') || importPath.startsWith('#/') || importPath.startsWith('src/')) {
        imports.add(importPath);
      }
    });
  });

  return Array.from(imports).sort();
};

const getExportedSymbols = (filePaths: string[]): CodeSymbol[] => {
  const symbols: CodeSymbol[] = [];

  filePaths.filter(Boolean).forEach(filePath => {
    if (!existsSync(filePath)) return;

    const sourceFile = createSourceFile(filePath);

    sourceFile.forEachChild(node => {
      const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
      const isExported = modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (!isExported) return;

      if (ts.isFunctionDeclaration(node) && node.name) symbols.push({ name: node.name.text, kind: 'function' });
      if (ts.isInterfaceDeclaration(node)) symbols.push({ name: node.name.text, kind: 'interface' });
      if (ts.isTypeAliasDeclaration(node)) symbols.push({ name: node.name.text, kind: 'type' });
      if (ts.isClassDeclaration(node) && node.name) symbols.push({ name: node.name.text, kind: 'class' });
      if (ts.isEnumDeclaration(node)) symbols.push({ name: node.name.text, kind: 'enum' });
      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach(declaration => {
          if (ts.isIdentifier(declaration.name)) symbols.push({ name: declaration.name.text, kind: 'const' });
        });
      }
    });
  });

  return symbols.sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`));
};

const getSchemaFields = (schemaFile: string) => {
  if (!existsSync(schemaFile)) return [];

  const fields = new Set<string>();
  const sourceFile = createSourceFile(schemaFile);

  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node)) {
      const name = getPropertyName(node.name);
      if (name && !['headers', 'body', 'query', 'params', 'message'].includes(name)) fields.add(name);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return Array.from(fields).sort();
};

const getPrismaUsages = (filePaths: string[]): PrismaUsage[] => {
  const usages = new Map<string, Set<string>>();
  const usageRegex = /\bprisma\.([a-zA-Z]\w*)\.([a-zA-Z]\w*)\b/g;

  filePaths.filter(Boolean).forEach(filePath => {
    if (!existsSync(filePath)) return;

    const text = readText(filePath);
    let match: RegExpExecArray | null;

    while ((match = usageRegex.exec(text))) {
      const [, model, operation] = match;
      const operations = usages.get(model) ?? new Set<string>();
      operations.add(operation);
      usages.set(model, operations);
    }
  });

  return Array.from(usages.entries())
    .map(([model, operations]) => ({ model, operations: Array.from(operations).sort() }))
    .sort((a, b) => a.model.localeCompare(b.model));
};

const parseOpenApi = (handlerFile: string) => {
  if (!existsSync(handlerFile)) return { path: null, method: null, summary: null, operationId: null };

  const text = readText(handlerFile);
  const openApiBlock = text.match(/\/\*\*\s*\n\s*\*\s*@openapi[\s\S]*?\*\//)?.[0] ?? '';

  return {
    path: openApiBlock.match(/\*\s+(\/api\/\S+):/)?.[1] ?? null,
    method: openApiBlock.match(/\*\s+(get|post|put|patch|delete):/)?.[1]?.toUpperCase() ?? null,
    summary: openApiBlock.match(/\*\s+summary:\s+(.+)/)?.[1]?.trim() ?? null,
    operationId: openApiBlock.match(/\*\s+operationId:\s+(.+)/)?.[1]?.trim() ?? null,
  };
};

const parsePrismaModels = (): PrismaModel[] => {
  if (!existsSync(prismaSchemaPath)) return [];

  const text = readText(prismaSchemaPath);
  const names = Array.from(text.matchAll(/^model\s+(\w+)\s+\{/gm)).map(match => match[1]);
  const modelNames = new Set(names);

  return Array.from(text.matchAll(/^model\s+(\w+)\s+\{([\s\S]*?)^}/gm))
    .map(([, name, body]) => {
      const fields = body
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('//') && !line.startsWith('@@'))
        .map(line => line.split(/\s+/)[0])
        .filter(Boolean);

      const relations = body
        .split('\n')
        .map(line => line.trim().split(/\s+/))
        .filter(([fieldName, fieldType]) => fieldName && fieldType && modelNames.has(fieldType.replace(/\[\]|\?/g, '')))
        .map(([fieldName, fieldType]) => `${fieldName}:${fieldType}`);

      return {
        name,
        tableName: body.match(/@@map\("([^"]+)"\)/)?.[1] ?? null,
        fields,
        relations,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const getOptionString = (trigger: AzureTrigger | null, key: string): string | null => {
  const value = trigger?.options[key];
  return typeof value === 'string' ? value : null;
};

const getOptionStringArray = (trigger: AzureTrigger | null, key: string): string[] => {
  const value = trigger?.options[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const toFunctionManifestEntry = (entry: FunctionIndexEntry): FunctionManifestEntry => ({
  name: entry.name,
  triggerType: entry.trigger?.type ?? null,
  route: getOptionString(entry.trigger, 'route'),
  methods: getOptionStringArray(entry.trigger, 'methods'),
  queueName: getOptionString(entry.trigger, 'queueName'),
  topicName: getOptionString(entry.trigger, 'topicName'),
  schedule: getOptionString(entry.trigger, 'schedule'),
  summary: entry.openapi.summary,
  detailPath: `functions/${entry.name}.json`,
});

const createOverview = (functions: FunctionManifestEntry[], prismaModels: PrismaModel[]) => {
  const lines = [
    '# Form Engine Service Code Index',
    '',
    'This directory is generated by `yarn code-index`.',
    '',
    'Use `manifest.json` first. It points to small, focused files so an agent can load only the context it needs.',
    '',
    '## Files',
    '',
    '- `manifest.json`: package-level routing summary.',
    '- `functions.json`: compact list of Azure Functions.',
    '- `functions/<name>.json`: detailed index for one function.',
    '- `prisma-models.json`: Prisma models, fields, table names, and relations.',
    '',
    '## Functions',
    '',
    ...functions.map(entry => {
      const triggerDetails = [
        entry.triggerType,
        entry.methods.length ? entry.methods.join(',') : null,
        entry.route ? `/${entry.route}` : null,
        entry.queueName ? `queue:${entry.queueName}` : null,
        entry.topicName ? `topic:${entry.topicName}` : null,
        entry.schedule ? `schedule:${entry.schedule}` : null,
      ]
        .filter(Boolean)
        .join(' ');

      return `- ${entry.name}: ${triggerDetails || 'unknown trigger'}${entry.summary ? ` - ${entry.summary}` : ''}`;
    }),
    '',
    '## Prisma Models',
    '',
    ...prismaModels.map(model => `- ${model.name}${model.tableName ? ` -> ${model.tableName}` : ''}`),
    '',
  ];

  return lines.join('\n');
};

const writeJson = (filePath: string, value: unknown) => {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const buildFunctionIndex = (): FunctionIndexEntry[] => {
  if (!existsSync(functionsRoot)) return [];

  return readdirSync(functionsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const functionDirectory = path.join(functionsRoot, entry.name);
      const files = readdirSync(functionDirectory).map(file => path.join(functionDirectory, file));
      const handlerFile = path.join(functionDirectory, 'handler.ts');
      const logicFile = path.join(functionDirectory, `${entry.name}.ts`);
      const schemaFile = path.join(functionDirectory, 'schema.ts');
      const testFiles = files.filter(file => file.endsWith('.test.ts')).sort();
      const relevantSourceFiles = [handlerFile, logicFile, schemaFile, ...testFiles].filter(existsSync);

      return {
        name: entry.name,
        trigger: findAzureTrigger(handlerFile),
        handlerFile: existsSync(handlerFile) ? toPackagePath(handlerFile) : null,
        logicFile: existsSync(logicFile) ? toPackagePath(logicFile) : null,
        schemaFile: existsSync(schemaFile) ? toPackagePath(schemaFile) : null,
        testFiles: testFiles.map(toPackagePath),
        localImports: getLocalImports(relevantSourceFiles),
        exportedSymbols: getExportedSymbols(relevantSourceFiles),
        schemaFields: getSchemaFields(schemaFile),
        prismaUsages: getPrismaUsages(relevantSourceFiles),
        openapi: parseOpenApi(handlerFile),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const packageJson = JSON.parse(readText(path.join(packageRoot, 'package.json'))) as { name: string; version: string };
const functions = buildFunctionIndex();
const prismaModels = parsePrismaModels();
const functionManifest = functions.map(toFunctionManifestEntry);
const index = {
  schemaVersion: 1,
  package: packageJson.name,
  version: packageJson.version,
  root: path.basename(packageRoot),
  summary: {
    functions: functions.length,
    prismaModels: prismaModels.length,
    sourceFiles: listFiles(path.join(packageRoot, 'src')).filter(file => file.endsWith('.ts')).length,
  },
  files: {
    overview: 'overview.md',
    functions: 'functions.json',
    prismaModels: 'prisma-models.json',
  },
  functions: functionManifest,
};

mkdirSync(outputDir, { recursive: true });
mkdirSync(functionsOutputDir, { recursive: true });

writeJson(manifestPath, index);
writeJson(functionsManifestPath, functionManifest);
writeJson(prismaModelsPath, prismaModels);
writeFileSync(overviewPath, createOverview(functionManifest, prismaModels));

functions.forEach(entry => {
  writeJson(path.join(functionsOutputDir, `${entry.name}.json`), entry);
});

console.log(`Code index written to ${toPackagePath(outputDir)}`);
console.log(`Indexed ${index.summary.functions} functions, ${index.summary.prismaModels} Prisma models, ${index.summary.sourceFiles} source files.`);
