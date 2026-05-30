import { evaluateCommentAdmission } from "./comment-admission-gate.js";
import { createContextFetchPlan } from "./context-fetcher.js";
import { scoreCommentCandidate } from "./quality-scoring.js";
import { evaluateReviewTriage } from "./review-triage.js";
import type {
  ContextBudget,
  ContextFetchResult,
  DiffParseResult,
  PullRequestFile,
  RuleViolation,
  ReviewCommentCandidate,
  ReviewTriageDecision,
} from "@ai-pr-review/shared-types";

export interface ReviewPipelineResult {
  triage: ReturnType<typeof evaluateReviewTriage>;
  contextPlan?: ContextFetchResult;
  scoredFindings: Array<{
    candidate: ReviewCommentCandidate;
    qualityScore: ReturnType<typeof scoreCommentCandidate>;
    admission: ReturnType<typeof evaluateCommentAdmission>;
  }>;
}

export interface FirstPassReviewInput {
  reviewJobId: string;
  file: PullRequestFile;
  diff: DiffParseResult;
  ruleViolations?: RuleViolation[];
}

export interface FirstPassReviewPipelineResult extends ReviewPipelineResult {
  firstPass: ReviewTriageDecision;
}

export function runReviewPipeline(
  decision: ReviewTriageDecision,
  budget: ContextBudget,
): ReviewPipelineResult {
  const triage = evaluateReviewTriage(decision, budget);
  const scoredFindings = (decision.provisionalFindings ?? []).map(
    (candidate) => ({
      candidate,
      qualityScore: scoreCommentCandidate(candidate),
      admission: evaluateCommentAdmission(candidate),
    }),
  );

  if (triage.action !== "fetch_more_context" || !decision.contextRequest) {
    return {
      triage,
      scoredFindings,
    };
  }

  return {
    triage,
    contextPlan: createContextFetchPlan(decision.contextRequest, budget),
    scoredFindings,
  };
}

export function runFirstPassReviewPipeline(
  input: FirstPassReviewInput,
): FirstPassReviewPipelineResult {
  const firstPass = createHeuristicFirstPassDecision(input);
  const budget = createDefaultFirstPassBudget();
  const pipeline = runReviewPipeline(firstPass, budget);

  return {
    ...pipeline,
    firstPass,
  };
}

function createHeuristicFirstPassDecision(
  input: FirstPassReviewInput,
): ReviewTriageDecision {
  const highestRule = pickHighestSeverityRule(input.ruleViolations ?? []);
  const addedLineRefs = Object.entries(input.diff.lineRefMap)
    .filter(([, value]) => value.lineType === "add")
    .map(([ref]) => ref);

  if (!highestRule) {
    return {
      decision: addedLineRefs.length > 0 ? "insufficient_evidence" : "no_issue",
      confidence: addedLineRefs.length > 0 ? 0.42 : 0.78,
      riskLevel: "low",
      rationale:
        addedLineRefs.length > 0
          ? "首轮只看到 diff 变化，缺少规则或仓库证据支撑，不直接生成评论"
          : "没有新增可审查 diff 行，也没有规则命中",
      evidenceCoverage: createEvidenceCoverage(false),
      provisionalFindings: [],
    };
  }

  const diffLineRef = findNearestDiffLineRef(input.diff, highestRule);
  const candidate: ReviewCommentCandidate = {
    diffLineRef,
    lineRefs: diffLineRef ? [diffLineRef] : [],
    severity: highestRule.severity,
    category: mapRuleCategory(highestRule.category),
    title: highestRule.title,
    message: highestRule.message,
    suggestion: highestRule.suggestion,
    confidence: 0.72,
    evidenceRefs: [
      `rule:${highestRule.engine}:${highestRule.ruleId}`,
      `diff:${input.file.filePath}`,
    ],
    duplicateFingerprint: `${highestRule.engine}:${highestRule.ruleId}:${input.file.filePath}:${highestRule.lineStart ?? "unknown"}`,
  };

  return {
    decision:
      highestRule.severity === "HIGH" ? "need_more_context" : "final_review",
    confidence: highestRule.severity === "HIGH" ? 0.68 : 0.76,
    riskLevel: highestRule.severity === "HIGH" ? "high" : "medium",
    rationale:
      highestRule.severity === "HIGH"
        ? "规则命中高风险问题，首轮先保留发现并请求调用方、测试或配置证据"
        : "规则命中中低风险问题，已有 diff 锚点和规则证据，可进入后续准入判断",
    evidenceCoverage: createEvidenceCoverage(true),
    provisionalFindings: [candidate],
    contextRequest:
      highestRule.severity === "HIGH"
        ? {
            reason: "高风险规则命中需要补充调用方、测试或配置证据以降低误报",
            symbols: [],
            files: [input.file.filePath],
            callersOf: [input.file.filePath],
            calleesOf: [],
            tests: [input.file.filePath],
            schemaTargets: [],
          }
        : undefined,
  };
}

function createDefaultFirstPassBudget(): ContextBudget {
  return {
    maxRounds: 1,
    maxToolCalls: 4,
    maxExtraFiles: 3,
    maxCallDepth: 1,
    maxExtraTokens: 4000,
    usedRounds: 0,
    usedToolCalls: 0,
    usedExtraFiles: 0,
    usedExtraTokens: 0,
  };
}

function createEvidenceCoverage(hasRuleEvidence: boolean) {
  return {
    modifiedSymbol: false,
    localContext: hasRuleEvidence,
    callers: false,
    callees: false,
    tests: false,
    schema: false,
  };
}

function pickHighestSeverityRule(
  violations: RuleViolation[],
): RuleViolation | undefined {
  const severityWeight = { HIGH: 4, MEDIUM: 3, LOW: 2, INFO: 1 };
  return [...violations].sort(
    (left, right) =>
      severityWeight[right.severity] - severityWeight[left.severity],
  )[0];
}

function findNearestDiffLineRef(
  diff: DiffParseResult,
  violation: RuleViolation,
): string | undefined {
  if (!violation.lineStart) {
    return Object.keys(diff.lineRefMap)[0];
  }

  const exact = Object.entries(diff.lineRefMap).find(
    ([, value]) =>
      value.newLineNumber === violation.lineStart ||
      value.oldLineNumber === violation.lineStart,
  );
  if (exact) {
    return exact[0];
  }

  return Object.entries(diff.lineRefMap).find(
    ([, value]) => value.lineType === "add",
  )?.[0];
}

function mapRuleCategory(category: string): ReviewCommentCandidate["category"] {
  const normalized = category.toLowerCase();
  if (normalized.includes("security")) {
    return "security";
  }
  if (normalized.includes("bug") || normalized.includes("correctness")) {
    return "bug";
  }
  if (normalized.includes("performance")) {
    return "performance";
  }
  if (normalized.includes("test")) {
    return "testing";
  }
  return "maintainability";
}
