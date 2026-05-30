import {
  RepositoryScanEventSchema,
  type RepositoryScanEvent,
} from "@ai-pr-review/shared-types";
import Redis from "ioredis";

export class RepositoryScanEventStore {
  constructor(private readonly redis: Redis) {}

  async append(scanId: string, event: RepositoryScanEvent) {
    const payload = JSON.stringify(RepositoryScanEventSchema.parse(event));
    const key = this.getKey(scanId);

    await this.redis.rpush(key, payload);
    await this.redis.expire(key, 24 * 60 * 60);
    await this.redis.publish("repository-scan-events", payload);
  }

  private getKey(scanId: string) {
    return `repository-scan-events:${scanId}`;
  }
}
