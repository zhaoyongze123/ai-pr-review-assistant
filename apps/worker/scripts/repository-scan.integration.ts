import assert from "node:assert/strict";
import "reflect-metadata";
import { Pool } from "pg";
import {
  RepositoryConnectResponseSchema,
  RepositoryScanStatusResponseSchema,
  RepositoryScanTriggerResponseSchema,
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
  assert.equal(triggerPayload.queued, true);
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
        requestedBy: "m2-smoke-duplicate",
      }),
    },
  );
  assert.equal(duplicateResponse.status, 200);
  const duplicatePayload = RepositoryScanTriggerResponseSchema.parse(
    await duplicateResponse.json(),
  );
  assert.equal(duplicatePayload.deduplicated, true);
  assert.equal(duplicatePayload.scan.id, triggerPayload.scan.id);

  const statusPayload = await pollScanStatus(
    repositoryId,
    triggerPayload.scan.id!,
    port,
  );
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
    [triggerPayload.scan.id],
  );
  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0]?.status, "done");
  assert.equal(result.rows[0]?.repository_id, repositoryId);
  assert.ok(result.rows[0]?.target_sha.length);

  await pool.end();
  await app.close();
  await workerRuntime.close();

  console.log("repository scan smoke passed");
}

void main().catch((error) => {
  console.error("repository scan smoke failed", error);
  process.exit(1);
});
