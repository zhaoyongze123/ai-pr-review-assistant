import { createHash } from "node:crypto";
import {
  CommentAdmissionDecisionSchema,
  type CommentAdmissionDecision,
  type DiffParseResult,
  type FileReview,
  type PullRequest,
  type ReviewAggregateResult,
  ReviewAggregateResultSchema,
  type ReviewCategory,
  type ReviewComment,
  ReviewCommentSchema,
  type ReviewCommentCandidate,
  type ReviewDecision,
  type ReviewJob,
  type ReviewSeverity,
  type RuleViolation,
} from "@ai-pr-review/shared-types";
import { evaluateCommentAdmission } from "./comment-admission-gate.js";

export type BuildFileReviewCommentsResult = {
  comments: ReviewComment[];
  aiComments: ReviewComment[];
  ruleComments: ReviewComment[];
  admissionDecisions: CommentAdmissionDecision[];
  beforeGateCount: number;
  afterGateCount: number;
  duplicateCount: number;
  suppressedCount: number;
  qualityScores: number[];
};

export function buildFileReviewComments(input: {
  reviewJobId?: string;
  fileReviewId?: string;
  filePath: string;
  diff: DiffParseResult;
  aiCandidates: ReviewCommentCandidate[];
  ruleViolations: RuleViolation[];
  triageDecision?: ReviewDecision;
  contextRound: number;
}): BuildFileReviewCommentsResult {
  const comments: ReviewComment[] = [];
  const aiComments: ReviewComment[] = [];
  const ruleComments: ReviewComment[] = [];
  const admissionDecisions: CommentAdmissionDecision[] = [];
  const admittedKeys = new Set<string>();
  const admittedLocationKeys = new Set<string>();
  let duplicateCount = 0;
  let suppressedCount = 0;

  for (const candidate of input.aiCandidates) {
    const baseDecision = evaluateCommentAdmission(candidate);
    const duplicateKey = buildCandidateDuplicateKey(candidate);
    const locationKey = buildCandidateLocationKey(candidate);
    const isDuplicate =
      admittedKeys.has(duplicateKey) || admittedLocationKeys.has(locationKey);

    const decision = CommentAdmissionDecisionSchema.parse({
      ...baseDecision,
      admitted: baseDecision.admitted && !isDuplicate,
      reasons: isDuplicate
        ? [...baseDecision.reasons, "与同文件已有评论重复"]
        : baseDecision.reasons,
    });
    admissionDecisions.push(decision);

    if (!decision.admitted) {
      suppressedCount += 1;
      if (isDuplicate) {
        duplicateCount += 1;
      }
      continue;
    }

    const comment = ReviewCommentSchema.parse({
      reviewJobId: input.reviewJobId,
      fileReviewId: input.fileReviewId,
      source: "ai",
      category: candidate.category,
      severity: candidate.severity,
      title: candidate.title,
      message: candidate.message,
      suggestion: candidate.suggestion,
      filePath: input.filePath,
      ...resolveLineWindow(
        input.diff,
        candidate.diffLineRef,
        candidate.lineRefs,
      ),
      fingerprint: shortenFingerprint(
        candidate.duplicateFingerprint ??
          `${input.filePath}:${candidate.category}:${candidate.title}:${candidate.message}`,
      ),
      evidenceRefs: candidate.evidenceRefs,
      qualityScore: decision.score.total,
      admissionReasons: [],
      isResolved: false,
      metadata: {
        triageDecision: input.triageDecision,
        contextRound: input.contextRound,
        score: decision.score,
      },
    });

    comments.push(comment);
    aiComments.push(comment);
    admittedKeys.add(duplicateKey);
    admittedLocationKeys.add(locationKey);
  }

  for (const violation of input.ruleViolations) {
    if (!shouldEmitRuleComment(violation)) {
      continue;
    }

    const diffLineRef = findNearestDiffLineRef(input.diff, violation);
    if (!diffLineRef) {
      continue;
    }

    const locationKey = buildLocationKey(
      diffLineRef,
      mapRuleCategory(violation.category),
    );
    if (admittedLocationKeys.has(locationKey)) {
      duplicateCount += 1;
      continue;
    }

    const comment = ReviewCommentSchema.parse({
      reviewJobId: input.reviewJobId,
      fileReviewId: input.fileReviewId,
      source: "rule",
      category: mapRuleCategory(violation.category),
      severity: violation.severity,
      title: violation.title,
      message: violation.message,
      suggestion: violation.suggestion,
      filePath: input.filePath,
      ...resolveLineWindow(input.diff, diffLineRef, [diffLineRef]),
      fingerprint: shortenFingerprint(
        `rule:${violation.engine}:${violation.ruleId}:${input.filePath}:${violation.lineStart ?? "unknown"}`,
      ),
      evidenceRefs: [
        `rule:${violation.engine}:${violation.ruleId}`,
        `diff:${diffLineRef}`,
      ],
      admissionReasons: ["规则引擎命中高优先级问题"],
      isResolved: false,
      metadata: {
        triageDecision: input.triageDecision,
        contextRound: input.contextRound,
        engine: violation.engine,
        ruleId: violation.ruleId,
      },
    });

    comments.push(comment);
    ruleComments.push(comment);
    admittedLocationKeys.add(locationKey);
  }

  return {
    comments,
    aiComments,
    ruleComments,
    admissionDecisions,
    beforeGateCount: input.aiCandidates.length,
    afterGateCount: aiComments.length,
    duplicateCount,
    suppressedCount,
    qualityScores: admissionDecisions.map((item) => item.score.total),
  };
}

