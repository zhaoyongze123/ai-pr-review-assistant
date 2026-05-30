import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  REPOSITORY_SCAN_QUEUE_NAME,
  RepositoryScanJobPayloadSchema,
  type RepositoryScanJobPayload,
} from "@ai-pr-review/shared-types";
import { Queue } from "bullmq";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

@Injectable()
export class RepositoryScanQueueService implements OnModuleDestroy {
  private readonly queue: Queue<RepositoryScanJobPayload>;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    const redisUrl = new URL(this.configService.redisUrl);
    this.queue = new Queue(REPOSITORY_SCAN_QUEUE_NAME, {
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || "6379"),
        db: Number(redisUrl.pathname.replace("/", "") || "0"),
        maxRetriesPerRequest: null,
      },
    });
  }

  async enqueue(jobPayload: RepositoryScanJobPayload) {
    try {
      const payload = RepositoryScanJobPayloadSchema.parse(jobPayload);
      await this.queue.add("scan", payload, {
        jobId: payload.scanId,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      });
    } catch (error) {
      throw new ApiModuleError("REDIS_ERROR", "写入扫描队列失败", 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
