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
  const request = ContextRequestSchema.parse(requestInput);
  const budget = ContextBudgetSchema.parse(budgetInput);
  const plannedCalls: PlannedToolCall[] = [];

  appendToolCalls("find_symbol_definition", request.symbols, plannedCalls);
  appendToolCalls("read_file_snippet", request.files, plannedCalls);
  appendToolCalls("find_callers", request.callersOf, plannedCalls);
  appendToolCalls("find_callees", request.calleesOf, plannedCalls);
  appendToolCalls("find_related_tests", request.tests, plannedCalls);
  appendToolCalls(
    "find_schema_or_migration",
    request.schemaTargets,
    plannedCalls,
  );

  if (
    request.reason.toLowerCase().includes("flag") ||
    request.reason.includes("开关")
  ) {
    appendToolCalls(
      "read_config_or_feature_flag",
      [request.reason],
      plannedCalls,
    );
  }

  if (plannedCalls.length === 0) {
    return ContextFetchResultSchema.parse({
      status: "skipped",
      reason: "没有请求任何可执行的上下文检索项",
      plannedCalls: [],
      artifacts: [],
      remainingBudget: budget,
    });
  }

  const nextToolCalls = budget.usedToolCalls + plannedCalls.length;
  const nextFiles =
    budget.usedExtraFiles +
    plannedCalls.reduce((sum, call) => sum + call.estimatedFiles, 0);
  const nextTokens =
    budget.usedExtraTokens +
    plannedCalls.reduce((sum, call) => sum + call.estimatedTokens, 0);

  if (
    nextToolCalls > budget.maxToolCalls ||
    nextFiles > budget.maxExtraFiles ||
    nextTokens > budget.maxExtraTokens
  ) {
    return ContextFetchResultSchema.parse({
      status: "budget_exceeded",
      reason: "上下文检索计划超过预算，不继续扩张上下文",
      plannedCalls,
      artifacts: [],
      remainingBudget: budget,
    });
  }

  return ContextFetchResultSchema.parse({
    status: "planned",
    reason: "上下文检索计划已生成，可交由 Context Fetcher 执行",
    plannedCalls,
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
