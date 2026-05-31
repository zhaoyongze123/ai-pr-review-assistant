import assert from "node:assert/strict";
import type { DiffParseResult } from "@ai-pr-review/shared-types";
import {
  calibrateFirstPassDecision,
  calibrateSecondPassResult,
  runFirstPassReviewPipeline,
} from "./review-pipeline.js";

const result = runFirstPassReviewPipeline({
  reviewJobId: "job-fixture-1",
  file: {
    filePath: "src/auth.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: "@@ -1,1 +1,2 @@\n const user = findUser();\n+return user.token;",
  },
  diff: {
    filePath: "src/auth.ts",
    language: "TypeScript",
    totalAddedLines: 1,
    totalRemovedLines: 0,
    lineRefMap: {
      "src/auth.ts#H1:L2+": {
        hunkId: "src/auth.ts#H1",
        lineType: "add",
        newLineNumber: 2,
      },
    },
    hunks: [
      {
        hunkId: "src/auth.ts#H1",
        header: "@@ -1,1 +1,2 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 2,
        lines: [
          {
            ref: "src/auth.ts#H1:L2+",
            lineType: "add",
            newLineNumber: 2,
            content: "return user.token;",
          },
        ],
      },
    ],
  },
  ruleViolations: [
    {
      source: "rule",
      engine: "semgrep",
      ruleId: "auth.raw-token-return",
      filePath: "src/auth.ts",
      severity: "HIGH",
      category: "security",
      title: "Raw token returned",
      message: "Token is returned without session guard.",
      lineStart: 2,
    },
  ],
});

assert.equal(result.triage.action, "fetch_more_context");
assert.equal(result.firstPass.decision, "need_more_context");
assert.equal(result.firstPass.provisionalFindings.length, 1);
assert.equal(result.scoredFindings.length, 1);
assert.equal(
  result.firstPass.provisionalFindings[0]?.diffLineRef,
  "src/auth.ts#H1:L2+",
);

const lowSignalDiff: DiffParseResult = {
  filePath: "src/users/users.controller.ts",
  language: "TypeScript",
  totalAddedLines: 1,
  totalRemovedLines: 0,
  lineRefMap: {
    "src/users/users.controller.ts#H1:L25+": {
      hunkId: "src/users/users.controller.ts#H1",
      lineType: "add",
      newLineNumber: 25,
    },
  },
  hunks: [
    {
      hunkId: "src/users/users.controller.ts#H1",
      header:
        "@@ -22,5 +22,6 @@ export function readMyProfile(accessToken: string) {",
      oldStart: 22,
      oldLines: 5,
      newStart: 22,
      newLines: 6,
      lines: [
        {
          ref: "src/users/users.controller.ts#H1:L22",
          lineType: "context",
          oldLineNumber: 22,
          newLineNumber: 22,
          content: "  return {",
        },
        {
          ref: "src/users/users.controller.ts#H1:L25+",
          lineType: "add",
          newLineNumber: 25,
          content: "    displayName: `User ${session.userId}`,",
        },
      ],
    },
  ],
};

const calibratedNoIssue = calibrateFirstPassDecision({
  decision: {
    decision: "insufficient_evidence",
    confidence: 0.43,
    riskLevel: "low",
    rationale: "只看到一行字段新增。",
    evidenceCoverage: {
      modifiedSymbol: true,
      localContext: true,
      callers: false,
      callees: false,
      tests: false,
      schema: false,
    },
    provisionalFindings: [],
  },
  file: {
    filePath: "src/users/users.controller.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch:
      "@@ -22,5 +22,6 @@\n   return {\n+    displayName: `User ${session.userId}`,\n   };",
  },
  diff: lowSignalDiff,
  ruleViolations: [],
});

assert.equal(calibratedNoIssue.decision, "no_issue");
assert.equal(calibratedNoIssue.provisionalFindings.length, 0);

