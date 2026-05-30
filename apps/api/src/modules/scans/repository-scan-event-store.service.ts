import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  RepositoryScanEventSchema,
  type RepositoryScanEvent,
} from "@ai-pr-review/shared-types";
import Redis from "ioredis";
import { ApiConfigService } from "../repositories/api-config.service.js";

@Injectable()
export class RepositoryScanEventStoreService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.redis = new Redis(this.configService.redisUrl);
  }

  async listEvents(scanId: string): Promise<RepositoryScanEvent[]> {
    const values = await this.redis.lrange(this.getKey(scanId), 0, -1);
    return values.map((value) =>
      RepositoryScanEventSchema.parse(JSON.parse(value)),
    );
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private getKey(scanId: string) {
    return `repository-scan-events:${scanId}`;
  }
}
