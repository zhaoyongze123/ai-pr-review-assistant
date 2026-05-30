import { Inject, Injectable } from "@nestjs/common";
import {
  RepositoryScanStatusResponseSchema,
  RepositoryScanTriggerResponseSchema,
  type RepositoryScanStatusResponse,
  type RepositoryScanTriggerRequest,
  type RepositoryScanTriggerResponse,
} from "@ai-pr-review/shared-types";
import { ApiModuleError } from "../repositories/api-error.js";
import { RepositoryStoreService } from "../repositories/repository-store.service.js";
import { RepositoryScanEventStoreService } from "./repository-scan-event-store.service.js";
import { RepositoryScanQueueService } from "./repository-scan-queue.service.js";
import { RepositoryScanStoreService } from "./repository-scan-store.service.js";

@Injectable()
export class RepositoryScanService {
  constructor(
    @Inject(RepositoryStoreService)
    private readonly repositoryStoreService: RepositoryStoreService,
    @Inject(RepositoryScanStoreService)
    private readonly repositoryScanStoreService: RepositoryScanStoreService,
    @Inject(RepositoryScanQueueService)
    private readonly repositoryScanQueueService: RepositoryScanQueueService,
    @Inject(RepositoryScanEventStoreService)
    private readonly repositoryScanEventStoreService: RepositoryScanEventStoreService,
  ) {}

  async trigger(
    repositoryId: string,
    request: RepositoryScanTriggerRequest,
  ): Promise<RepositoryScanTriggerResponse> {
    const repository = await this.repositoryStoreService.findById(repositoryId);
    if (!repository) {
      throw new ApiModuleError(
        "REPOSITORY_NOT_FOUND",
        "目标仓库不存在，无法创建扫描任务",
        404,
        {
          repositoryId,
        },
      );
    }

    const activeScan =
      await this.repositoryScanStoreService.findActiveByRepositoryId(
        repositoryId,
      );

    if (activeScan) {
      return RepositoryScanTriggerResponseSchema.parse({
        scan: activeScan,
        queued: false,
        deduplicated: true,
      });
    }

    const targetSha = request.targetSha ?? `branch:${repository.defaultBranch}`;
    const scan = await this.repositoryScanStoreService.createPending({
      repositoryId,
      scanType: request.scanType,
      targetSha,
    });

    await this.repositoryScanQueueService.enqueue({
      scanId: scan.id!,
      repositoryId,
      scanType: scan.scanType,
      targetSha: scan.targetSha,
      requestedBy: request.requestedBy,
    });

    return RepositoryScanTriggerResponseSchema.parse({
      scan,
      queued: true,
      deduplicated: false,
    });
  }

  async getStatus(
    repositoryId: string,
    scanId: string,
  ): Promise<RepositoryScanStatusResponse> {
    const scan = await this.repositoryScanStoreService.findById(
      repositoryId,
      scanId,
    );
    if (!scan) {
      throw new ApiModuleError("SCAN_NOT_FOUND", "扫描任务不存在", 404, {
        repositoryId,
        scanId,
      });
    }

    const events =
      await this.repositoryScanEventStoreService.listEvents(scanId);
    return RepositoryScanStatusResponseSchema.parse({
      scan,
      events,
    });
  }
}
