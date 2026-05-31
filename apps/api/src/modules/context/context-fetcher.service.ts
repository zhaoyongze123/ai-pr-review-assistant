import { readFile } from "node:fs/promises";
import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { createContextFetchPlan } from "@ai-pr-review/review-core";
import type {
  ContextArtifact,
  ContextBudget,
  ContextFetchResult,
  ContextRequest,
  PlannedToolCall,
  RepositoryFile,
  Symbol,
} from "@ai-pr-review/shared-types";
import { SemanticRetrievalStoreService } from "../retrieval/semantic-retrieval-store.service.js";
import {
  RepositoryContextStoreService,
  type RepositoryContextSnapshot,
} from "./repository-context-store.service.js";

@Injectable()
export class ContextFetcherService {
  constructor(
    @Inject(RepositoryContextStoreService)
    private readonly repositoryContextStoreService: RepositoryContextStoreService,
    @Inject(SemanticRetrievalStoreService)
    private readonly semanticRetrievalStoreService: SemanticRetrievalStoreService,
  ) {}

  createPlan(
    request: ContextRequest,
    budget: ContextBudget,
  ): ContextFetchResult {
    return createContextFetchPlan(request, budget);
  }

  async execute(input: {
    repositoryId: string;
    repositoryPath: string;
    request: ContextRequest;
    budget: ContextBudget;
    focusFilePath?: string;
  }): Promise<ContextFetchResult> {
    const plan = this.createPlan(input.request, input.budget);
    if (plan.status !== "planned") {
      return plan;
    }

    const snapshot =
      await this.repositoryContextStoreService.loadLatestSnapshot(
        input.repositoryId,
      );
    if (isEmptySnapshot(snapshot)) {
      return {
        ...plan,
        status: "skipped",
        reason: "仓库还没有已完成的结构化扫描，无法执行真实上下文检索",
        artifacts: [],
      };
    }

    const artifacts: ContextArtifact[] = [];
    const focusModuleName = snapshot.files.find(
      (file) => file.filePath === input.focusFilePath,
    )?.moduleName;

    for (const plannedCall of plan.plannedCalls) {
      const nextArtifacts = await this.resolvePlannedCall({
        plannedCall,
        snapshot,
        repositoryPath: input.repositoryPath,
      });
      appendArtifacts(artifacts, nextArtifacts);
    }

    if (shouldUseSemanticFallback(input.request.reason, artifacts)) {
      const semanticArtifacts = await this.loadSemanticArtifacts({
        repositoryId: input.repositoryId,
        query: buildSemanticQuery(input.request),
        moduleName: focusModuleName,
      });
      appendArtifacts(artifacts, semanticArtifacts);
    }

    if (shouldExpandAuthContractContext(input.request, input.focusFilePath)) {
      const authExpansionArtifacts = await loadAuthContractArtifacts({
        snapshot,
        request: input.request,
        repositoryPath: input.repositoryPath,
        focusFilePath: input.focusFilePath,
      });
      appendArtifacts(artifacts, authExpansionArtifacts);
    }

    return {
      ...plan,
      status: "completed",
      reason:
        artifacts.length > 0
          ? `上下文检索完成，补充了 ${artifacts.length} 条证据`
          : "上下文检索已执行，但没有命中额外证据",
      artifacts,
    };
  }

  private async resolvePlannedCall(input: {
    plannedCall: PlannedToolCall;
    snapshot: RepositoryContextSnapshot;
    repositoryPath: string;
  }): Promise<ContextArtifact[]> {
    switch (input.plannedCall.toolName) {
      case "find_symbol_definition":
        return buildDefinitionArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      case "read_file_snippet":
        return buildFileArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      case "find_callers":
        return buildCallerArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      case "find_callees":
        return buildCalleeArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      case "find_related_tests":
        return buildTestArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      case "find_schema_or_migration":
        return buildSchemaArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      case "read_config_or_feature_flag":
        return buildConfigArtifacts(
          input.snapshot,
          input.plannedCall.query,
          input.repositoryPath,
        );
      default:
        return [];
    }
  }

