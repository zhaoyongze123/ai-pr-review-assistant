import assert from "node:assert/strict";
import { Client, RunTree } from "langsmith";
import { withRunTree } from "langsmith/traceable";
import {
  runFirstPassTriage,
  runSecondPassReview,
} from "@ai-pr-review/llm-gateway";
import { createContextFetchPlan } from "@ai-pr-review/review-core";
import { ReviewTriageDecisionSchema } from "@ai-pr-review/shared-types";
import "../../load-root-env.js";

async function main() {
  const projectName = process.env.LANGSMITH_PROJECT ?? "ai-pr-review-assistant";
  const langsmithApiKey = process.env.LANGSMITH_API_KEY;
  const langsmithEndpoint =
    process.env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com";
  const langsmithWorkspaceId = process.env.LANGSMITH_WORKSPACE_ID;
  const llmApiKey = process.env.LLM_API_KEY;
  const llmApiBase = process.env.LLM_API_BASE ?? "https://aiapis.help";
  const llmModel = process.env.DEFAULT_LLM_MODEL ?? "gpt-5.4";
  const llmProvider = process.env.DEFAULT_LLM_PROVIDER ?? "openai-compatible";

  assert(langsmithApiKey, "LangSmith 验收必须提供 LANGSMITH_API_KEY");
  assert(llmApiKey, "LangSmith 验收必须提供 LLM_API_KEY");

  const client = new Client({
    apiKey: langsmithApiKey,
    apiUrl: langsmithEndpoint,
    workspaceId: langsmithWorkspaceId,
    blockOnRootRunFinalization: true,
  });

  const rootRun = new RunTree({
    name: "review-job",
    run_type: "chain",
    project_name: projectName,
    client,
    tracingEnabled: true,
    inputs: {
      mode: "langsmith-trace-smoke",
      repository: "acme-inc/payments-service",
      prNumber: 128,
    },
    metadata: {
      stage: "langsmith-trace-smoke",
    },
    tags: ["smoke", "review-job"],
  });
  await rootRun.postRun();

  try {
    const ruleEngineRun = rootRun.createChild({
      name: "rule-engine-scan",
      run_type: "tool",
      inputs: {
        repositoryPath: "/tmp/mock-repo",
        timeoutSeconds: 30,
        engines: ["semgrep"],
      },
      metadata: {
        stage: "langsmith-trace-smoke",
      },
      tags: ["smoke", "rule-engine"],
    });
    await ruleEngineRun.postRun();
    await ruleEngineRun.end({
      violationCount: 1,
      failureCount: 0,
    });
    await ruleEngineRun.patchRun();

    const fileRun = rootRun.createChild({
      name: "review-file",
      run_type: "chain",
      inputs: {
        filePath: "src/auth.ts",
        status: "modified",
      },
      metadata: {
        stage: "langsmith-trace-smoke",
      },
      tags: ["smoke", "review-file"],
    });
    await fileRun.postRun();

    try {
      const targetDecision = ReviewTriageDecisionSchema.parse({
        decision: "need_more_context",
        confidence: 0.68,
        riskLevel: "high",
        rationale:
          "规则命中高风险问题，首轮先保留发现并请求调用方、测试或配置证据",
        evidenceCoverage: {
          modifiedSymbol: false,
          localContext: true,
          callers: false,
          callees: false,
          tests: false,
          schema: false,
        },
        provisionalFindings: [
          {
            diffLineRef: "src/auth.ts#H1:L2+",
            lineRefs: ["src/auth.ts#H1:L2+"],
            severity: "HIGH",
            category: "security",
            title: "Raw token returned",
            message: "Token is returned without session guard.",
            confidence: 0.72,
            evidenceRefs: [
              "rule:semgrep:auth.raw-token-return",
              "diff:src/auth.ts",
            ],
            duplicateFingerprint: "semgrep:auth.raw-token-return:src/auth.ts:2",
          },
        ],
        contextRequest: {
          reason: "高风险规则命中需要补充调用方、测试或配置证据以降低误报",
          symbols: [],
          files: ["src/auth.ts"],
          callersOf: ["src/auth.ts"],
          calleesOf: [],
          tests: ["src/auth.ts"],
          schemaTargets: [],
        },
      });

      const llmResult = await withRunTree(fileRun, async () =>
        runFirstPassTriage({
          apiBase: llmApiBase,
          apiKey: llmApiKey,
          provider: llmProvider,
          model: llmModel,
          promptKind: "triage",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "你是代码审查助手。严格输出用户给定的 JSON，不要添加任何解释。",
            },
            {
              role: "user",
              content: JSON.stringify(targetDecision),
            },
          ],
          langsmith: {
            name: "first-pass-review",
            client,
            project_name: projectName,
            tracingEnabled: true,
            metadata: {
              stage: "langsmith-trace-smoke",
              filePath: "src/auth.ts",
              promptVersion: "smoke-v1",
            },
            tags: ["smoke", "first-pass-review"],
          },
        }),
      );

      const contextRun = fileRun.createChild({
        name: "context-fetch-plan",
        run_type: "tool",
        inputs: {
          request: llmResult.parsed.contextRequest,
        },
        metadata: {
          stage: "langsmith-trace-smoke",
          filePath: "src/auth.ts",
        },
        tags: ["smoke", "context-fetch"],
      });
      await contextRun.postRun();

      const contextPlan = createContextFetchPlan(
        llmResult.parsed.contextRequest!,
        {
          maxRounds: 1,
          maxToolCalls: 4,
          maxExtraFiles: 3,
          maxCallDepth: 1,
          maxExtraTokens: 4000,
          usedRounds: 0,
          usedToolCalls: 0,
          usedExtraFiles: 0,
          usedExtraTokens: 0,
        },
      );

      await contextRun.end({
        status: contextPlan.status,
        plannedCalls: contextPlan.plannedCalls.length,
        reason: contextPlan.reason,
      });
      await contextRun.patchRun();

      const contextSummaryRun = fileRun.createChild({
        name: "context-fetch-summary",
        run_type: "tool",
        inputs: {
          request: llmResult.parsed.contextRequest,
          plannedCalls: contextPlan.plannedCalls,
        },
        metadata: {
          stage: "langsmith-trace-smoke",
          filePath: "src/auth.ts",
        },
        tags: ["smoke", "context-fetch", "summary"],
      });
      await contextSummaryRun.postRun();
      await contextSummaryRun.end({
        status: "completed",
        artifactCount: 2,
        plannedCalls: contextPlan.plannedCalls.length,
      });
      await contextSummaryRun.patchRun();

      await withRunTree(fileRun, async () =>
        runSecondPassReview({
          apiBase: llmApiBase,
          apiKey: llmApiKey,
          provider: llmProvider,
          model: llmModel,
          promptKind: "second-pass-review",
          temperature: 0,
          messages: [
            {
              role: "system",
              content:
                "你是代码审查助手。严格输出用户给定的 JSON，不要添加任何解释。",
            },
            {
              role: "user",
              content: JSON.stringify({
                decision: "final_review",
                confidence: 0.84,
                rationale: "补充调用方和测试证据后，可确认这是高价值评论。",
                candidateComments: [
                  {
                    diffLineRef: "src/auth.ts#H1:L2+",
                    lineRefs: ["src/auth.ts#H1:L2+"],
                    severity: "HIGH",
                    category: "security",
                    title: "Raw token returned",
                    message: "Token is returned without session guard.",
                    confidence: 0.82,
                    evidenceRefs: [
                      "diff:src/auth.ts#H1:L2+",
                      "context:find_callers:src/auth.test.ts",
                    ],
                    duplicateFingerprint:
                      "semgrep:auth.raw-token-return:src/auth.ts:2",
                  },
                ],
              }),
            },
          ],
          langsmith: {
            name: "second-pass-review",
            client,
            project_name: projectName,
            tracingEnabled: true,
            metadata: {
              stage: "langsmith-trace-smoke",
              filePath: "src/auth.ts",
              promptVersion: "smoke-v2",
            },
            tags: ["smoke", "second-pass-review"],
          },
        }),
      );

      const qualityRun = fileRun.createChild({
        name: "quality-scoring",
        run_type: "tool",
        inputs: {
          candidateCount: 1,
        },
        metadata: {
          stage: "langsmith-trace-smoke",
          filePath: "src/auth.ts",
        },
        tags: ["smoke", "quality-scoring"],
      });
      await qualityRun.postRun();
      await qualityRun.end({
        candidateCount: 1,
        averageScore: 80,
        maxScore: 80,
        minScore: 80,
      });
      await qualityRun.patchRun();

      const admissionRun = fileRun.createChild({
        name: "comment-admission",
        run_type: "tool",
        inputs: {
          candidateCount: 1,
          ruleCommentCount: 0,
        },
        metadata: {
          stage: "langsmith-trace-smoke",
          filePath: "src/auth.ts",
        },
        tags: ["smoke", "comment-admission"],
      });
      await admissionRun.postRun();
      await admissionRun.end({
        beforeGateCount: 1,
        afterGateCount: 1,
        duplicateSuppressedCount: 0,
        suppressedCount: 0,
      });
      await admissionRun.patchRun();

      await fileRun.end({
        triageDecision: llmResult.parsed.decision,
        plannedCalls: contextPlan.plannedCalls.length,
      });
      await fileRun.patchRun();
    } catch (error) {
      await fileRun.end(
        undefined,
        error instanceof Error ? error.message : String(error),
      );
      await fileRun.patchRun();
      throw error;
    }

    const aggregateRun = rootRun.createChild({
      name: "final-aggregate-summary",
      run_type: "tool",
      inputs: {
        fileCount: 1,
        commentCount: 1,
      },
      metadata: {
        stage: "langsmith-trace-smoke",
      },
      tags: ["smoke", "aggregate-summary"],
    });
    await aggregateRun.postRun();
    await aggregateRun.end({
      mergeRecommendation: "request_changes",
      headline: "PR 存在 1 个高风险问题，建议先修复再合并。",
      notableFindings: ["Raw token returned"],
    });
    await aggregateRun.patchRun();

    await rootRun.end({
      ok: true,
    });
    await rootRun.patchRun();

    await client.flush();

    await sleep(2500);
    const runs = [];
    for await (const run of client.listRuns({
      projectName,
      traceId: rootRun.id,
      order: "asc",
      limit: 20,
    })) {
      runs.push({
        id: run.id,
        name: run.name,
        runType: run.run_type,
        parentRunId: run.parent_run_id ?? null,
        traceId: run.trace_id ?? null,
      });
    }

    const reviewJob = runs.find((run) => run.name === "review-job");
    const ruleEngine = runs.find((run) => run.name === "rule-engine-scan");
    const reviewFile = runs.find((run) => run.name === "review-file");
    const firstPass = runs.find((run) => run.name === "first-pass-review");
    const contextFetch = runs.find((run) => run.name === "context-fetch-plan");
    const contextSummary = runs.find(
      (run) => run.name === "context-fetch-summary",
    );
    const secondPass = runs.find((run) => run.name === "second-pass-review");
    const qualityScoring = runs.find((run) => run.name === "quality-scoring");
    const commentAdmission = runs.find(
      (run) => run.name === "comment-admission",
    );
    const aggregateSummary = runs.find(
      (run) => run.name === "final-aggregate-summary",
    );

    assert(reviewJob, "必须能查到 review-job 根 trace");
    assert(ruleEngine, "必须能查到 rule-engine-scan trace");
    assert(reviewFile, "必须能查到 review-file trace");
    assert(firstPass, "必须能查到 first-pass-review trace");
    assert(contextFetch, "必须能查到 context-fetch-plan trace");
    assert(contextSummary, "必须能查到 context-fetch-summary trace");
    assert(secondPass, "必须能查到 second-pass-review trace");
    assert(qualityScoring, "必须能查到 quality-scoring trace");
    assert(commentAdmission, "必须能查到 comment-admission trace");
    assert(aggregateSummary, "必须能查到 final-aggregate-summary trace");
    assert.equal(ruleEngine.parentRunId, reviewJob.id);
    assert.equal(reviewFile.parentRunId, reviewJob.id);
    assert.equal(firstPass.parentRunId, reviewFile.id);
    assert.equal(contextFetch.parentRunId, reviewFile.id);
    assert.equal(contextSummary.parentRunId, reviewFile.id);
    assert.equal(secondPass.parentRunId, reviewFile.id);
    assert.equal(qualityScoring.parentRunId, reviewFile.id);
    assert.equal(commentAdmission.parentRunId, reviewFile.id);
    assert.equal(aggregateSummary.parentRunId, reviewJob.id);

    console.log(
      JSON.stringify(
        {
          traceId: rootRun.id,
          runs,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await rootRun.end(
      undefined,
      error instanceof Error ? error.message : String(error),
    );
    await rootRun.patchRun();
    await client.flush();
    throw error;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error("langsmith trace smoke failed", error);
  process.exit(1);
});
