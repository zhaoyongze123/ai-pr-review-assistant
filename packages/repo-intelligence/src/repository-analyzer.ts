import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  LanguageSummarySchema,
  RepositoryFileSchema,
  SymbolEdgeSchema,
  SymbolSchema,
  type LanguageSummary,
  type RepositoryFile,
  type RepositoryFileKind,
  type Symbol,
  type SymbolEdge,
  type SymbolEdgeType,
  type SymbolKind,
} from "@ai-pr-review/shared-types";

export type RepositoryAnalyzerInput = {
  repositoryId: string;
  scanId: string;
  rootDir: string;
};

export type RepositoryAnalysisResult = {
  languageSummary: LanguageSummary[];
  frameworkSummary: string[];
  files: RepositoryFile[];
  symbols: Symbol[];
  edges: SymbolEdge[];
};

type FileDraft = {
  repositoryId: string;
  scanId: string;
  filePath: string;
  language: string;
  kind: RepositoryFileKind;
  moduleName?: string;
  summary?: string;
  riskTags: string[];
  checksum: string;
  metadata: Record<string, unknown>;
};

type SymbolDraft = {
  symbol: Symbol;
  start: number;
  end: number;
};

type FileInsight = {
  symbolCount: number;
  importCount: number;
  callCount: number;
};

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".idea",
  ".vscode",
]);

export async function analyzeRepositorySnapshot(
  input: RepositoryAnalyzerInput,
): Promise<RepositoryAnalysisResult> {
  const filePaths = await listRepositoryFiles(input.rootDir);
  const fileDrafts: FileDraft[] = [];
  const languageCounter = new Map<
    string,
    { fileCount: number; estimatedLines: number }
  >();
  const frameworkSummary = await detectFrameworks(input.rootDir);

  for (const absolutePath of filePaths) {
    const fileDraft = await createFileDraft(input, absolutePath);
    fileDrafts.push(fileDraft);
    const current = languageCounter.get(fileDraft.language) ?? {
      fileCount: 0,
      estimatedLines: 0,
    };
    current.fileCount += 1;
    current.estimatedLines += Number(fileDraft.metadata.lineCount ?? 0);
    languageCounter.set(fileDraft.language, current);
  }

  const tsLikeFiles = filePaths.filter((filePath) =>
    SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()),
  );
  const tsInsights = analyzeTypeScriptLikeFiles(input, tsLikeFiles);
  const insightByFile = new Map<string, FileInsight>();

  for (const file of fileDrafts) {
    const insight = tsInsights.fileInsights.get(file.filePath) ?? {
      symbolCount: 0,
      importCount: 0,
      callCount: 0,
    };
    insightByFile.set(file.filePath, insight);
    file.summary = buildFileSummary(file, insight);
    file.metadata = {
      ...file.metadata,
      symbolCount: insight.symbolCount,
      importCount: insight.importCount,
      callCount: insight.callCount,
    };
  }

  return {
    languageSummary: Array.from(languageCounter.entries())
      .sort((left, right) => right[1].fileCount - left[1].fileCount)
      .map(([language, counts]) =>
        LanguageSummarySchema.parse({
          language,
          fileCount: counts.fileCount,
          estimatedLines: counts.estimatedLines,
        }),
      ),
    frameworkSummary,
    files: fileDrafts.map((file) => RepositoryFileSchema.parse(file)),
    symbols: tsInsights.symbols.map((entry) => entry.symbol),
    edges: tsInsights.edges,
  };
}

async function listRepositoryFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift()!;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".DS_Store")) {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath);
        }
        continue;
      }
      results.push(absolutePath);
    }
  }

  return results.sort();
}

async function createFileDraft(
  input: RepositoryAnalyzerInput,
  absolutePath: string,
): Promise<FileDraft> {
  const relativePath = normalizeRelativePath(input.rootDir, absolutePath);
  const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
  const extension = path.extname(relativePath).toLowerCase();
  const lineCount = content ? content.split(/\r?\n/).length : 0;

  return {
    repositoryId: input.repositoryId,
    scanId: input.scanId,
    filePath: relativePath,
    language: detectLanguage(relativePath, extension),
    kind: detectFileKind(relativePath, extension),
    moduleName: detectModuleName(relativePath),
    summary: undefined,
    riskTags: detectRiskTags(relativePath, content),
    checksum: String(content.length),
    metadata: {
      extension,
      lineCount,
    },
  };
}

