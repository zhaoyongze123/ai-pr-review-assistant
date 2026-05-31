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
  SecondPassReviewResult,
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

export function calibrateFirstPassDecision(input: {
  decision: ReviewTriageDecision;
  file: PullRequestFile;
  diff: DiffParseResult;
  ruleViolations?: RuleViolation[];
}): ReviewTriageDecision {
  const normalized = normalizeDecisionShape(input.decision);
  const ruleViolations = input.ruleViolations ?? [];

  if (
    ruleViolations.length === 0 &&
    ["insufficient_evidence", "need_more_context"].includes(
      normalized.decision,
    ) &&
    normalized.provisionalFindings.length === 0 &&
    isDocumentationFile(input.file.filePath)
  ) {
    return {
      ...normalized,
      decision: "no_issue",
      confidence: Math.max(normalized.confidence, 0.7),
      riskLevel: "low",
      rationale:
        "当前改动只落在文档或说明文件，没有规则命中，也没有足以形成代码缺陷评论的证据，不应把文档改动升级为证据不足告警。",
      provisionalFindings: [],
      contextRequest: undefined,
    };
  }

  if (
    ruleViolations.length === 0 &&
    ["insufficient_evidence", "need_more_context"].includes(
      normalized.decision,
    ) &&
    normalized.provisionalFindings.length === 0 &&
    isTrivialPresentationFieldAddition(input.diff)
  ) {
    return {
      ...normalized,
      decision: "no_issue",
      confidence: Math.max(normalized.confidence, 0.72),
      riskLevel: "low",
      rationale:
        "本次改动只是在现有返回对象中新增简单展示字段，没有看到控制流、副作用、鉴权、持久化或并发语义变化，不应把这类低信号字段补充升级为证据不足告警。",
      provisionalFindings: [],
      contextRequest: undefined,
    };
  }

  if (
    ruleViolations.length === 0 &&
    normalized.decision === "final_review" &&
    shouldDowngradeContextSensitiveConclusion({
      diff: input.diff,
      evidenceCoverage: normalized.evidenceCoverage,
      candidates: normalized.provisionalFindings,
    })
  ) {
    return {
      ...normalized,
      decision: "need_more_context",
      confidence: Math.min(normalized.confidence, 0.68),
      riskLevel:
        normalized.riskLevel === "high" ? "medium" : normalized.riskLevel,
      rationale:
        "当前 diff 更像带有 audit/debug/internal 语义的内部辅助函数或占位实现。仅凭局部 diff 看到的返回值形态，还不足以把它断言成确定性业务缺陷，需要先确认路由暴露方式、调用方鉴权和真实数据来源。",
      provisionalFindings: [],
      contextRequest: buildContextSensitiveRequest(input.file, input.diff),
    };
  }

  return normalized;
}

