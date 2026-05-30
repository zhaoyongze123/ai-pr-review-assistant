import {
  RuleViolationSchema,
  type ReviewSeverity,
  type RuleViolation,
} from "@ai-pr-review/shared-types";

type SemgrepFinding = {
  check_id?: string;
  path?: string;
  start?: { line?: number };
  end?: { line?: number };
  extra?: {
    severity?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  };
};

type EslintFinding = {
  ruleId?: string | null;
  filePath?: string;
  message?: string;
  line?: number;
  endLine?: number;
  severity?: number | string;
};

export type RawRuleResults = {
  semgrep?: SemgrepFinding[];
  eslint?: EslintFinding[];
};

export function normalizeRuleViolations(
  rawResults: RawRuleResults,
): RuleViolation[] {
  const semgrepViolations = (rawResults.semgrep ?? []).map((finding) =>
    RuleViolationSchema.parse({
      source: "rule",
      engine: "semgrep",
      ruleId: finding.check_id ?? "semgrep.unknown",
      filePath: finding.path ?? "unknown",
      severity: mapSemgrepSeverity(finding.extra?.severity),
      category: readCategory(finding.extra?.metadata),
      title: finding.check_id ?? "Semgrep rule matched",
      message: finding.extra?.message ?? "Semgrep reported a rule violation.",
      lineStart: finding.start?.line,
      lineEnd: finding.end?.line,
      metadata: finding.extra?.metadata,
    }),
  );

  const eslintViolations = (rawResults.eslint ?? []).map((finding) =>
    RuleViolationSchema.parse({
      source: "rule",
      engine: "eslint",
      ruleId: finding.ruleId ?? "eslint.unknown",
      filePath: finding.filePath ?? "unknown",
      severity: mapEslintSeverity(finding.severity),
      category: inferEslintCategory(finding.ruleId),
      title: finding.ruleId ?? "ESLint rule matched",
      message: finding.message ?? "ESLint reported a rule violation.",
      lineStart: finding.line,
      lineEnd: finding.endLine ?? finding.line,
    }),
  );

  return [...semgrepViolations, ...eslintViolations];
}

function mapSemgrepSeverity(severity: string | undefined): ReviewSeverity {
  switch (severity?.toUpperCase()) {
    case "ERROR":
      return "HIGH";
    case "WARNING":
      return "MEDIUM";
    case "INFO":
      return "LOW";
    default:
      return "INFO";
  }
}

function mapEslintSeverity(
  severity: number | string | undefined,
): ReviewSeverity {
  if (severity === 2 || severity === "2" || severity === "error") {
    return "HIGH";
  }
  if (severity === 1 || severity === "1" || severity === "warn") {
    return "MEDIUM";
  }
  return "INFO";
}

function readCategory(metadata: Record<string, unknown> | undefined): string {
  const category = metadata?.category ?? metadata?.["owasp"];
  return typeof category === "string" && category.length > 0
    ? category
    : "maintainability";
}

function inferEslintCategory(ruleId: string | null | undefined): string {
  if (!ruleId) {
    return "maintainability";
  }
  if (ruleId.includes("security") || ruleId.includes("no-eval")) {
    return "security";
  }
  if (ruleId.includes("floating") || ruleId.includes("promise")) {
    return "bug";
  }
  return "maintainability";
}