function analyzeTypeScriptLikeFiles(
  input: RepositoryAnalyzerInput,
  absolutePaths: string[],
): {
  symbols: SymbolDraft[];
  edges: SymbolEdge[];
  fileInsights: Map<string, FileInsight>;
} {
  const program = ts.createProgram(absolutePaths, {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();
  const symbols: SymbolDraft[] = [];
  const edges: SymbolEdge[] = [];
  const symbolNamesSeen = new Set<string>();
  const declarationToQualifiedName = new Map<string, string>();
  const fileInsights = new Map<string, FileInsight>();
  const pseudoModuleByFile = new Map<string, string>();

  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.fileName.startsWith(input.rootDir)) {
      continue;
    }

    const relativePath = normalizeRelativePath(
      input.rootDir,
      sourceFile.fileName,
    );
    pseudoModuleByFile.set(relativePath, `module:${relativePath}`);
    fileInsights.set(relativePath, {
      symbolCount: 0,
      importCount: 0,
      callCount: 0,
    });

    const visit = (node: ts.Node, scope: string[]) => {
      const extracted = extractSymbolFromNode(
        input,
        sourceFile,
        relativePath,
        node,
        scope,
      );
      const nextScope = extracted
        ? [...scope, extracted.symbol.symbolName]
        : scope;

      if (extracted) {
        if (!symbolNamesSeen.has(extracted.symbol.qualifiedName)) {
          symbolNamesSeen.add(extracted.symbol.qualifiedName);
          symbols.push(extracted);
          registerDeclaration(
            declarationToQualifiedName,
            node,
            sourceFile,
            extracted.symbol.qualifiedName,
          );
          incrementInsight(fileInsights, relativePath, "symbolCount");
        }
      }

      if (ts.isImportDeclaration(node)) {
        incrementInsight(fileInsights, relativePath, "importCount");
        const importTarget = getImportTargetQualifiedName(
          checker,
          declarationToQualifiedName,
          sourceFile,
          node,
        );
        edges.push(
          SymbolEdgeSchema.parse({
            repositoryId: input.repositoryId,
            scanId: input.scanId,
            fromQualifiedName: pseudoModuleByFile.get(relativePath)!,
            toQualifiedName:
              importTarget ??
              `import:${node.moduleSpecifier.getText(sourceFile).replaceAll("'", "").replaceAll('"', "")}`,
            edgeType: "imports",
            metadata: {
              filePath: relativePath,
            },
          }),
        );
      }

      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const fromQualifiedName = findEnclosingSymbolQualifiedName(
          symbols,
          relativePath,
          node.getStart(sourceFile),
        );
        const toQualifiedName = resolveQualifiedNameFromExpression(
          checker,
          declarationToQualifiedName,
          sourceFile,
          ts.isCallExpression(node) ? node.expression : node.expression,
        );
        if (fromQualifiedName && toQualifiedName) {
          edges.push(
            SymbolEdgeSchema.parse({
              repositoryId: input.repositoryId,
              scanId: input.scanId,
              fromQualifiedName,
              toQualifiedName,
              edgeType: "calls",
              metadata: {
                filePath: relativePath,
              },
            }),
          );
          incrementInsight(fileInsights, relativePath, "callCount");
        }
      }

      ts.forEachChild(node, (child) => visit(child, nextScope));
    };

    visit(sourceFile, []);
  }

  return {
    symbols,
    edges: deduplicateEdges(edges),
    fileInsights,
  };
}

function extractSymbolFromNode(
  input: RepositoryAnalyzerInput,
  sourceFile: ts.SourceFile,
  relativePath: string,
  node: ts.Node,
  scope: string[],
): SymbolDraft | null {
  const definition = getNodeSymbolDefinition(node);
  if (!definition) {
    return null;
  }

  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const startLine = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
  const endLine = sourceFile.getLineAndCharacterOfPosition(end).line + 1;
  const qualifiedName = `${relativePath}#${[...scope, definition.name].join(".")}`;

  return {
    symbol: SymbolSchema.parse({
      repositoryId: input.repositoryId,
      scanId: input.scanId,
      filePath: relativePath,
      symbolName: definition.name,
      qualifiedName,
      kind: definition.kind,
      startLine,
      endLine,
      signature: definition.signature,
      moduleName: detectModuleName(relativePath),
      riskTags: detectRiskTags(relativePath, definition.name),
      metadata: {
        exported: hasExportModifier(node),
      },
    }),
    start,
    end,
  };
}

function getNodeSymbolDefinition(
  node: ts.Node,
): { name: string; kind: SymbolKind; signature?: string } | null {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: "function",
      signature: buildCallableSignature(node),
    };
  }
  if (ts.isClassDeclaration(node) && node.name) {
    return {
      name: node.name.text,
      kind: "class",
    };
  }
  if (ts.isMethodDeclaration(node) && isIdentifierLike(node.name)) {
    return {
      name: node.name.text,
      kind: "method",
      signature: buildCallableSignature(node),
    };
  }
  if (ts.isInterfaceDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "interface",
    };
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "type",
    };
  }
  if (ts.isEnumDeclaration(node)) {
    return {
      name: node.name.text,
      kind: "enum",
    };
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return {
      name: node.name.text,
      kind: "variable",
    };
  }
  return null;
}

