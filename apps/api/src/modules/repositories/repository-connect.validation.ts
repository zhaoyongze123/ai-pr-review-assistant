import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BadRequestException, HttpException } from "@nestjs/common";
import {
  ApiErrorResponseSchema,
  RepositoryConnectResponseSchema,
} from "@ai-pr-review/shared-types";
import { ApiModuleError } from "./api-error.js";
import { RepositoriesController } from "./repositories.controller.js";
import { RepositoryConnectService } from "./repository-connect.service.js";

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

async function validateFixtures() {
  const successFixture = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/repository-connect.response.json"),
      "utf8",
    ),
  );
  const failureFixture = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/repository-connect.failure.json"),
      "utf8",
    ),
  );

  RepositoryConnectResponseSchema.parse(successFixture);
  ApiErrorResponseSchema.parse(failureFixture);
}

async function expectValidationFailure() {
  const controller = new RepositoriesController(
    {
      connect: async () => {
        throw new Error("不应该走到 service");
      },
    } as unknown as RepositoryConnectService,
    {
      getMap: async () => {
        throw new Error("不应该走到 semantic map service");
      },
    } as never,
  );

  try {
    await controller.connect({ owner: "", repo: "demo" });
    assert.fail("空 owner 应该直接触发请求校验失败");
  } catch (error) {
    assert(error instanceof BadRequestException);
    ApiErrorResponseSchema.parse(error.getResponse());
  }
}

async function expectServiceFailure() {
  const controller = new RepositoriesController(
    {
      connect: async () => {
        throw new ApiModuleError(
          "REPOSITORY_FORBIDDEN",
          "当前 token 没有访问该仓库的权限",
          403,
          {
            owner: "acme-inc",
            repo: "private-repo",
          },
        );
      },
    } as unknown as RepositoryConnectService,
    {
      getMap: async () => {
        throw new Error("不应该走到 semantic map service");
      },
    } as never,
  );

  try {
    await controller.connect({ owner: "acme-inc", repo: "private-repo" });
    assert.fail("无权限仓库应该返回 403");
  } catch (error) {
    assert(error instanceof HttpException);
    assert.equal(error.getStatus(), 403);
    ApiErrorResponseSchema.parse(error.getResponse());
  }
}

async function expectSuccess() {
  const controller = new RepositoriesController(
    {
      connect: async () =>
        RepositoryConnectResponseSchema.parse({
          repository: {
            id: "9fd5b4de-c438-44c3-b4ae-1d1fe667d4b7",
            provider: "github",
            owner: "acme-inc",
            repo: "payments-service",
            defaultBranch: "main",
            cloneUrl: "https://github.com/acme-inc/payments-service.git",
            isActive: true,
            createdAt: "2026-05-30T03:20:00.000Z",
            updatedAt: "2026-05-30T03:20:00.000Z",
          },
          accepted: true,
        }),
    } as unknown as RepositoryConnectService,
    {
      getMap: async () => {
        throw new Error("不应该走到 semantic map service");
      },
    } as never,
  );

  const response = await controller.connect({
    owner: "acme-inc",
    repo: "payments-service",
  });
  RepositoryConnectResponseSchema.parse(response);
}

async function main() {
  await validateFixtures();
  await expectSuccess();
  await expectValidationFailure();
  await expectServiceFailure();
  console.log("repository connect validation passed");
}

void main();
