import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnifiedDiffPatch } from "@ai-pr-review/diff-core";
import {
  buildReviewAggregateResult,
  finalizeFileReviewComments,
} from "@ai-pr-review/review-core";
import {
  CommentAdmissionDecisionSchema,
  ReviewAggregateResultSchema,
  type FileReview,
  type PullRequestFile,
  type ReviewJob,
} from "@ai-pr-review/shared-types";

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

async function validateFixtures() {
  const accepted = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/comment-admission.accepted.json"),
      "utf8",
    ),
  );
  const suppressed = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/comment-admission.suppressed.json"),
      "utf8",
    ),
  );
  const duplicate = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/comment-admission.duplicate.json"),
      "utf8",
    ),
  );
  const aggregate = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/review-job.aggregate-result.json"),
      "utf8",
    ),
  );

  CommentAdmissionDecisionSchema.parse(accepted);
  CommentAdmissionDecisionSchema.parse(suppressed);
  CommentAdmissionDecisionSchema.parse(duplicate);
  ReviewAggregateResultSchema.parse(aggregate);
}

function expectSuppressionAndDeduplication() {
  const file = {
    filePath: "src/auth.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: [
      "@@ -1,2 +1,3 @@",
      " export function login(token: string) {",
      "-  return token;",
      "+  if (!token) {",
      "+    return token;",
      " }",
    ].join("\n"),
    language: "TypeScript",
  } satisfies PullRequestFile;
  const diff = parseUnifiedDiffPatch(file);

  const finalized = finalizeFileReviewComments({
    reviewJobId: "d4e72e8f-6e3d-4703-90cb-3d0eb6ff9dc4",
    filePath: file.filePath,
    diff,
    triageDecision: "final_review",
    contextRound: 1,
    aiCandidates: [
      {
        diffLineRef: `${file.filePath}#H1:L2+`,
        lineRefs: [`${file.filePath}#H1:L2+`],
        severity: "HIGH",
        category: "bug",
        title: "缺少空 token 处理会导致登录分支误判",
        message:
          "如果 token 为空仍继续返回，会导致上层登录成功分支误判并把未认证请求继续放行。",
        suggestion: "在返回前先显式处理空 token，并让调用方区分失败路径。",
        confidence: 0.81,
        evidenceRefs: [
          "diff:src/auth.ts#H1:L2+",
          "context:find_callers:src/auth.controller.ts",
        ],
        duplicateFingerprint: "auth-login-empty-token",
      },
      {
        diffLineRef: `${file.filePath}#H1:L2+`,
        lineRefs: [`${file.filePath}#H1:L2+`],
        severity: "HIGH",
        category: "bug",
        title: "缺少空 token 处理会导致登录分支误判",
        message:
          "如果 token 为空仍继续返回，会导致上层登录成功分支误判并把未认证请求继续放行。",
        suggestion: "在返回前先显式处理空 token，并让调用方区分失败路径。",
        confidence: 0.81,
        evidenceRefs: [
          "diff:src/auth.ts#H1:L2+",
          "context:find_callers:src/auth.controller.ts",
        ],
        duplicateFingerprint: "auth-login-empty-token",
      },
      {
        diffLineRef: `${file.filePath}#H1:L2+`,
        lineRefs: [`${file.filePath}#H1:L2+`],
        severity: "LOW",
        category: "maintainability",
        title: "建议关注一下",
        message: "建议关注一下这里。",
        confidence: 0.42,
        evidenceRefs: [],
      },
    ],
    ruleViolations: [],
  });

  assert.equal(finalized.aiComments.length, 1, "重复 AI 评论应只保留一条");
  assert.equal(
    finalized.duplicateCount,
    1,
    "重复候选评论应被 duplicate gate 压制",
  );
  assert.equal(
    finalized.admissionDecisions.filter((item) => item.admitted).length,
    1,
    "只有高质量评论应通过 admission gate",
  );
  assert.ok(
    finalized.admissionDecisions.some((item) =>
      item.reasons.includes("与同文件已有评论重复"),
    ),
    "重复评论必须给出重复原因",
  );
}

function expectAggregateSummary() {
  const reviewJob = {
    id: "d4e72e8f-6e3d-4703-90cb-3d0eb6ff9dc4",
    triggerSource: "manual",
    status: "done",
    totalFiles: 1,
    finishedFiles: 1,
    totalSlices: 1,
    finishedSlices: 1,
    cacheHitFiles: 0,
    totalInputTokens: 100,
    totalOutputTokens: 50,
    totalCostUsd: 0,
  } satisfies ReviewJob;
  const fileReview = {
    reviewJobId: reviewJob.id,
    filePath: "src/auth.ts",
    fileStatus: "modified",
    isCached: false,
    sliceCount: 1,
    aiCommentCount: 1,
    ruleCommentCount: 0,
    highestSeverity: "HIGH",
    riskScore: 85,
    triageDecision: "final_review",
    contextRound: 1,
  } satisfies FileReview;
  const aggregate = buildReviewAggregateResult({
    reviewJob,
    pullRequest: {
      provider: "github",
      owner: "acme-inc",
      repo: "payments-service",
      prNumber: 128,
      title: "fix: guard empty token branch",
      authorLogin: "alice",
      baseBranch: "main",
      headBranch: "feature/guard-token",
      baseSha: "fa1f537b9a47b6150c304ba44820ac4f7f55dd27",
      headSha: "b7c9a51db947d15415462f99d3d5174a081fbe43",
      changedFiles: 1,
      additions: 2,
      deletions: 1,
      state: "open",
      files: [],
    },
    fileReviews: [fileReview],
    comments: [
      {
        reviewJobId: reviewJob.id,
        source: "ai",
        category: "bug",
        severity: "HIGH",
        title: "缺少空 token 处理会导致登录分支误判",
        message:
          "如果 token 为空仍继续返回，会导致上层登录成功分支误判并把未认证请求继续放行。",
        filePath: "src/auth.ts",
        diffLineRef: "src/auth.ts#H1:L2+",
        lineStart: 2,
        lineEnd: 2,
        fingerprint: "auth-login-empty-token",
        evidenceRefs: ["diff:src/auth.ts#H1:L2+"],
        qualityScore: 83,
        admissionReasons: ["通过质量门禁"],
        isResolved: false,
      },
    ],
  });

  assert.equal(
    aggregate.summary.mergeRecommendation,
    "request_changes",
    "存在高风险评论时应给出 request_changes",
  );
  assert.ok(
    aggregate.summary.headline.includes("高风险"),
    "headline 应明确指出高风险问题",
  );
}

async function main() {
  await validateFixtures();
  expectSuppressionAndDeduplication();
  expectAggregateSummary();
  console.log("review aggregation validation passed");
}

void main();