const calibratedDocNoIssue = calibrateFirstPassDecision({
  decision: {
    decision: "insufficient_evidence",
    confidence: 0.41,
    riskLevel: "low",
    rationale: "文档里提到了潜在风险，但没有形成代码评论。",
    evidenceCoverage: {
      modifiedSymbol: false,
      localContext: true,
      callers: false,
      callees: false,
      tests: false,
      schema: false,
    },
    provisionalFindings: [],
  },
  file: {
    filePath: "docs/review-expectations.md",
    status: "modified",
    additions: 18,
    deletions: 0,
    patch: "@@ -3,3 +3,21 @@\n+## PR 5",
  },
  diff: {
    filePath: "docs/review-expectations.md",
    language: "Markdown",
    totalAddedLines: 18,
    totalRemovedLines: 0,
    lineRefMap: {
      "docs/review-expectations.md#H1:L7+": {
        hunkId: "docs/review-expectations.md#H1",
        lineType: "add",
        newLineNumber: 7,
      },
    },
    hunks: [
      {
        hunkId: "docs/review-expectations.md#H1",
        header: "@@ -3,3 +3,21 @@",
        oldStart: 3,
        oldLines: 3,
        newStart: 3,
        newLines: 21,
        lines: [
          {
            ref: "docs/review-expectations.md#H1:L7+",
            lineType: "add",
            newLineNumber: 7,
            content: "## PR 5: insufficient evidence audit profile",
          },
        ],
      },
    ],
  },
  ruleViolations: [],
});

assert.equal(calibratedDocNoIssue.decision, "no_issue");

const contextSensitiveDiff: DiffParseResult = {
  filePath: "src/users/users.controller.ts",
  language: "TypeScript",
  totalAddedLines: 6,
  totalRemovedLines: 0,
  lineRefMap: {
    "src/users/users.controller.ts#H1:L28+": {
      hunkId: "src/users/users.controller.ts#H1",
      lineType: "add",
      newLineNumber: 28,
    },
    "src/users/users.controller.ts#H1:L31+": {
      hunkId: "src/users/users.controller.ts#H1",
      lineType: "add",
      newLineNumber: 31,
    },
  },
  hunks: [
    {
      hunkId: "src/users/users.controller.ts#H1",
      header:
        "@@ -24,3 +24,10 @@ export function readMyProfile(accessToken: string) {",
      oldStart: 24,
      oldLines: 3,
      newStart: 24,
      newLines: 10,
      lines: [
        {
          ref: "src/users/users.controller.ts#H1:L28+",
          lineType: "add",
          newLineNumber: 28,
          content:
            "export function readUserProfileForAudit(requestedUserId: string) {",
        },
        {
          ref: "src/users/users.controller.ts#H1:L29+",
          lineType: "add",
          newLineNumber: 29,
          content: "  return {",
        },
        {
          ref: "src/users/users.controller.ts#H1:L30+",
          lineType: "add",
          newLineNumber: 30,
          content: "    userId: requestedUserId,",
        },
        {
          ref: "src/users/users.controller.ts#H1:L31+",
          lineType: "add",
          newLineNumber: 31,
          content: '    role: "user" as const,',
        },
      ],
    },
  ],
};

const downgradedFirstPass = calibrateFirstPassDecision({
  decision: {
    decision: "final_review",
    confidence: 0.88,
    riskLevel: "medium",
    rationale: "硬编码角色会误导审计。",
    evidenceCoverage: {
      modifiedSymbol: true,
      localContext: true,
      callers: false,
      callees: false,
      tests: false,
      schema: false,
    },
    provisionalFindings: [
      {
        diffLineRef: "src/users/users.controller.ts#H1:L31+",
        lineRefs: [
          "src/users/users.controller.ts#H1:L28+",
          "src/users/users.controller.ts#H1:L31+",
        ],
        severity: "MEDIUM",
        category: "bug",
        title: "审计接口返回了硬编码角色",
        message: "如果这里被正式审计链路使用，会让调用方基于错误角色继续判断。",
        suggestion: "应返回真实角色。",
        confidence: 0.9,
        evidenceRefs: [
          "diff:src/users/users.controller.ts#H1:L28+",
          "diff:src/users/users.controller.ts#H1:L31+",
        ],
      },
    ],
  },
  file: {
    filePath: "src/users/users.controller.ts",
    status: "modified",
    additions: 7,
    deletions: 0,
    patch:
      '@@ -24,3 +24,10 @@\n+export function readUserProfileForAudit(requestedUserId: string) {\n+  return {\n+    userId: requestedUserId,\n+    role: "user" as const,\n+  };\n+}',
  },
  diff: contextSensitiveDiff,
  ruleViolations: [],
});

assert.equal(downgradedFirstPass.decision, "need_more_context");
assert.equal(downgradedFirstPass.provisionalFindings.length, 0);
assert.ok(downgradedFirstPass.contextRequest);

