import { runReviewPipeline } from "./review-pipeline.js";

const sampleResult = runReviewPipeline(
  {
    decision: "need_more_context",
    confidence: 0.52,
    riskLevel: "high",
    rationale: "返回值语义变化依赖调用方上下文确认影响范围",
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
        diffLineRef: "L101+",
        lineRefs: [],
        severity: "HIGH",
        category: "bug",
        title: "返回值语义变化可能破坏调用方分支判断",
        message:
          "如果调用方仍按旧布尔语义处理新返回值，会导致错误路径被误判为成功。",
        suggestion: "补查直接调用方并统一返回值约定。",
        confidence: 0.78,
        evidenceRefs: ["diff:L101+", "symbol:AuthService.refreshToken"],
      },
    ],
    contextRequest: {
      reason: "需要确认调用方是否仍按旧语义消费返回值",
      callersOf: ["AuthService.refreshToken"],
      tests: ["AuthService.refreshToken"],
      symbols: ["AuthService.refreshToken"],
      files: [],
      calleesOf: [],
      schemaTargets: [],
    },
  },
  {
    maxRounds: 2,
    maxToolCalls: 6,
    maxExtraFiles: 8,
    maxCallDepth: 2,
    maxExtraTokens: 20000,
    usedRounds: 0,
    usedToolCalls: 0,
    usedExtraFiles: 0,
    usedExtraTokens: 0,
  },
);

console.log(
  "worker review pipeline ready",
  JSON.stringify(sampleResult, null, 2),
);
