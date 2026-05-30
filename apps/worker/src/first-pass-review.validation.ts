import assert from "node:assert/strict";
import { runFirstPassReviewPipeline } from "./review-pipeline.js";

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