function buildCallableSignature(
  node: ts.SignatureDeclarationBase,
): string | undefined {
  const parameters = node.parameters
    .map((parameter) => parameter.getText())
    .join(", ");
  return `(${parameters})`;
}

function isIdentifierLike(
  node: ts.PropertyName,
): node is ts.Identifier | ts.StringLiteral {
  return ts.isIdentifier(node) || ts.isStringLiteral(node);
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    (ts.getCombinedModifierFlags(node as ts.Declaration) &
      ts.ModifierFlags.Export) !==
    0
  );
}

function registerDeclaration(
  target: Map<string, string>,
  node: ts.Node,
  sourceFile: ts.SourceFile,
  qualifiedName: string,
) {
  target.set(
    getDeclarationKey(sourceFile.fileName, node.getStart(sourceFile)),
    qualifiedName,
  );
  const nameNode = (node as { name?: ts.Node }).name;
  if (nameNode) {
    target.set(
      getDeclarationKey(sourceFile.fileName, nameNode.getStart(sourceFile)),
      qualifiedName,
    );
  }
}

function getDeclarationKey(filePath: string, start: number) {
  return `${filePath}:${start}`;
}

function getImportTargetQualifiedName(
  checker: ts.TypeChecker,
  declarationToQualifiedName: Map<string, string>,
  sourceFile: ts.SourceFile,
  node: ts.ImportDeclaration,
): string | undefined {
  const importClause = node.importClause;
  if (!importClause) {
    return undefined;
  }
  const candidates: ts.Identifier[] = [];
  if (importClause.name) {
    candidates.push(importClause.name);
  }
  if (
    importClause.namedBindings &&
    ts.isNamedImports(importClause.namedBindings)
  ) {
    for (const element of importClause.namedBindings.elements) {
      candidates.push(element.name);
    }
  }
  for (const candidate of candidates) {
    const resolved = resolveQualifiedNameFromExpression(
      checker,
      declarationToQualifiedName,
      sourceFile,
      candidate,
    );
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function resolveQualifiedNameFromExpression(
  checker: ts.TypeChecker,
  declarationToQualifiedName: Map<string, string>,
  sourceFile: ts.SourceFile,
  expression: ts.LeftHandSideExpression | ts.Expression | undefined,
): string | undefined {
  if (!expression) {
    return undefined;
  }

  const symbol =
    checker.getSymbolAtLocation(expression) ??
    (ts.isPropertyAccessExpression(expression)
      ? checker.getSymbolAtLocation(expression.name)
      : undefined);
  if (!symbol) {
    return undefined;
  }

  const resolvedSymbol =
    symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;

  for (const declaration of resolvedSymbol.getDeclarations() ?? []) {
    const source = declaration.getSourceFile();
    const direct = declarationToQualifiedName.get(
      getDeclarationKey(source.fileName, declaration.getStart(source)),
    );
    if (direct) {
      return direct;
    }
    const nameNode = (declaration as { name?: ts.Node }).name;
    if (nameNode) {
      const viaName = declarationToQualifiedName.get(
        getDeclarationKey(source.fileName, nameNode.getStart(source)),
      );
      if (viaName) {
        return viaName;
      }
    }
  }

  return undefined;
}

function findEnclosingSymbolQualifiedName(
  symbols: SymbolDraft[],
  filePath: string,
  position: number,
): string | undefined {
  let match: SymbolDraft | undefined;
  for (const symbol of symbols) {
    if (symbol.symbol.filePath !== filePath) {
      continue;
    }
    if (symbol.start <= position && position <= symbol.end) {
      if (!match || symbol.end - symbol.start < match.end - match.start) {
        match = symbol;
      }
    }
  }
  return match?.symbol.qualifiedName;
}

function deduplicateEdges(edges: SymbolEdge[]): SymbolEdge[] {
  const seen = new Set<string>();
  const deduplicated: SymbolEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.edgeType}:${edge.fromQualifiedName}:${edge.toQualifiedName}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduplicated.push(edge);
  }
  return deduplicated;
}

function incrementInsight(
  fileInsights: Map<string, FileInsight>,
  filePath: string,
  field: keyof FileInsight,
) {
  const current = fileInsights.get(filePath);
  if (!current) {
    return;
  }
  current[field] += 1;
}

