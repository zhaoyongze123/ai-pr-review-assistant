import {
  REPOSITORY_SCAN_QUEUE_NAME,
  RepositoryScanJobPayloadSchema,
  type RepositoryScanJobPayload,
  type RepositoryScanStartedEvent,
  type RepositoryScanCompletedEvent,
  type RepositoryScanFailedEvent,
} from "@ai-pr-review/shared-types";
import { analyzeRepositorySnapshot } from "@ai-pr-review/repo-intelligence";
import { Worker } from "bullmq";
import Redis from "ioredis";
import { Pool } from "pg";
import { RepositoryIndexStore } from "./repository-index-store.js";
import { withClonedRepository } from "./repository-clone.js";
import { RepositoryScanEventStore } from "./repository-scan-event-store.js";
import { RepositorySourceStore } from "./repository-source-store.js";
import { RepositoryScanStore } from "./repository-scan-store.js";
import { WorkerConfig } from "./worker-config.js";

export function createRepositoryScanWorker(config = new WorkerConfig()) {
  const eventRedis = new Redis(config.redisUrl);
  const pool = new Pool({
    connectionString: config.databaseUrl,
  });
  const scanStore = new RepositoryScanStore(pool);
  const repositorySourceStore = new RepositorySourceStore(pool);
  const repositoryIndexStore = new RepositoryIndexStore(pool);
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

        const repository = await repositorySourceStore.findById(
          payload.repositoryId,
        );
        if (!repository) {
          throw new Error("扫描任务关联的仓库不存在");
        }

        const analysis = await withClonedRepository({
          cloneUrl: repository.cloneUrl,
          ref: payload.targetSha,
          authToken: config.githubToken,
          callback: async (rootDir) =>
            analyzeRepositorySnapshot({
              repositoryId: payload.repositoryId,
              scanId: payload.scanId,
              rootDir,
            }),
        });

        await repositoryIndexStore.replaceForScan(
          payload.repositoryId,
          payload.scanId,
          {
            files: analysis.files,
            symbols: analysis.symbols,
            edges: analysis.edges,
          },
        );

        const doneScan = await scanStore.markDone(
          payload.scanId,
          analysis.languageSummary,
          analysis.frameworkSummary,
        );
        const structuredCounts = await scanStore.getStructuredCounts(
          payload.scanId,
        );
        const completedEvent: RepositoryScanCompletedEvent = {
          eventName: "repository_scan_completed",
          occurredAt: new Date().toISOString(),
          payload: {
            repositoryId: payload.repositoryId,
            scanId: payload.scanId,
            targetSha: payload.targetSha,
            status: "done",
            fileCount: structuredCounts.fileCount,
            symbolCount: structuredCounts.symbolCount,
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
