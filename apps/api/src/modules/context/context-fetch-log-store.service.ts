import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

@Injectable()
export class ContextFetchLogStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async create(input: {
    reviewJobId: string;
    fileReviewId?: string;
    requestPayload: Record<string, unknown>;
    resultPayload: Record<string, unknown>;
    plannedToolCalls: number;
    usedRound: number;
  }) {
    try {
      await this.pool.query(
        `
          insert into context_fetch_logs (
            review_job_id,
            file_review_id,
            request_payload,
            result_payload,
            planned_tool_calls,
            used_round
          )
          values ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
        `,
        [
          input.reviewJobId,
          input.fileReviewId ?? null,
          JSON.stringify(input.requestPayload),
          JSON.stringify(input.resultPayload),
          input.plannedToolCalls,
          input.usedRound,
        ],
      );
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", "写入 context_fetch_logs 表失败", 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
