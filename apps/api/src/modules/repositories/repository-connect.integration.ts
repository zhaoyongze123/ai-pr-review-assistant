import assert from "node:assert/strict";
import { appendFile, writeFile } from "node:fs/promises";
import "reflect-metadata";

const traceFile = "/tmp/repository-connect-smoke.trace";

async function trace(message: string) {
  await appendFile(traceFile, `${message}\n`, "utf8");
}

async function main() {
  await writeFile(traceFile, "", "utf8");
  await trace("main:start");
  const port = Number(process.env.PORT ?? 3301);
  const databaseUrl = process.env.DATABASE_URL;

  assert(databaseUrl, "smoke 测试必须提供 DATABASE_URL");
  await trace("main:env-ready");

  const [{ NestFactory }, { Pool }, sharedTypes, { AppModule }] =
    await Promise.all([
      import("@nestjs/core"),
      import("pg"),
      import("@ai-pr-review/shared-types"),
      import("../../app.module.js"),
    ]);
  await trace("main:imports-ready");

  const { ApiErrorResponseSchema, RepositoryConnectResponseSchema } =
    sharedTypes;

  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  await trace("main:app-created");
  app.setGlobalPrefix("api");
  await app.listen(port);
  await trace("main:app-listening");

  const successResponse = await fetch(
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

  assert.equal(successResponse.status, 200);
  const successPayload = RepositoryConnectResponseSchema.parse(
    await successResponse.json(),
  );
  await trace("main:success-response-validated");

  const failureResponse = await fetch(
    `http://127.0.0.1:${port}/api/repositories/connect`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        owner: "zhaoyongze123",
        repo: "repo-does-not-exist-for-m1-check",
      }),
    },
  );

  assert.equal(failureResponse.status, 404);
  const failurePayload = ApiErrorResponseSchema.parse(
    await failureResponse.json(),
  );
  assert.equal(failurePayload.error.code, "REPOSITORY_NOT_FOUND");
  await trace("main:failure-response-validated");

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  const result = await pool.query<{
    provider: string;
    owner: string;
    repo: string;
    default_branch: string;
    clone_url: string;
  }>(
    `
      select provider, owner, repo, default_branch, clone_url
      from repositories
      where owner = $1 and repo = $2
    `,
    [successPayload.repository.owner, successPayload.repository.repo],
  );

  assert.equal(result.rowCount, 1);
  assert.equal(result.rows[0]?.provider, "github");
  assert.equal(result.rows[0]?.owner, "zhaoyongze123");
  assert.equal(result.rows[0]?.repo, "ai-pr-review-assistant");
  assert.ok(result.rows[0]?.default_branch.length);
  assert.ok(result.rows[0]?.clone_url.length);
  await trace("main:database-validated");

  await pool.end();
  await app.close();
  await trace("main:closed");

  console.log("repository connect smoke passed");
}

void main().catch((error) => {
  console.error("repository connect smoke failed", error);
  process.exit(1);
});
