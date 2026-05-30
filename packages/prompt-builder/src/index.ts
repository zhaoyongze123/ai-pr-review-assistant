import type {
  ContextFetchResult,
  DiffParseResult,
  PullRequestFile,
  ReviewTriageDecision,
  RuleViolation,
} from "@ai-pr-review/shared-types";

export type PromptMessage = {
  role: "system" | "user";
  content: string;
};

export type FirstPassPrompt = {
  promptVersion: string;
  messages: PromptMessage[];
};

export type SecondPassPrompt = {
  promptVersion: string;
  messages: PromptMessage[];
};

const FIRST_PASS_PROMPT_VERSION = "first-pass-triage.v1";
const SECOND_PASS_PROMPT_VERSION = "second-pass-review.v1";

export function buildFirstPassReviewPrompt(input: {
  file: PullRequestFile;
  diff: DiffParseResult;
  ruleViolations: RuleViolation[];
}): FirstPassPrompt {
  const annotatedDiff = renderAnnotatedDiff(input.diff);
  const allowedRefs = Object.keys(input.diff.lineRefMap);

  const ruleSection =
    input.ruleViolations.length === 0
      ? "无规则命中。"
      : input.ruleViolations
          .map(
            (violation, index) =>
              `${index + 1}. [${violation.engine}] ${violation.ruleId} severity=${violation.severity} line=${violation.lineStart ?? "unknown"} title=${violation.title} message=${violation.message}`,
          )
          .join("\n");

  return {
    promptVersion: FIRST_PASS_PROMPT_VERSION,
    messages: [
      {
        role: "system",
        content: [
          "你是高级代码审查工程师，只做首轮 triage。",
          "你的目标不是泛泛而谈，而是判断当前 diff 是否已经足够产出高价值评论。",
          "你必须只返回一个 JSON 对象，不要输出 Markdown、解释、代码块或额外文字。",
          "decision 只能是 final_review、need_more_context、no_issue、insufficient_evidence 之一。",
          "如果证据不足，不要编造问题。",
          "如果选择 need_more_context，必须提供 contextRequest。",
          "provisionalFindings 中的 diffLineRef 必须来自给定 allowedDiffLineRefs。",
          "message 必须说明故障条件或影响方式，避免空泛措辞。",
          "severity 只能是 HIGH、MEDIUM、LOW、INFO。",
          "category 只能是 security、bug、performance、concurrency、style、maintainability、testing。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `filePath: ${input.file.filePath}`,
          `fileStatus: ${input.file.status}`,
          `additions: ${input.file.additions}, deletions: ${input.file.deletions}`,
          `allowedDiffLineRefs: ${JSON.stringify(allowedRefs)}`,
          "",
          "ruleViolations:",
          ruleSection,
          "",
          "annotatedDiff:",
          annotatedDiff,
          "",
          "返回 JSON，字段结构必须满足：",
          JSON.stringify(
            {
              decision:
                "final_review | need_more_context | no_issue | insufficient_evidence",
              confidence: 0.0,
              riskLevel: "low | medium | high",
              rationale: "string",
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
                  diffLineRef: allowedRefs[0] ?? "optional",
                  lineRefs: [allowedRefs[0] ?? "optional"],
                  severity: "HIGH",
                  category: "bug",
                  title: "string",
                  message: "string",
                  suggestion: "optional string",
                  confidence: 0.0,
                  evidenceRefs: ["diff:...", "rule:..."],
                  duplicateFingerprint: "string",
                },
              ],
              contextRequest: {
                reason: "string",
                symbols: ["string"],
                files: ["string"],
                callersOf: ["string"],
                calleesOf: ["string"],
                tests: ["string"],
                schemaTargets: ["string"],
              },
            },
            null,
            2,
          ),
        ].join("\n"),
      },
    ],
  };
}