  private async loadSemanticArtifacts(input: {
    repositoryId: string;
    query: string;
    moduleName?: string;
  }): Promise<ContextArtifact[]> {
    const results = await this.semanticRetrievalStoreService.search({
      repositoryId: input.repositoryId,
      query: input.query,
      moduleName: input.moduleName,
      documentTypes: ["readme", "doc", "adr", "module_summary"],
      limit: 2,
    });

    return results.map((result) => ({
      toolName: "read_file_snippet",
      filePath: result.document.sourcePath,
      preview: truncatePreview(result.document.content),
      metadata: {
        sourceType: "semantic_document",
        score: result.score,
        documentType: result.document.documentType,
        moduleName: result.document.moduleName,
      },
    }));
  }
}

async function buildDefinitionArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const symbols = resolveSymbols(snapshot, query).slice(0, 2);
  return Promise.all(
    symbols.map(async (symbol) => ({
      toolName: "find_symbol_definition" as const,
      relation: "definition" as const,
      filePath: symbol.filePath,
      symbolName: symbol.qualifiedName,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      preview: await renderSymbolSnippet(snapshot, symbol, repositoryPath),
      metadata: {
        qualifiedName: symbol.qualifiedName,
      },
    })),
  );
}

async function buildFileArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const files = snapshot.files
    .filter((file) => matchFilePath(file.filePath, query))
    .slice(0, 2);

  return Promise.all(
    files.map(async (file) => ({
      toolName: "read_file_snippet" as const,
      filePath: file.filePath,
      preview: await renderFileSnippet(file.filePath, repositoryPath, {
        fallback: file.summary,
        searchTerms: buildSearchTerms(query),
      }),
      metadata: {
        moduleName: file.moduleName,
        riskTags: file.riskTags,
      },
    })),
  );
}

async function buildCallerArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const targetQualifiedNames = new Set(
    resolveSymbols(snapshot, query).map((symbol) => symbol.qualifiedName),
  );
  const callers = snapshot.edges
    .filter(
      (edge) =>
        edge.edgeType === "calls" &&
        targetQualifiedNames.has(edge.toQualifiedName),
    )
    .map((edge) =>
      snapshot.symbols.find(
        (symbol) => symbol.qualifiedName === edge.fromQualifiedName,
      ),
    )
    .filter((symbol): symbol is Symbol => Boolean(symbol))
    .slice(0, 3);

  return Promise.all(
    callers.map(async (symbol) => ({
      toolName: "find_callers" as const,
      relation: "caller" as const,
      filePath: symbol.filePath,
      symbolName: symbol.qualifiedName,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      preview: await renderSymbolSnippet(snapshot, symbol, repositoryPath),
      metadata: {
        sourceType: "caller",
      },
    })),
  );
}

async function buildCalleeArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const sourceQualifiedNames = new Set(
    resolveSymbols(snapshot, query).map((symbol) => symbol.qualifiedName),
  );
  const callees = snapshot.edges
    .filter(
      (edge) =>
        edge.edgeType === "calls" &&
        sourceQualifiedNames.has(edge.fromQualifiedName),
    )
    .map((edge) =>
      snapshot.symbols.find(
        (symbol) => symbol.qualifiedName === edge.toQualifiedName,
      ),
    )
    .filter((symbol): symbol is Symbol => Boolean(symbol))
    .slice(0, 3);

  return Promise.all(
    callees.map(async (symbol) => ({
      toolName: "find_callees" as const,
      relation: "callee" as const,
      filePath: symbol.filePath,
      symbolName: symbol.qualifiedName,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      preview: await renderSymbolSnippet(snapshot, symbol, repositoryPath),
      metadata: {
        sourceType: "callee",
      },
    })),
  );
}