export const finalizeFileReviewComments = buildFileReviewComments;

export function buildFileReviewSummary(input: {
  comments: ReviewComment[];
  fallbackSummary?: string;
  triageDecision?: ReviewDecision;
}): string | undefined {
  const sortedComments = [...input.comments].sort(compareComments);
  if (sortedComments.length > 0) {
    const topComment = sortedComments[0]!;
    return sortedComments.length === 1
      ? `${topComment.title}。`
      : `${topComment.title}，当前文件共输出 ${sortedComments.length} 条最终评论。`;
  }

  if (input.triageDecision === "no_issue") {
    return "当前文件未发现需要开发者处理的有效评论。";
  }

  if (input.triageDecision === "insufficient_evidence") {
    return "当前文件证据不足，系统未输出最终评论。";
  }

  return input.fallbackSummary;
}

export function buildReviewAggregateResult(input: {
  reviewJob: ReviewJob;
  pullRequest: PullRequest;
  fileReviews: FileReview[];
  comments: ReviewComment[];
}): ReviewAggregateResult {
  const sortedComments = [...input.comments].sort(compareComments);
  const unresolvedFiles = input.fileReviews.filter((file) =>
    ["need_more_context", "insufficient_evidence"].includes(
      file.triageDecision ?? "",
    ),
  );
  const highCount = sortedComments.filter(
    (comment) => comment.severity === "HIGH",
  ).length;
  const mediumCount = sortedComments.filter(
    (comment) => comment.severity === "MEDIUM",
  ).length;
  const headline = buildHeadline({
    commentCount: sortedComments.length,
    highCount,
    mediumCount,
    unresolvedCount: unresolvedFiles.length,
  });
  const mergeRecommendation = buildMergeRecommendation({
    comments: sortedComments,
    unresolvedFiles,
    highCount,
    mediumCount,
  });
  const notableFindings = buildNotableFindings(
    sortedComments,
    input.fileReviews,
  );
  const riskSummary = buildRiskSummary({
    comments: sortedComments,
    unresolvedFiles,
    notableFindings,
  });

  return ReviewAggregateResultSchema.parse({
    reviewJob: input.reviewJob,
    pullRequest: input.pullRequest,
    files: input.fileReviews,
    comments: sortedComments,
    summary: {
      headline,
      riskSummary,
      mergeRecommendation,
      notableFindings,
    },
  });
}

function resolveLineWindow(
  diff: DiffParseResult,
  diffLineRef: string | undefined,
  lineRefs: string[],
) {
  const refs = [diffLineRef, ...lineRefs].filter((value): value is string =>
    Boolean(value),
  );
  const entries = refs
    .map((ref) => diff.lineRefMap[ref])
    .filter((entry): entry is NonNullable<(typeof diff.lineRefMap)[string]> =>
      Boolean(entry),
    );

  const newLines = entries
    .map((entry) => entry.newLineNumber)
    .filter((value): value is number => typeof value === "number");
  const oldLines = entries
    .map((entry) => entry.oldLineNumber)
    .filter((value): value is number => typeof value === "number");

  return {
    diffLineRef,
    lineStart: newLines.length > 0 ? Math.min(...newLines) : undefined,
    lineEnd: newLines.length > 0 ? Math.max(...newLines) : undefined,
    oldLineStart: oldLines.length > 0 ? Math.min(...oldLines) : undefined,
    oldLineEnd: oldLines.length > 0 ? Math.max(...oldLines) : undefined,
  };
}

function shouldEmitRuleComment(violation: RuleViolation): boolean {
  return violation.severity === "HIGH" || violation.severity === "MEDIUM";
}

