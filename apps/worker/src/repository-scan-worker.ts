import {
  REPOSITORY_SCAN_QUEUE_NAME,
  RepositoryScanJobPayloadSchema,
  type RepositoryScanJobPayload,
  type RepositoryScanStartedEvent,
  type RepositoryScanCompletedEvent,
  type RepositoryScanFailedEvent,
} from "@ai-pr-review/shared-types";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { Pool } from "pg";
import { RepositoryScanEventStore } from "./repository-scan-event-store.js";
import { RepositoryScanStore } from "./repository-scan-store.js";
import { WorkerConfig } from "./worker-config.js";

export function createRepositoryScanWorker(config = new WorkerConfig()) {
  const eventRedis = new Redis(config.redisUrl);
  const pool = new Pool({
    connectionString: config.databaseUrl,
  });
  const scanStore = new RepositoryScanStore(pool);
  const eventStore = new RepositoryScanEventStore(eventRedis);

  const worker = new Worker<RepositoryScanJobPayload>(
    REPOSITORY_SCAN_QUEUE_NAME,
    async (job) => {
      const payload = RepositoryScanJobPayloadSchema.parse(job.data);
      try {
        const runningScan = await scanStore.markRunning(payload.scanId);
        const startedEvent: RepositoryScanStartedEvent = {
          eventName: "repository_scan_started",
          occurredAt: new Date().toISOString(),
          payload: {
            repositoryId: payload.repositoryId,
            scanId: payload.scanId,
            targetSha: payload.targetSha,
            status: "running",
          },
        };
        await eventStore.append(payload.scanId, startedEvent);

        // M2 先验证编排链路；真正的仓库扫描和索引提取放到 M3/M4。
        await new Promise((resolve) =>
          setTimeout(resolve, config.processingDelayMs),
        );

        const doneScan = await scanStore.markDone(
          payload.scanId,
          [],
          ["scan_pipeline_ready"],
        );
        const completedEvent: RepositoryScanCompletedEvent = {
          eventName: "repository_scan_completed",
          occurredAt: new Date().toISOString(),
          payload: {
            repositoryId: payload.repositoryId,
            scanId: payload.scanId,
            targetSha: payload.targetSha,
            status: "done",
            fileCount: doneScan.languageSummary.reduce(
              (total, item) => total + item.fileCount,
              0,
            ),
            symbolCount: 0,
            semanticDocumentCount: 0,
          },
        };
        await eventStore.append(payload.scanId, completedEvent);

        return {
          scanId: payload.scanId,
          status: doneScan.status,
        };
      } catch (error) {
        await scanStore.markFailed(payload.scanId);
        const failedEvent: RepositoryScanFailedEvent = {
          eventName: "repository_scan_failed",
          occurredAt: new Date().toISOString(),
          payload: {
            repositoryId: payload.repositoryId,
            scanId: payload.scanId,
            targetSha: payload.targetSha,
            status: "failed",
            errorMessage:
              error instanceof Error ? error.message : "未知扫描失败",
          },
        };
        await eventStore.append(payload.scanId, failedEvent);
        throw error;
      }
    },
    {
      connection: config.bullmqConnection,
      concurrency: 4,
    },
  );

  const close = async () => {
    await worker.close();
    await pool.end();
    await eventRedis.quit();
  };

  return {
    worker,
    close,
  };
}