const downgradedSecondPass = calibrateSecondPassResult({
  result: {
    decision: "final_review",
    confidence: 0.84,
    rationale: "补充后仍觉得这里有问题。",
    candidateComments: [
      {
        diffLineRef: "src/users/users.controller.ts#H1:L31+",
        lineRefs: [
          "src/users/users.controller.ts#H1:L28+",
          "src/users/users.controller.ts#H1:L31+",
        ],
        severity: "MEDIUM",
        category: "bug",
        title: "审计接口返回了硬编码角色",
        message: "如果这里进入正式链路，会让后续审计基于错误角色做判断。",
        suggestion: "应返回真实角色。",
        confidence: 0.84,
        evidenceRefs: [
          "diff:src/users/users.controller.ts#H1:L28+",
          "context:find_symbol_definition:src/users/users.controller.ts#readUserProfileForAudit",
        ],
      },
    ],
  },
  file: {
    filePath: "src/users/users.controller.ts",
    status: "modified",
    additions: 7,
    deletions: 0,
    patch:
      '@@ -24,3 +24,10 @@\n+export function readUserProfileForAudit(requestedUserId: string) {\n+  return {\n+    userId: requestedUserId,\n+    role: "user" as const,\n+  };\n+}',
  },
  diff: contextSensitiveDiff,
  firstPass: downgradedFirstPass,
});

assert.equal(downgradedSecondPass.decision, "insufficient_evidence");
assert.equal(downgradedSecondPass.candidateComments.length, 0);

const authContractDiff: DiffParseResult = {
  filePath: "src/controller/auth.controller.ts",
  language: "TypeScript",
  totalAddedLines: 5,
  totalRemovedLines: 2,
  lineRefMap: {
    "src/controller/auth.controller.ts#H1:L88-": {
      hunkId: "src/controller/auth.controller.ts#H1",
      lineType: "remove",
      oldLineNumber: 88,
    },
    "src/controller/auth.controller.ts#H1:L88+": {
      hunkId: "src/controller/auth.controller.ts#H1",
      lineType: "add",
      newLineNumber: 88,
    },
    "src/controller/auth.controller.ts#H1:L89+": {
      hunkId: "src/controller/auth.controller.ts#H1",
      lineType: "add",
      newLineNumber: 89,
    },
  },
  hunks: [
    {
      hunkId: "src/controller/auth.controller.ts#H1",
      header:
        "@@ -86,4 +86,7 @@ async function handleRefresh(payload: JwtPayload) {",
      oldStart: 86,
      oldLines: 4,
      newStart: 86,
      newLines: 7,
      lines: [
        {
          ref: "src/controller/auth.controller.ts#H1:L86",
          lineType: "context",
          oldLineNumber: 86,
          newLineNumber: 86,
          content: "async function handleRefresh(payload: JwtPayload) {",
        },
        {
          ref: "src/controller/auth.controller.ts#H1:L88-",
          lineType: "remove",
          oldLineNumber: 88,
          content: "  const userId = payload.userId;",
        },
        {
          ref: "src/controller/auth.controller.ts#H1:L88+",
          lineType: "add",
          newLineNumber: 88,
          content: "  const userId = getTokenUserId(payload);",
        },
        {
          ref: "src/controller/auth.controller.ts#H1:L89+",
          lineType: "add",
          newLineNumber: 89,
          content: "  const tokens = createRefreshToken(userId);",
        },
      ],
    },
  ],
};

const escalatedAuthContractReview = calibrateFirstPassDecision({
  decision: {
    decision: "no_issue",
    confidence: 0.82,
    riskLevel: "low",
    rationale: "当前 diff 看起来像一次普通重构。",
    evidenceCoverage: {
      modifiedSymbol: true,
      localContext: true,
      callers: false,
      callees: false,
      tests: false,
      schema: false,
    },
    provisionalFindings: [],
  },
  file: {
    filePath: "src/controller/auth.controller.ts",
    status: "modified",
    additions: 5,
    deletions: 2,
    patch:
      "@@ -86,4 +86,7 @@\n-  const userId = payload.userId;\n+  const userId = getTokenUserId(payload);\n+  const tokens = createRefreshToken(userId);\n }",
  },
  diff: authContractDiff,
  ruleViolations: [],
});

assert.equal(escalatedAuthContractReview.decision, "need_more_context");
assert.ok(escalatedAuthContractReview.contextRequest);
assert.ok(
  escalatedAuthContractReview.contextRequest?.symbols.includes(
    "getTokenUserId",
  ),
);
assert.ok(
  escalatedAuthContractReview.contextRequest?.symbols.includes(
    "createRefreshToken",
  ),
);
