import {
  type ContextBudget,
  ContextBudgetSchema,
  type ContextFetchResult,
  ContextFetchResultSchema,
  type ContextRequest,
  ContextRequestSchema,
  type ContextToolName,
  type PlannedToolCall,
} from "@ai-pr-review/shared-types";

const TOOL_COSTS: Record<ContextToolName, { files: number; tokens: number }> = {
  find_symbol_definition: { files: 1, tokens: 800 },
  find_callers: { files: 2, tokens: 1200 },
  find_callees: { files: 2, tokens: 1200 },
  read_file_snippet: { files: 1, tokens: 900 },
  find_related_tests: { files: 2, tokens: 1200 },
  find_schema_or_migration: { files: 2, tokens: 1000 },
  read_config_or_feature_flag: { files: 1, tokens: 600 },
};

function appendToolCalls(
  toolName: ContextToolName,
  values: string[],
  plannedCalls: PlannedToolCall[],
) {
  for (const value of values) {
    plannedCalls.push({
      toolName,
      query: value,
      estimatedFiles: TOOL_COSTS[toolName].files,
      estimatedTokens: TOOL_COSTS[toolName].tokens,
    });
  }
}

export function createContextFetchPlan(
  requestInput: ContextRequest,
  budgetInput: ContextBudget,
): ContextFetchResult {
  const request = normalizeContextRequest(
    ContextRequestSchema.parse(requestInput),
  );
  const budget = ContextBudgetSchema.parse(budgetInput);
  const requestedCalls: PlannedToolCall[] = [];

  appendToolCalls("find_symbol_definition", request.symbols, requestedCalls);
  appendToolCalls("read_file_snippet", request.files, requestedCalls);
  appendToolCalls("find_callers", request.callersOf, requestedCalls);
  appendToolCalls("find_callees", request.calleesOf, requestedCalls);
  appendToolCalls("find_related_tests", request.tests, requestedCalls);
  appendToolCalls(
    "find_schema_or_migration",
    request.schemaTargets,
    requestedCalls,
  );

  if (
    request.reason.toLowerCase().includes("flag") ||
    request.reason.includes("开关")
  ) {
    appendToolCalls(
      "read_config_or_feature_flag",
      [request.reason],
      requestedCalls,
    );
  }

  if (requestedCalls.length === 0) {
    return ContextFetchResultSchema.parse({
      status: "skipped",
      reason: "没有请求任何可执行的上下文检索项",
      plannedCalls: [],
      artifacts: [],
      remainingBudget: budget,
    });
  }

  const selectedCalls: PlannedToolCall[] = [];
  let nextToolCalls = budget.usedToolCalls;
  let nextFiles = budget.usedExtraFiles;
  let nextTokens = budget.usedExtraTokens;

  for (const call of requestedCalls) {
    const candidateToolCalls = nextToolCalls + 1;
    const candidateFiles = nextFiles + call.estimatedFiles;
    const candidateTokens = nextTokens + call.estimatedTokens;

    if (
      candidateToolCalls > budget.maxToolCalls ||
      candidateFiles > budget.maxExtraFiles ||
      candidateTokens > budget.maxExtraTokens
    ) {
      continue;
    }

    selectedCalls.push(call);
    nextToolCalls = candidateToolCalls;
    nextFiles = candidateFiles;
    nextTokens = candidateTokens;
  }

  if (selectedCalls.length === 0) {
    return ContextFetchResultSchema.parse({
      status: "budget_exceeded",
      reason: "上下文检索计划超过预算，不继续扩张上下文",
      plannedCalls: requestedCalls,
      artifacts: [],
      remainingBudget: budget,
    });
  }

  return ContextFetchResultSchema.parse({
    status: "planned",
    reason:
      selectedCalls.length === requestedCalls.length
        ? "上下文检索计划已生成，可交由 Context Fetcher 执行"
        : "上下文检索计划已按预算裁剪，仅保留最高优先级的证据检索项",
    plannedCalls: selectedCalls,
    artifacts: [],
    remainingBudget: {
      ...budget,
      usedToolCalls: nextToolCalls,
      usedExtraFiles: nextFiles,
      usedExtraTokens: nextTokens,
      usedRounds: budget.usedRounds + 1,
    },
  });
}

function normalizeContextRequest(request: ContextRequest): ContextRequest {
  const authHeavyRequest = isAuthHeavyRequest(request);
  return {
    ...request,
    symbols: normalizeRequestItems(request.symbols, authHeavyRequest ? 4 : 2),
    files: normalizeRequestItems(request.files, authHeavyRequest ? 3 : 2),
    callersOf: normalizeRequestItems(
      request.callersOf,
      authHeavyRequest ? 2 : 1,
    ),
    calleesOf: normalizeRequestItems(
      request.calleesOf,
      authHeavyRequest ? 2 : 1,
    ),
    tests: normalizeRequestItems(request.tests, authHeavyRequest ? 2 : 1),
    schemaTargets: normalizeRequestItems(
      request.schemaTargets,
      authHeavyRequest ? 2 : 1,
    ),
  };
}

function normalizeRequestItems(values: string[], limit: number): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
    if (unique.size >= limit) {
      break;
    }
  }

  return Array.from(unique);
}

function isAuthHeavyRequest(request: ContextRequest): boolean {
  const combined = [
    request.reason,
    ...request.symbols,
    ...request.files,
    ...request.callersOf,
    ...request.calleesOf,
    ...request.tests,
    ...request.schemaTargets,
  ].join(" ");

  return /(鉴权|auth|jwt|token|refresh|payload|claim|authorization|session|cookie|getTokenUserId|verifyToken)/i.test(
    combined,
  );
}