export function calibrateSecondPassResult(input: {
  result: SecondPassReviewResult;
  file: PullRequestFile;
  diff: DiffParseResult;
  firstPass: ReviewTriageDecision;
}): SecondPassReviewResult {
  const normalized = normalizeSecondPassShape(input.result);

  if (
    normalized.decision === "final_review" &&
    shouldDowngradeWeaklyEvidencedSecondPass({
      diff: input.diff,
      firstPass: input.firstPass,
      candidates: normalized.candidateComments,
    }) &&
    !hasStrongContextEvidence(normalized.candidateComments)
  ) {
    return {
      decision: "insufficient_evidence",
      confidence: Math.min(normalized.confidence, 0.62),
      rationale:
        "虽然补充了一轮上下文，但当前证据仍不足以确认这是稳定成立的业务缺陷。对于 audit/debug/internal 语义的函数，若没有调用方、路由或 schema 证据，不应直接输出确定性评论。",
      candidateComments: [],
    };
  }

  return normalized;
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

function normalizeDecisionShape(
  decision: ReviewTriageDecision,
): ReviewTriageDecision {
  if (decision.decision === "need_more_context") {
    return decision;
  }

  return {
    ...decision,
    provisionalFindings:
      decision.decision === "no_issue" ? [] : decision.provisionalFindings,
    contextRequest: undefined,
  };
}

function normalizeSecondPassShape(
  result: SecondPassReviewResult,
): SecondPassReviewResult {
  return {
    ...result,
    candidateComments:
      result.decision === "no_issue" ? [] : result.candidateComments,
  };
}

function isTrivialPresentationFieldAddition(diff: DiffParseResult): boolean {
  const addedLines = diff.hunks.flatMap((hunk) =>
    hunk.lines.filter((line) => line.lineType === "add"),
  );
  const nonEmptyAddedLines = addedLines.filter(
    (line) => line.content.trim().length > 0,
  );

  if (
    nonEmptyAddedLines.length === 0 ||
    nonEmptyAddedLines.length > 2 ||
    diff.totalRemovedLines > 0
  ) {
    return false;
  }

  const hasReturnObjectContext = diff.hunks.some((hunk) =>
    hunk.lines.some(
      (line) =>
        line.lineType === "context" && line.content.includes("return {"),
    ),
  );
  if (!hasReturnObjectContext) {
    return false;
  }

  const suspiciousPattern =
    /\b(token|secret|password|admin|auth|permission|scope|sessionSecret|cookie|header)\b/i;
  const controlFlowPattern =
    /\b(if|for|while|switch|throw|await|try|catch|new|return)\b|=>|function\s+/;

  return nonEmptyAddedLines.every((line) => {
    const content = line.content.trim();
    return (
      /^[A-Za-z_$][\w$]*:\s*.+,?$/.test(content) &&
      !suspiciousPattern.test(content) &&
      !controlFlowPattern.test(content)
    );
  });
}

function shouldDowngradeContextSensitiveConclusion(input: {
  diff: DiffParseResult;
  evidenceCoverage: ReviewTriageDecision["evidenceCoverage"];
  candidates: ReviewCommentCandidate[];
}): boolean {
  if (input.candidates.length === 0) {
    return false;
  }

  if (
    input.evidenceCoverage.callers ||
    input.evidenceCoverage.callees ||
    input.evidenceCoverage.tests ||
    input.evidenceCoverage.schema
  ) {
    return false;
  }

  const functionNames = extractIntroducedFunctionNames(input.diff);
  if (
    functionNames.length === 0 ||
    !functionNames.some((name) => isContextSensitiveFunctionName(name))
  ) {
    return false;
  }

  const hasSecurityOrConcurrencyFinding = input.candidates.some((candidate) =>
    ["security", "concurrency", "performance"].includes(candidate.category),
  );
  if (hasSecurityOrConcurrencyFinding) {
    return false;
  }

  return input.candidates.every((candidate) => {
    const diffOnlyEvidence = candidate.evidenceRefs.every((ref) =>
      ref.startsWith("diff:"),
    );
    return (
      diffOnlyEvidence &&
      candidate.severity !== "HIGH" &&
      !containsHighRiskKeyword(candidate.title) &&
      !containsHighRiskKeyword(candidate.message)
    );
  });
}

function shouldDowngradeWeaklyEvidencedSecondPass(input: {
  diff: DiffParseResult;
  firstPass: ReviewTriageDecision;
  candidates: ReviewCommentCandidate[];
}): boolean {
  if (
    !shouldDowngradeContextSensitiveConclusion({
      diff: input.diff,
      evidenceCoverage: input.firstPass.evidenceCoverage,
      candidates: input.candidates.map((candidate) => ({
        ...candidate,
        evidenceRefs: candidate.evidenceRefs.filter((ref) =>
          ref.startsWith("diff:"),
        ),
      })),
    })
  ) {
    return false;
  }

  return input.candidates.every((candidate) =>
    candidate.evidenceRefs.every(
      (ref) =>
        ref.startsWith("diff:") ||
        /^context:(find_symbol_definition|read_file_snippet|find_callees):/.test(
          ref,
        ),
    ),
  );
}

function extractIntroducedFunctionNames(diff: DiffParseResult): string[] {
  const names = new Set<string>();

  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (line.lineType !== "add") {
        continue;
      }

      const content = line.content.trim();
      const matches = [
        /^export function ([A-Za-z_$][\w$]*)/.exec(content),
        /^function ([A-Za-z_$][\w$]*)/.exec(content),
        /^export const ([A-Za-z_$][\w$]*)\s*=/.exec(content),
        /^const ([A-Za-z_$][\w$]*)\s*=/.exec(content),
      ];

      for (const match of matches) {
        if (match?.[1]) {
          names.add(match[1]);
        }
      }
    }
  }

  return [...names];
}

function isContextSensitiveFunctionName(name: string): boolean {
  return /(audit|debug|internal|mock|preview|sample|example|test)/i.test(name);
}

function buildContextSensitiveRequest(
  file: PullRequestFile,
  diff: DiffParseResult,
): ReviewTriageDecision["contextRequest"] {
  const functionNames = extractIntroducedFunctionNames(diff);

  return {
    reason:
      "需要确认新增辅助函数的调用方、路由暴露方式和真实数据来源后，才能判断它是占位实现、内部工具还是会进入正式业务链路。",
    symbols: functionNames,
    files: [file.filePath],
    callersOf: functionNames.length > 0 ? functionNames : [file.filePath],
    calleesOf: functionNames,
    tests: functionNames.length > 0 ? functionNames : [file.filePath],
    schemaTargets: functionNames,
  };
}

function hasStrongContextEvidence(
  candidates: ReviewCommentCandidate[],
): boolean {
  const strongEvidencePattern =
    /^context:(find_callers|find_related_tests|find_schema_or_migration|read_config_or_feature_flag):/;
  return candidates.some((candidate) =>
    candidate.evidenceRefs.some((ref) => strongEvidencePattern.test(ref)),
  );
}

function containsHighRiskKeyword(value: string): boolean {
  return /(鉴权|权限|越权|泄露|伪造|管理员|admin|secret|token|绕过|注入|执行)/i.test(
    value,
  );
}

function isDocumentationFile(filePath: string): boolean {
  return (
    /(^|\/)(docs?|adr)\//i.test(filePath) ||
    /\.(md|mdx|txt|rst)$/i.test(filePath)
  );
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
