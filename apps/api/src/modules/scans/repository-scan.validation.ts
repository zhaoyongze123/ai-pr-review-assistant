import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BadRequestException, HttpException } from "@nestjs/common";
import {
  ApiErrorResponseSchema,
  RepositoryScanStatusResponseSchema,
  RepositoryScanTriggerResponseSchema,
} from "@ai-pr-review/shared-types";
import { ApiModuleError } from "../repositories/api-error.js";
import { RepositoryScansController } from "./repository-scans.controller.js";
import { RepositoryScanService } from "./repository-scan.service.js";

const workspaceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../",
);

async function validateFixtures() {
  const triggeredFixture = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/repository-scan.triggered.json"),
      "utf8",
    ),
  );
  const statusFixture = JSON.parse(
    await readFile(
      resolve(workspaceRoot, "fixtures/repository-scan.status.done.json"),
      "utf8",
    ),
  );

  RepositoryScanTriggerResponseSchema.parse(triggeredFixture);
  RepositoryScanStatusResponseSchema.parse(statusFixture);
}

async function expectValidationFailure() {
  const controller = new RepositoryScansController({
    trigger: async () => {
      throw new Error("不应该走到 service");
    },
    getStatus: async () => {
      throw new Error("不应该走到 service");
    },
  } as unknown as RepositoryScanService);

  try {
    await controller.triggerScan("not-a-uuid", { scanType: "full" });
    assert.fail("非法 repositoryId 应直接校验失败");
  } catch (error) {
    assert(error instanceof BadRequestException);
    ApiErrorResponseSchema.parse(error.getResponse());
  }
}

async function expectServiceFailure() {
  const controller = new RepositoryScansController({
    trigger: async () => {
      throw new ApiModuleError("SCAN_NOT_FOUND", "扫描任务不存在", 404);
    },
    getStatus: async () => {
      throw new ApiModuleError("SCAN_NOT_FOUND", "扫描任务不存在", 404);
    },
  } as unknown as RepositoryScanService);

  try {
    await controller.getScanStatus(
      "9fd5b4de-c438-44c3-b4ae-1d1fe667d4b7",
      "f66d8668-d7d8-447f-9d94-cfb3e4f98f1e",
    );
    assert.fail("不存在的扫描任务应该返回 404");
  } catch (error) {
    assert(error instanceof HttpException);
    assert.equal(error.getStatus(), 404);
    ApiErrorResponseSchema.parse(error.getResponse());
  }
}

async function main() {
  await validateFixtures();
  await expectValidationFailure();
  await expectServiceFailure();
  console.log("repository scan validation passed");
}

void main();
