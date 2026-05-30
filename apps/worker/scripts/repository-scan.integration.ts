import assert from "node:assert/strict";
import "reflect-metadata";
import { Pool } from "pg";
import {
  RepositoryConnectResponseSchema,
  RepositoryScanStatusResponseSchema,
  RepositoryScanTriggerResponseSchema,
  SemanticSearchResponseSchema,
} from "@ai-pr-review/shared-types";
import { createRepositoryScanWorker } from "../src/repository-scan-worker.js";

async function pollScanStatus(
  repositoryId: string,
  scanId: string,
  port: number,
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/repositories/${repositoryId}/scans/${scanId}`,
    );
    assert.equal(response.status, 200);
    const payload = RepositoryScanStatusResponseSchema.parse(
      await response.json(),
    );

    if (payload.scan.status === "done" || payload.scan.status === "failed") {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error("轮询扫描状态超时");
}

async function main() {
  const port = Number(process.env.PORT ?? 3302);
  const databaseUrl = process.env.DATABASE_URL;

  assert(databaseUrl, "smoke 测试必须提供 DATABASE_URL");
  process.env.SCAN_PROCESSING_DELAY_MS = "500";
  const bootstrapPool = new Pool({
    connectionString: databaseUrl,
  });
  await bootstrapPool.query(
    `
      update repository_scans
      set
        status = 'failed',
        finished_at = now(),
        updated_at = now()
      where status in ('pending', 'running')
    `,
  );
  await bootstrapPool.end();

  const [{ NestFactory }, { AppModule }] = await Promise.all([
    import("@nestjs/core"),
    import("../../api/src/app.module.js"),
  ]);

  const workerRuntime = createRepositoryScanWorker();
  await workerRuntime.worker.waitUntilReady();

  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix("api");
  await app.listen(port);

  const connectResponse = await fetch(
    `http://127.0.0.1:${port}/api/repositories/connect`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        owner: "zhaoyongze123",
        repo: "ai-pr-review-assistant",
      }),
    },
  );
  assert.equal(connectResponse.status, 200);
  const connectPayload = RepositoryConnectResponseSchema.parse(
    await connectResponse.json(),
  );
  const repositoryId = connectPayload.repository.id!;

  const triggerResponse = await fetch(
    `http://127.0.0.1:${port}/api/repositories/${repositoryId}/scan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scanType: "full",
        requestedBy: "m2-smoke",
      }),
    },
  );
  assert.equal(triggerResponse.status, 200);
  const triggerPayload = RepositoryScanTriggerResponseSchema.parse(
    await triggerResponse.json(),
  );
  const activeScanId = triggerPayload.scan.id!;

  if (triggerPayload.queued) {
    assert.equal(triggerPayload.deduplicated, false);

    const duplicateResponse = await fetch(
      `http://127.0.0.1:${port}/api/repositories/${repositoryId}/scan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scanType: "full",
          requestedBy: "m3-smoke-duplicate",
        }),
      },
    );
    assert.equal(duplicateResponse.status, 200);
    const duplicatePayload = RepositoryScanTriggerResponseSchema.parse(
      await duplicateResponse.json(),
    );
    assert.equal(duplicatePayload.deduplicated, true);
    assert.equal(duplicatePayload.scan.id, activeScanId);
  } else {
    assert.equal(triggerPayload.deduplicated, true);
  }

  const statusPayload = await pollScanStatus(repositoryId, activeScanId, port);
  assert.equal(statusPayload.scan.status, "done");
  assert.equal(statusPayload.events.length >= 2, true);
  assert.equal(statusPayload.events[0]?.eventName, "repository_scan_started");
  assert.equal(
    statusPayload.events.at(-1)?.eventName,
    "repository_scan_completed",
  );

  const pool = new Pool({
    connectionString: databaseUrl,
  });
  const result = await pool.query<{
    status: string;
    repository_id: string;
    target_sha: string;
  }>(
    `
      select status, repository_id, target_sha
      from repository_scans
      where id = $1
    `,
    [activeScanId],
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0]?.status, "done");
  assert.equal(result.rows[0]?.repository_id, repositoryId);
  assert.ok(result.rows[0]?.target_sha.length);

  const filesResult = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from repository_files
      where scan_id = $1
    `,
    [activeScanId],
  );
  assert.ok(Number(filesResult.rows[0]?.count ?? "0") > 0);

  const symbolsResult = await pool.query<{
    symbol_name: string;
    qualified_name: string;
    file_path: string;
  }>(
    `
      select symbol_name, qualified_name, file_path
      from symbols
      where scan_id = $1
      order by file_path asc, symbol_name asc
      limit 1
    `,
    [activeScanId],
  );
  assert.equal(symbolsResult.rowCount, 1);
  assert.ok(symbolsResult.rows[0]?.symbol_name.length);
  assert.ok(symbolsResult.rows[0]?.qualified_name.length);

  const edgesResult = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from symbol_edges
      where scan_id = $1
        and edge_type = 'calls'
    `,
    [activeScanId],
  );
  assert.ok(Number(edgesResult.rows[0]?.count ?? "0") >= 1);

  const riskTagResult = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from repository_files
      where scan_id = $1
        and jsonb_array_length(risk_tags) > 0
    `,
    [activeScanId],
  );
  assert.ok(Number(riskTagResult.rows[0]?.count ?? "0") >= 1);

  const semanticResult = await pool.query<{ count: string }>(
    `
      select count(*)::text as count
      from semantic_documents
      where scan_id = $1
    `,
    [activeScanId],
  );
  assert.ok(Number(semanticResult.rows[0]?.count ?? "0") >= 1);

  const retrievalResponse = await fetch(
    `http://127.0.0.1:${port}/api/repositories/${repositoryId}/retrieval/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: "architecture design review pipeline",
        limit: 3,
      }),
    },
  );
  assert.equal(retrievalResponse.status, 200);
  const retrievalPayload = SemanticSearchResponseSchema.parse(
    await retrievalResponse.json(),
  );
  assert.ok(retrievalPayload.results.length >= 1);
  assert.ok(retrievalPayload.results[0]?.document.sourcePath.length);
  assert.ok(retrievalPayload.results[0]?.score > 0);

  await pool.end();
  await app.close();
  await workerRuntime.close();

  console.log("repository scan smoke passed");
}

void main().catch((error) => {
  console.error("repository scan smoke failed", error);
  process.exit(1);
});
