import assert from "node:assert/strict";
import { normalizeRuleViolations } from "./index.js";

const violations = normalizeRuleViolations({
  semgrep: [
    {
      check_id: "typescript.lang.security.audit.detect-non-literal-fs-filename",
      path: "src/file.ts",
      start: { line: 42 },
      end: { line: 43 },
      extra: {
        severity: "WARNING",
        message: "Filesystem path comes from user input.",
        metadata: { category: "security" },
      },
    },
  ],
  eslint: [
    {
      ruleId: "@typescript-eslint/no-floating-promises",
      filePath: "src/jobs.ts",
      message: "Promises must be awaited.",
      line: 7,
      severity: 2,
    },
  ],
});

assert.equal(violations.length, 2);
assert.equal(violations[0]?.engine, "semgrep");
assert.equal(violations[0]?.severity, "MEDIUM");
assert.equal(violations[0]?.category, "security");
assert.equal(violations[1]?.engine, "eslint");
assert.equal(violations[1]?.severity, "HIGH");
assert.equal(violations[1]?.lineStart, 7);