function mapRuleCategory(category: string): ReviewCategory {
  const normalized = category.toLowerCase();
  if (normalized.includes("security") || normalized.includes("auth")) {
    return "security";
  }
  if (normalized.includes("performance") || normalized.includes("perf")) {
    return "performance";
  }
  if (
    normalized.includes("concurrency") ||
    normalized.includes("race") ||
    normalized.includes("deadlock")
  ) {
    return "concurrency";
  }
  if (normalized.includes("test")) {
    return "testing";
  }
  if (normalized.includes("style")) {
    return "style";
  }
  if (
    normalized.includes("bug") ||
    normalized.includes("correct") ||
    normalized.includes("validation")
  ) {
    return "bug";
  }
  return "maintainability";
}

function findNearestDiffLineRef(
  diff: DiffParseResult,
  violation: RuleViolation,
): string | undefined {
  const expectedStart = violation.lineStart;
  if (!expectedStart) {
    return Object.entries(diff.lineRefMap).find(
      ([, entry]) => entry.lineType === "add",
    )?.[0];
  }

  const exact = Object.entries(diff.lineRefMap).find(
    ([, entry]) =>
      entry.newLineNumber === expectedStart ||
      entry.oldLineNumber === expectedStart,
  );
  if (exact) {
    return exact[0];
  }

  return Object.entries(diff.lineRefMap).find(
    ([, entry]) => entry.lineType === "add",
  )?.[0];
}

function buildCandidateDuplicateKey(candidate: ReviewCommentCandidate): string {
  if (candidate.duplicateFingerprint) {
    return `fingerprint:${candidate.duplicateFingerprint}`;
  }

  return [
    candidate.diffLineRef ?? "no-ref",
    candidate.category,
    candidate.severity,
    normalizeText(candidate.title),
  ].join("|");
}

function buildCandidateLocationKey(candidate: ReviewCommentCandidate): string {
  return buildLocationKey(
    candidate.diffLineRef ?? "no-ref",
    candidate.category,
  );
}

function buildLocationKey(
  diffLineRef: string,
  category: ReviewCategory,
): string {
  return `${diffLineRef}|${category}`;
}

function buildHeadline(input: {
  commentCount: number;
  highCount: number;
  mediumCount: number;
  unresolvedCount: number;
}): string {
  if (input.unresolvedCount > 0 && input.commentCount === 0) {
    return `当前仍有 ${input.unresolvedCount} 个文件证据不足，无法给出稳定审查结论。`;
  }
  if (input.highCount > 0) {
    return `PR 发现 ${input.highCount} 个高风险问题，建议修改后再合并。`;
  }
  if (input.mediumCount > 0) {
    return `PR 发现 ${input.commentCount} 条需要开发者处理的审查评论。`;
  }
  if (input.commentCount > 0) {
    return `PR 发现 ${input.commentCount} 条低到中风险评论，可按优先级处理。`;
  }
  return "PR 当前未发现需要开发者处理的高信号问题。";
}

function buildMergeRecommendation(input: {
  comments: ReviewComment[];
  unresolvedFiles: FileReview[];
  highCount: number;
  mediumCount: number;
}) {
  if (
    input.unresolvedFiles.some(
      (file) => file.triageDecision === "need_more_context",
    )
  ) {
    return "blocked" as const;
  }
  if (input.comments.length === 0 && input.unresolvedFiles.length > 0) {
    return "insufficient_evidence" as const;
  }
  if (input.highCount > 0 || input.mediumCount >= 2) {
    return "request_changes" as const;
  }
  if (input.comments.length > 0) {
    return "comment" as const;
  }
  return "approve" as const;
}

function buildRiskSummary(input: {
  comments: ReviewComment[];
  unresolvedFiles: FileReview[];
  notableFindings: string[];
}): string {
  if (input.comments.length === 0 && input.unresolvedFiles.length > 0) {
    return `仍有 ${input.unresolvedFiles.length} 个文件停留在证据不足或待补上下文状态，当前结论不适合直接作为合并依据。`;
  }
  if (input.comments.length === 0) {
    return "规则引擎与模型都没有发现需要处理的高信号问题。";
  }

  return `风险主要集中在：${input.notableFindings.slice(0, 3).join("；")}。`;
}

function buildNotableFindings(
  comments: ReviewComment[],
  fileReviews: FileReview[],
): string[] {
  const findings = comments
    .map((comment) => comment.title)
    .filter((title, index, all) => all.indexOf(title) === index)
    .slice(0, 3);

  if (findings.length > 0) {
    return findings;
  }

  return fileReviews
    .map((file) => file.summary)
    .filter((summary): summary is string => Boolean(summary))
    .slice(0, 3);
}

function compareComments(left: ReviewComment, right: ReviewComment): number {
  return severityWeight(right.severity) - severityWeight(left.severity);
}

function severityWeight(severity: ReviewSeverity): number {
  switch (severity) {
    case "HIGH":
      return 4;
    case "MEDIUM":
      return 3;
    case "LOW":
      return 2;
    case "INFO":
      return 1;
  }
}

function shortenFingerprint(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 96);
}
