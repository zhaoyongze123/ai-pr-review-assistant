import assert from "node:assert/strict";
import "reflect-metadata";
import { Pool } from "pg";
import "../../load-root-env.js";

async function main() {
  const port = Number(process.env.PORT ?? 3303);
  const prNumber = Number(process.env.SMOKE_PR_NUMBER ?? 9);
  const githubToken = process.env.GITHUB_TOKEN;
  const ruleEngineUrl = process.env.RULE_ENGINE_URL ?? "http://127.0.0.1:58001";
  const databaseUrl = process.env.DATABASE_URL;
  const llmApiKey = process.env.LLM_API_KEY;

  assert(githubToken, "smoke 测试必须提供 GITHUB_TOKEN");
  assert(databaseUrl, "smoke 测试必须提供 DATABASE_URL");
  assert(llmApiKey, "smoke 测试必须提供 LLM_API_KEY");

  const [{ NestFactory }, sharedTypes, { AppModule }] = await Promise.all([
    import("@nestjs/core"),
    import("@ai-pr-review/shared-types"),
    import("../../app.module.js"),
  ]);

  const { FirstPassReviewRunResponseSchema } = sharedTypes;
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  const healthResponse = await fetch(`${ruleEngineUrl}/health`);
  assert.equal(healthResponse.status, 200, "rule-engine 必须先可用");

  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix("api");
  await app.listen(port);

  try {
    const connectResponse = await fetch(
      `http://127.0.0.1:${port}/api/repositories/connect`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider: "github",
          owner: "zhaoyongze123",
          repo: "ai-pr-review-assistant",
        }),
      },
    );

    assert.equal(connectResponse.status, 200, "真实仓库接入必须成功");

    const response = await fetch(
      `http://127.0.0.1:${port}/api/review-tools/first-pass`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repository: {
            provider: "github",
            owner: "zhaoyongze123",
            repo: "ai-pr-review-assistant",
          },
          prNumber,
          ruleScanTimeoutSeconds: 60,
          ruleScanEngines: ["semgrep"],
        }),
      },
    );

    assert.equal(response.status, 200);
    const payload = FirstPassReviewRunResponseSchema.parse(
      await response.json(),
    );

    assert.equal(payload.pullRequest.prNumber, prNumber);
    assert.ok(payload.pullRequest.files.length > 0, "PR 文件列表不能为空");
    assert.ok(payload.files.length > 0, "有 patch 的文件必须进入首轮审查");
    assert.equal(
      payload.ruleFailures.length,
      0,
      "semgrep 联调不应再缺少可执行文件",
    );
    assert.ok(payload.reviewJob?.id, "必须返回 review job");
    assert.ok(payload.fileReviews.length > 0, "必须落文件级审查结果");
    assert.ok(payload.llmCalls.length > 0, "真实 LLM 调用必须落日志");
    assert.ok(
      payload.files.some((fileResult) =>
        [
          "accept_final_review",
          "fetch_more_context",
          "accept_no_issue",
          "accept_insufficient_evidence",
        ].includes(fileResult.triage.action),
      ),
      "至少应有一个文件产出 triage 结果",
    );
    assert.ok(
      payload.files.some((fileResult) => Boolean(fileResult.contextPlan)),
      "至少应有一个文件产生上下文检索计划",
    );
    assert.ok(
      payload.files.some(
        (fileResult) => fileResult.contextResult?.status === "completed",
      ),
      "至少应有一个文件完成真实上下文检索",
    );
    const reviewJobId = payload.reviewJob?.id;
    assert(reviewJobId, "review job id 不能为空");

    const counts = await pool.query<{
      repository_count: string;
      pull_request_count: string;
      review_job_count: string;
      file_review_count: string;
      llm_call_count: string;
      context_fetch_log_count: string;
      context_round_file_count: string;
    }>(
      `
        select
          (
            select count(*)
            from repositories
            where provider = 'github'
              and owner = 'zhaoyongze123'
              and repo = 'ai-pr-review-assistant'
          ) as repository_count,
          (
            select count(*)
            from pull_requests
            where provider = 'github'
              and owner = 'zhaoyongze123'
              and repo = 'ai-pr-review-assistant'
              and pr_number = $2
          ) as pull_request_count,
          (
            select count(*)
            from review_jobs
            where id = $1
              and status = 'done'
          ) as review_job_count,
          (
            select count(*)
            from file_reviews
            where review_job_id = $1
          ) as file_review_count,
          (
            select count(*)
            from llm_call_logs
            where review_job_id = $1
          ) as llm_call_count,
          (
            select count(*)
            from context_fetch_logs
            where review_job_id = $1
          ) as context_fetch_log_count,
          (
            select count(*)
            from file_reviews
            where review_job_id = $1
              and context_round > 0
          ) as context_round_file_count
      `,
      [reviewJobId, prNumber],
    );

    const row = counts.rows[0];
    assert(row, "必须查询到数据库统计结果");
    assert.ok(
      Number(row.repository_count) >= 1,
      "repositories 表必须存在仓库记录",
    );
    assert.ok(
      Number(row.pull_request_count) >= 1,
      "pull_requests 表必须存在 PR 快照",
    );
    assert.ok(
      Number(row.review_job_count) === 1,
      "review_jobs 表必须存在 done 任务",
    );
    assert.ok(
      Number(row.file_review_count) >= 1,
      "file_reviews 表必须存在记录",
    );
    assert.ok(Number(row.llm_call_count) >= 1, "llm_call_logs 表必须存在记录");
    assert.ok(
      Number(row.context_fetch_log_count) >= 1,
      "context_fetch_logs 表必须存在记录",
    );
    assert.ok(
      Number(row.context_round_file_count) >= 1,
      "file_reviews 表必须至少有一个文件进入上下文轮次",
    );

    console.log("first pass review smoke passed");
  } finally {
    await app.close();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error("first pass review smoke failed", error);
  process.exit(1);
});
