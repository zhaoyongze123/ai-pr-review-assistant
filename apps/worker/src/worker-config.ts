export class WorkerConfig {
  get redisUrl(): string {
    const value = process.env.REDIS_URL?.trim();
    if (!value) {
      throw new Error("缺少 REDIS_URL 环境变量");
    }
    return value;
  }

  get databaseUrl(): string {
    const value = process.env.DATABASE_URL?.trim();
    if (!value) {
      throw new Error("缺少 DATABASE_URL 环境变量");
    }
    return value;
  }

  get bullmqConnection() {
    const redisUrl = new URL(this.redisUrl);
    return {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || "6379"),
      db: Number(redisUrl.pathname.replace("/", "") || "0"),
      maxRetriesPerRequest: null,
    };
  }

  get processingDelayMs(): number {
    return Number(process.env.SCAN_PROCESSING_DELAY_MS ?? 50);
  }

  get githubToken(): string | undefined {
    const value = process.env.GITHUB_TOKEN?.trim();
    return value ? value : undefined;
  }
}