export function buildSecondPassReviewPrompt(input: {
  file: PullRequestFile;
  diff: DiffParseResult;
  ruleViolations: RuleViolation[];
  firstPass: ReviewTriageDecision;
  contextResult: ContextFetchResult;
}): SecondPassPrompt {
  const annotatedDiff = renderAnnotatedDiff(input.diff);
  const allowedRefs = Object.keys(input.diff.lineRefMap);
  const ruleSection =
    input.ruleViolations.length === 0
      ? "无规则命中。"
      : input.ruleViolations
          .map(
            (violation, index) =>
              `${index + 1}. [${violation.engine}] ${violation.ruleId} severity=${violation.severity} line=${violation.lineStart ?? "unknown"} title=${violation.title} message=${violation.message}`,
          )
          .join("\n");
  const contextSection =
    input.contextResult.artifacts.length === 0
      ? "没有拿到额外上下文证据。"
      : input.contextResult.artifacts
          .map((artifact, index) => {
            const lineRange =
              artifact.startLine && artifact.endLine
                ? ` lines=${artifact.startLine}-${artifact.endLine}`
                : "";
            const relation = artifact.relation ? ` relation=${artifact.relation}` : "";
            const symbol = artifact.symbolName
              ? ` symbol=${artifact.symbolName}`
              : "";
            return [
              `${index + 1}. tool=${artifact.toolName}${relation}${symbol} file=${artifact.filePath}${lineRange}`,
              artifact.preview,
            ].join("\n");
          })
          .join("\n\n");

  return {
    promptVersion: SECOND_PASS_PROMPT_VERSION,
    messages: [
      {
        role: "system",
        content: [
          "你是高级代码审查工程师，正在做二轮 evidence-driven review。",
          "你已经拿到了 diff、首轮 triage 判断和额外仓库上下文。",
          "只有在证据足够时，才输出 candidateComments。",
          "candidateComments 必须具体、可执行，并明确引用 diffLineRef 和 evidenceRefs。",
          "如果仍然证据不足，返回 insufficient_evidence，并给出空 candidateComments。",
          "你必须只返回一个 JSON 对象，不要输出 Markdown、解释、代码块或额外文字。",
          "decision 只能是 final_review、no_issue、insufficient_evidence 之一。",
          "candidateComments 中的 diffLineRef 必须来自给定 allowedDiffLineRefs。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `filePath: ${input.file.filePath}`,
          `fileStatus: ${input.file.status}`,
          `additions: ${input.file.additions}, deletions: ${input.file.deletions}`,
          `allowedDiffLineRefs: ${JSON.stringify(allowedRefs)}`,
          "",
          "firstPassDecision:",
          JSON.stringify(input.firstPass, null, 2),
          "",
          "ruleViolations:",
          ruleSection,
          "",
          "contextArtifacts:",
          contextSection,
          "",
          "annotatedDiff:",
          annotatedDiff,
          "",
          "返回 JSON，字段结构必须满足：",
          JSON.stringify(
            {
              decision: "final_review | no_issue | insufficient_evidence",
              confidence: 0.0,
              rationale: "string",
              candidateComments: [
                {
                  diffLineRef: allowedRefs[0] ?? "required when comment exists",
                  lineRefs: [allowedRefs[0] ?? "required when comment exists"],
                  severity: "HIGH",
                  category: "bug",
                  title: "string",
                  message: "string",
                  suggestion: "optional string",
                  confidence: 0.0,
                  evidenceRefs: ["diff:...", "context:..."],
                  duplicateFingerprint: "string",
                },
              ],
            },
            null,
            2,
          ),
        ].join("\n"),
      },
    ],
  };
}

function renderAnnotatedDiff(diff: DiffParseResult): string {
  return diff.hunks
    .map((hunk) => {
      const lines = hunk.lines.map((line) => {
        const marker =
          line.lineType === "add"
            ? "+"
            : line.lineType === "remove"
              ? "-"
              : " ";
        return `[${line.ref}] ${marker}${line.content}`;
      });

      return [hunk.header, ...lines].join("\n");
    })
    .join("\n\n");
}
