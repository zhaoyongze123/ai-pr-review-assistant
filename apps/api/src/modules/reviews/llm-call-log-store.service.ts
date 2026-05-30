import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { LlmCallLogSchema, type LlmCallLog } from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type LlmCallLogRow = {
  id: string;
  review_job_id: string | null;
  file_review_id: string | null;
  provider: string;
  model: string;
  prompt_kind: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  latency_ms: number | null;
  request_metadata: Record<string, unknown> | null;
  response_metadata: Record<string, unknown> | null;
  created_at: Date;
};

@Injectable()
export class LlmCallLogStoreService implements OnModuleDestroy {
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
    reviewJobId?: string;
    fileReviewId?: string;
    provider: string;
    model: string;
    promptKind: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs?: number;
    requestMetadata: Record<string, unknown>;
    responseMetadata: Record<string, unknown>;
  }): Promise<LlmCallLog> {
    try {
      const result = await this.pool.query<LlmCallLogRow>(
        `
          insert into llm_call_logs (
            review_job_id,
            file_review_id,
            provider,
            model,
            prompt_kind,
            input_tokens,
            output_tokens,
            cost_usd,
            latency_ms,
            request_metadata,
            response_metadata
          )
          values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9::jsonb, $10::jsonb)
          returning *
        `,
        [
          input.reviewJobId ?? null,
          input.fileReviewId ?? null,
          input.provider,
          input.model,
          input.promptKind,
          input.inputTokens,
          input.outputTokens,
          input.latencyMs ?? null,
          JSON.stringify(input.requestMetadata),
          JSON.stringify(input.responseMetadata),
        ],
      );

      return this.toLlmCallLog(result.rows[0]!);
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "写入 llm_call_logs 表失败",
        500,
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private toLlmCallLog(row: LlmCallLogRow): LlmCallLog {
    return LlmCallLogSchema.parse({
      id: row.id,
      reviewJobId: row.review_job_id ?? undefined,
      fileReviewId: row.file_review_id ?? undefined,
      provider: row.provider,
      model: row.model,
      promptKind: row.prompt_kind,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: Number(row.cost_usd),
      latencyMs: row.latency_ms ?? undefined,
      requestMetadata: row.request_metadata ?? {},
      responseMetadata: row.response_metadata ?? {},
      createdAt: row.created_at.toISOString(),
    });
  }
}