function buildFileSummary(file: FileDraft, insight: FileInsight): string {
  const parts = [
    `${file.language} ${file.kind} 文件`,
    file.moduleName ? `属于 ${file.moduleName} 模块` : "位于仓库根目录",
  ];
  if (insight.symbolCount > 0) {
    parts.push(`提取到 ${insight.symbolCount} 个符号`);
  }
  if (insight.importCount > 0) {
    parts.push(`包含 ${insight.importCount} 个导入关系`);
  }
  if (file.riskTags.length > 0) {
    parts.push(`风险标签: ${file.riskTags.join(", ")}`);
  }
  return parts.join("，");
}

function normalizeRelativePath(rootDir: string, absolutePath: string) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function detectLanguage(relativePath: string, extension: string): string {
  const lower = relativePath.toLowerCase();
  if (lower === "package.json") {
    return "JSON";
  }
  switch (extension) {
    case ".ts":
      return "TypeScript";
    case ".tsx":
      return "TSX";
    case ".js":
      return "JavaScript";
    case ".jsx":
      return "JSX";
    case ".json":
      return "JSON";
    case ".md":
      return "Markdown";
    case ".sql":
      return "SQL";
    case ".yml":
    case ".yaml":
      return "YAML";
    default:
      return extension ? extension.slice(1).toUpperCase() : "Text";
  }
}

function detectFileKind(
  relativePath: string,
  extension: string,
): RepositoryFileKind {
  const lower = relativePath.toLowerCase();
  if (/(^|\/)(readme|docs?)\b/.test(lower) || extension === ".md") {
    return "doc";
  }
  if (/(\.|\/)(spec|test)\./.test(lower) || lower.includes("/__tests__/")) {
    return "test";
  }
  if ([".json", ".yml", ".yaml", ".toml", ".env"].includes(extension)) {
    return "config";
  }
  if ([".sql", ".prisma"].includes(extension)) {
    return "schema";
  }
  if ([".png", ".jpg", ".jpeg", ".svg", ".gif", ".webp"].includes(extension)) {
    return "asset";
  }
  if (SOURCE_EXTENSIONS.has(extension)) {
    return "source";
  }
  return "unknown";
}

function detectModuleName(relativePath: string): string | undefined {
  const segments = relativePath.split("/");
  if (segments.length === 1) {
    return "root";
  }
  if (
    ["apps", "packages", "services", "docs", "infra"].includes(
      segments[0] ?? "",
    )
  ) {
    return segments.slice(0, 2).join("/");
  }
  if (segments[0] === "src" && segments[1]) {
    return segments[1];
  }
  return segments[0];
}

function detectRiskTags(relativePath: string, content: string): string[] {
  const haystack = `${relativePath}\n${content}`.toLowerCase();
  const tags = new Set<string>();
  if (/(auth|jwt|token|session|login|passport|oauth)/.test(haystack)) {
    tags.add("auth");
  }
  if (/(payment|billing|checkout|invoice|refund|stripe)/.test(haystack)) {
    tags.add("payment");
  }
  if (/(permission|role|guard|acl|authorize)/.test(haystack)) {
    tags.add("permission");
  }
  if (/(transaction|commit|rollback|trx)/.test(haystack)) {
    tags.add("transaction");
  }
  if (
    /(database|typeorm|prisma|sql|migration|query|postgres|mysql|sqlite)/.test(
      haystack,
    )
  ) {
    tags.add("database");
  }
  if (/(cache|redis|memcache|lru)/.test(haystack)) {
    tags.add("cache");
  }
  if (/(retry|backoff|attempt)/.test(haystack)) {
    tags.add("retry");
  }
  if (/(feature[_ -]?flag|toggle|experiments?)/.test(haystack)) {
    tags.add("feature_flag");
  }
  return Array.from(tags);
}

async function detectFrameworks(rootDir: string): Promise<string[]> {
  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJsonText = await fs
    .readFile(packageJsonPath, "utf8")
    .catch(() => "");
  if (!packageJsonText) {
    return [];
  }
  const parsed = JSON.parse(packageJsonText) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const allDependencies = {
    ...(parsed.dependencies ?? {}),
    ...(parsed.devDependencies ?? {}),
  };
  const frameworks = new Set<string>();

  if (allDependencies.react) frameworks.add("react");
  if (allDependencies.next) frameworks.add("nextjs");
  if (allDependencies["@nestjs/core"]) frameworks.add("nestjs");
  if (allDependencies.express) frameworks.add("express");
  if (allDependencies.vite) frameworks.add("vite");
  if (allDependencies.prisma) frameworks.add("prisma");
  if (allDependencies.typeorm) frameworks.add("typeorm");

  return Array.from(frameworks).sort();
}