async function buildTestArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const queryTerms = buildSearchTerms(query);
  const referencedFileNames = resolveSymbols(snapshot, query).map((symbol) =>
    stripExtension(baseName(symbol.filePath)),
  );

  const candidates = snapshot.files
    .filter((file) => isTestLikeFile(file))
    .map((file) => ({
      file,
      score: scoreTestFile(file, queryTerms, referencedFileNames),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((entry) => entry.file);

  return Promise.all(
    candidates.map(async (file) => ({
      toolName: "find_related_tests" as const,
      relation: "test" as const,
      filePath: file.filePath,
      preview: await renderFileSnippet(file.filePath, repositoryPath, {
        fallback: file.summary,
        searchTerms: queryTerms,
      }),
      metadata: {
        moduleName: file.moduleName,
      },
    })),
  );
}

async function buildSchemaArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const queryTerms = buildSearchTerms(query);
  const candidates = snapshot.files
    .filter(
      (file) =>
        file.kind === "schema" ||
        file.filePath.includes("migration") ||
        file.riskTags.includes("database"),
    )
    .map((file) => ({
      file,
      score: scoreFileByTerms(file, queryTerms),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((entry) => entry.file);

  return Promise.all(
    candidates.map(async (file) => ({
      toolName: "find_schema_or_migration" as const,
      relation: "schema" as const,
      filePath: file.filePath,
      preview: await renderFileSnippet(file.filePath, repositoryPath, {
        fallback: file.summary,
        searchTerms: queryTerms,
      }),
      metadata: {
        moduleName: file.moduleName,
        riskTags: file.riskTags,
      },
    })),
  );
}

async function buildConfigArtifacts(
  snapshot: RepositoryContextSnapshot,
  query: string,
  repositoryPath: string,
): Promise<ContextArtifact[]> {
  const queryTerms = buildSearchTerms(query);
  const candidates = snapshot.files
    .filter(
      (file) =>
        file.kind === "config" ||
        file.filePath.includes(".env") ||
        file.filePath.includes("config") ||
        file.riskTags.includes("feature_flag"),
    )
    .map((file) => ({
      file,
      score: scoreFileByTerms(file, queryTerms) + configBoost(file),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 2)
    .map((entry) => entry.file);

  return Promise.all(
    candidates.map(async (file) => ({
      toolName: "read_config_or_feature_flag" as const,
      relation: "config" as const,
      filePath: file.filePath,
      preview: await renderFileSnippet(file.filePath, repositoryPath, {
        fallback: file.summary,
        searchTerms: queryTerms,
      }),
      metadata: {
        moduleName: file.moduleName,
        riskTags: file.riskTags,
      },
    })),
  );
}

function resolveSymbols(
  snapshot: RepositoryContextSnapshot,
  query: string,
): Symbol[] {
  const normalized = query.toLowerCase();
  const kindsPriority = new Map([
    ["route", 1],
    ["class", 2],
    ["function", 3],
    ["method", 4],
    ["interface", 5],
    ["type", 6],
    ["enum", 7],
    ["variable", 8],
    ["module", 9],
  ]);

  return snapshot.symbols
    .filter((symbol) => {
      if (symbol.qualifiedName.toLowerCase() === normalized) {
        return true;
      }
      if (symbol.symbolName.toLowerCase() === normalized) {
        return true;
      }
      if (query.includes("/") && matchFilePath(symbol.filePath, query)) {
        return true;
      }
      return (
        symbol.qualifiedName.toLowerCase().includes(normalized) ||
        symbol.symbolName.toLowerCase().includes(normalized)
      );
    })
    .sort(
      (left, right) =>
        (kindsPriority.get(left.kind) ?? 99) -
        (kindsPriority.get(right.kind) ?? 99),
    );
}

async function renderSymbolSnippet(
  snapshot: RepositoryContextSnapshot,
  symbol: Symbol,
  repositoryPath: string,
): Promise<string> {
  const file = snapshot.files.find((item) => item.filePath === symbol.filePath);
  return renderFileSnippet(symbol.filePath, repositoryPath, {
    fallback: file?.summary,
    startLine: symbol.startLine,
    endLine: symbol.endLine,
    searchTerms: [symbol.symbolName],
    prefix: `${symbol.qualifiedName} 第 ${symbol.startLine}-${symbol.endLine} 行`,
  });
}

async function renderFileSnippet(
  filePath: string,
  repositoryPath: string,
  input: {
    fallback?: string;
    startLine?: number;
    endLine?: number;
    searchTerms?: string[];
    prefix?: string;
  },
): Promise<string> {
  const absolutePath = safeResolvePath(repositoryPath, filePath);
  if (!absolutePath) {
    return input.fallback ?? `${filePath} 无法解析本地路径`;
  }

  try {
    const content = await readFile(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);
    const range = findSnippetRange(lines, input);
    const snippet = lines
      .slice(range.startLine - 1, range.endLine)
      .map((line, index) => `${range.startLine + index}: ${line}`)
      .join("\n")
      .trim();
    const prefix = input.prefix ? `${input.prefix}\n` : "";
    return truncatePreview(`${prefix}${snippet}`);
  } catch {
    return input.fallback ?? `${filePath} 读取失败`;
  }
}

function findSnippetRange(
  lines: string[],
  input: {
    startLine?: number;
    endLine?: number;
    searchTerms?: string[];
  },
) {
  if (input.startLine && input.endLine) {
    return {
      startLine: Math.max(1, input.startLine - 3),
      endLine: Math.min(lines.length, input.endLine + 3),
    };
  }

  const normalizedTerms = (input.searchTerms ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean);
  if (normalizedTerms.length > 0) {
    const matchedIndex = lines.findIndex((line) =>
      normalizedTerms.some((term) => line.toLowerCase().includes(term)),
    );
    if (matchedIndex >= 0) {
      return {
        startLine: Math.max(1, matchedIndex + 1 - 3),
        endLine: Math.min(lines.length, matchedIndex + 1 + 6),
      };
    }
  }

  return {
    startLine: 1,
    endLine: Math.min(lines.length, 12),
  };
}

function appendArtifacts(target: ContextArtifact[], next: ContextArtifact[]) {
  for (const artifact of next) {
    if (!target.some((existing) => sameArtifact(existing, artifact))) {
      target.push(artifact);
    }
  }
}

function shouldUseSemanticFallback(
  reason: string,
  artifacts: ContextArtifact[],
): boolean {
  if (artifacts.length === 0) {
    return true;
  }

  return /README|文档|架构|设计|模块职责|设计意图/i.test(reason);
}

function buildSemanticQuery(request: ContextRequest): string {
  return [
    request.reason,
    ...request.symbols,
    ...request.files,
    ...request.callersOf,
    ...request.calleesOf,
    ...request.tests,
  ]
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");
}

function buildSearchTerms(query: string): string[] {
  return query
    .split(/[^\w\u4e00-\u9fa5/#.-]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 6);
}

function isTestLikeFile(file: RepositoryFile): boolean {
  return (
    file.kind === "test" ||
    /\.(integration|validation|spec|test)\./i.test(file.filePath) ||
    file.filePath.includes("/scripts/")
  );
}

function scoreTestFile(
  file: RepositoryFile,
  queryTerms: string[],
  referencedFileNames: string[],
): number {
  let score = 0;
  score += scoreFileByTerms(file, queryTerms);
  for (const fileName of referencedFileNames) {
    if (file.filePath.includes(fileName)) {
      score += 3;
    }
  }
  if (/\.(integration|validation)\./i.test(file.filePath)) {
    score += 2;
  }
  return score;
}

function scoreFileByTerms(file: RepositoryFile, terms: string[]): number {
  const pathLower = file.filePath.toLowerCase();
  const summaryLower = (file.summary ?? "").toLowerCase();
  return terms.reduce((score, term) => {
    const normalized = term.toLowerCase();
    if (pathLower.includes(normalized)) {
      return score + 3;
    }
    if (summaryLower.includes(normalized)) {
      return score + 1;
    }
    return score;
  }, 0);
}

function configBoost(file: RepositoryFile): number {
  const pathLower = file.filePath.toLowerCase();
  if (pathLower.includes(".env")) {
    return 3;
  }
  if (pathLower.includes("config") || pathLower.includes("flag")) {
    return 2;
  }
  return 1;
}

function sameArtifact(left: ContextArtifact, right: ContextArtifact): boolean {
  return (
    left.toolName === right.toolName &&
    left.filePath === right.filePath &&
    left.symbolName === right.symbolName &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine
  );
}

function isEmptySnapshot(snapshot: RepositoryContextSnapshot): boolean {
  return (
    snapshot.files.length === 0 &&
    snapshot.symbols.length === 0 &&
    snapshot.edges.length === 0
  );
}

function shouldExpandAuthContractContext(
  request: ContextRequest,
  focusFilePath?: string,
): boolean {
  const combined = [
    request.reason,
    focusFilePath ?? "",
    ...request.symbols,
    ...request.files,
    ...request.callersOf,
    ...request.calleesOf,
    ...request.tests,
    ...request.schemaTargets,
  ].join(" ");

  return (
    /(鉴权|auth|jwt|token|refresh|payload|claim|authorization|session|cookie)/i.test(
      combined,
    ) &&
    /(getTokenUserId|createRefreshToken|createAccessToken|verifyToken|handleRefresh|JwtPayload|userId|userID|sub|refresh)/i.test(
      combined,
    )
  );
}

async function loadAuthContractArtifacts(input: {
  snapshot: RepositoryContextSnapshot;
  request: ContextRequest;
  repositoryPath: string;
  focusFilePath?: string;
}): Promise<ContextArtifact[]> {
  const artifacts: ContextArtifact[] = [];
  const queries = collectAuthExpansionQueries(
    input.snapshot,
    input.request,
    input.focusFilePath,
  );

  for (const query of queries.definitionQueries.slice(0, 3)) {
    appendArtifacts(
      artifacts,
      await buildDefinitionArtifacts(
        input.snapshot,
        query,
        input.repositoryPath,
      ),
    );
  }

  if (queries.calleeQuery) {
    appendArtifacts(
      artifacts,
      await buildCalleeArtifacts(
        input.snapshot,
        queries.calleeQuery,
        input.repositoryPath,
      ),
    );
  }

  if (queries.callerQuery) {
    appendArtifacts(
      artifacts,
      await buildCallerArtifacts(
        input.snapshot,
        queries.callerQuery,
        input.repositoryPath,
      ),
    );
  }

  if (queries.testQuery) {
    appendArtifacts(
      artifacts,
      await buildTestArtifacts(
        input.snapshot,
        queries.testQuery,
        input.repositoryPath,
      ),
    );
  }

  return artifacts;
}

function collectAuthExpansionQueries(
  snapshot: RepositoryContextSnapshot,
  request: ContextRequest,
  focusFilePath?: string,
): {
  definitionQueries: string[];
  calleeQuery?: string;
  callerQuery?: string;
  testQuery?: string;
} {
  const requested = [
    ...request.symbols,
    ...request.callersOf,
    ...request.calleesOf,
    ...request.tests,
    ...request.schemaTargets,
  ];
  const focusSymbols = snapshot.symbols
    .filter(
      (symbol) =>
        symbol.filePath === focusFilePath &&
        isAuthExpansionSymbol(symbol.symbolName),
    )
    .map((symbol) => symbol.symbolName);
  const focusQualifiedNames = new Set(
    snapshot.symbols
      .filter((symbol) => symbol.filePath === focusFilePath)
      .map((symbol) => symbol.qualifiedName),
  );
  const neighborSymbols = snapshot.edges
    .filter(
      (edge) =>
        focusQualifiedNames.has(edge.fromQualifiedName) ||
        focusQualifiedNames.has(edge.toQualifiedName),
    )
    .flatMap((edge) => [
      snapshot.symbols.find(
        (symbol) => symbol.qualifiedName === edge.fromQualifiedName,
      ),
      snapshot.symbols.find(
        (symbol) => symbol.qualifiedName === edge.toQualifiedName,
      ),
    ])
    .filter((symbol): symbol is Symbol => Boolean(symbol))
    .filter((symbol) => isHighValueAuthNeighbor(symbol, focusFilePath));

  const prioritized = uniqueStrings(
    [
      ...requested,
      ...focusSymbols,
      ...neighborSymbols.map((symbol) => symbol.symbolName),
      ...neighborSymbols.map((symbol) => symbol.qualifiedName),
      ...deriveAuthFallbackQueries(request, focusFilePath),
    ].filter((value) => isAuthExpansionSymbol(value)),
  ).sort(
    (left, right) =>
      authQueryScore(right, focusFilePath) -
      authQueryScore(left, focusFilePath),
  );

  return {
    definitionQueries: prioritized,
    calleeQuery: prioritized.find((query) =>
      /(handleRefresh|isAuth|getTokenUserId|verifyToken)/i.test(query),
    ),
    callerQuery: prioritized.find((query) =>
      /(getTokenUserId|createRefreshToken|createAccessToken|verifyToken|JwtPayload)/i.test(
        query,
      ),
    ),
    testQuery: prioritized.find((query) =>
      /(getTokenUserId|handleRefresh|isAuth|createRefreshToken|verifyToken)/i.test(
        query,
      ),
    ),
  };
}

function deriveAuthFallbackQueries(
  request: ContextRequest,
  focusFilePath?: string,
): string[] {
  const combined = [
    request.reason,
    focusFilePath ?? "",
    ...request.symbols,
    ...request.callersOf,
    ...request.calleesOf,
  ].join(" ");
  const defaults: string[] = [];

  if (/refresh/i.test(combined)) {
    defaults.push("handleRefresh", "createRefreshToken");
  }
  if (/getTokenUserId/i.test(combined)) {
    defaults.push("getTokenUserId");
  }
  if (/(authorization|bearer|middleware|verifyToken|isAuth)/i.test(combined)) {
    defaults.push("verifyToken", "isAuth", "createAccessToken");
  }
  if (/(JwtPayload|payload|claim|userId|userID|\bsub\b)/i.test(combined)) {
    defaults.push("JwtPayload");
  }

  return defaults;
}

function isAuthExpansionSymbol(value: string): boolean {
  return /(auth|jwt|token|refresh|payload|claim|verify|session|authorization|getTokenUserId|handleRefresh|userId|userID|sub)/i.test(
    value,
  );
}

function isHighValueAuthNeighbor(
  symbol: Symbol,
  focusFilePath?: string,
): boolean {
  return (
    isAuthExpansionSymbol(symbol.symbolName) &&
    symbol.filePath !== focusFilePath
  );
}

function authQueryScore(query: string, focusFilePath?: string): number {
  let score = 0;
  if (
    /(getTokenUserId|createRefreshToken|createAccessToken|verifyToken|handleRefresh|JwtPayload)/i.test(
      query,
    )
  ) {
    score += 8;
  }
  if (focusFilePath && query.includes(focusFilePath)) {
    score -= 2;
  }
  if (/(auth|jwt|token|refresh|payload|claim|session)/i.test(query)) {
    score += 3;
  }
  return score;
}

function uniqueStrings(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || unique.has(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

function matchFilePath(filePath: string, query: string): boolean {
  const normalizedFile = filePath.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  return (
    normalizedFile === normalizedQuery ||
    normalizedFile.endsWith(normalizedQuery) ||
    normalizedFile.includes(normalizedQuery)
  );
}

function safeResolvePath(
  repositoryPath: string,
  filePath: string,
): string | null {
  const resolvedRoot = path.resolve(repositoryPath);
  const absolutePath = path.resolve(repositoryPath, filePath);
  return absolutePath.startsWith(resolvedRoot) ? absolutePath : null;
}

function baseName(value: string): string {
  const lastSegment = value.split("/").pop() ?? value;
  return stripExtension(lastSegment);
}

function stripExtension(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}

function truncatePreview(value: string): string {
  if (value.length <= 1200) {
    return value;
  }
  return `${value.slice(0, 1200)}...`;
}
