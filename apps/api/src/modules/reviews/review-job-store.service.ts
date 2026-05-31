import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import {
  ReviewJobSchema,
  type ReviewJob,
  type ReviewTriggerSource,
} from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type ReviewJobRow = {
  id: string;
  repository_id: string | null;
  pull_request_id: string | null;
  trigger_source: ReviewTriggerSource;
  status: ReviewJob["status"];
  total_files: number;
  finished_files: number;
  total_slices: number;
  finished_slices: number;
  cache_hit_files: number;
  llm_provider: string | null;
  llm_model: string | null;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: string;
  duration_ms: number | null;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class ReviewJobStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async createRunning(input: {
    repositoryId?: string;
    pullRequestId?: string;
    triggerSource: ReviewTriggerSource;
    totalFiles: number;
    totalSlices: number;
    llmProvider: string;
    llmModel: string;
  }): Promise<ReviewJob> {
    return this.queryOne(
      `
        insert into review_jobs (
          repository_id,
          pull_request_id,
          trigger_source,
          status,
          total_files,
          finished_files,
          total_slices,
          finished_slices,
          llm_provider,
          llm_model,
          started_at
        )
        values ($1, $2, $3, 'running', $4, 0, $5, 0, $6, $7, now())
        returning *
      `,
      [
        input.repositoryId ?? null,
        input.pullRequestId ?? null,
        input.triggerSource,
        input.totalFiles,
        input.totalSlices,
        input.llmProvider,
        input.llmModel,
      ],
      "创建 review_jobs 记录失败",
    );
  }

  async findById(reviewJobId: string): Promise<ReviewJob | null> {
    return this.findOne(
      `
        select *
        from review_jobs
        where id = $1
      `,
      [reviewJobId],
      "查询 review_jobs 记录失败",
    );
  }

  async markProgress(input: {
    reviewJobId: string;
    finishedFiles: number;
    finishedSlices: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd?: number;
  }): Promise<ReviewJob> {
    return this.queryOne(
      `
        update review_jobs
        set
          status = 'running',
          finished_files = $2,
          finished_slices = $3,
          total_input_tokens = $4,
          total_output_tokens = $5,
          total_cost_usd = $6,
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        input.reviewJobId,
        input.finishedFiles,
        input.finishedSlices,
        input.totalInputTokens,
        input.totalOutputTokens,
        input.totalCostUsd ?? 0,
      ],
      "更新 review_jobs 进度失败",
    );
  }

  async markDone(input: {
    reviewJobId: string;
    finishedFiles: number;
    finishedSlices: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    durationMs: number;
  }): Promise<ReviewJob> {
    return this.queryOne(
      `
        update review_jobs
        set
          status = 'done',
          finished_files = $2,
          finished_slices = $3,
          total_input_tokens = $4,
          total_output_tokens = $5,
          total_cost_usd = $6,
          duration_ms = $7,
          finished_at = now(),
          updated_at = now()
        where id = $1
        returning *
      `,
      [
        input.reviewJobId,
        input.finishedFiles,
        input.finishedSlices,
        input.totalInputTokens,
        input.totalOutputTokens,
        input.totalCostUsd,
        input.durationMs,
      ],
      "更新 review_jobs 为 done 失败",
    );
  }

  async markFailed(reviewJobId: string, message: string): Promise<ReviewJob> {
    return this.queryOne(
      `
        update review_jobs
        set
          status = 'failed',
          error_message = $2,
          finished_at = now(),
          updated_at = now()
        where id = $1
        returning *
      `,
      [reviewJobId, message],
      "更新 review_jobs 为 failed 失败",
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async findOne(
    sql: string,
    values: unknown[],
    errorMessage: string,
  ): Promise<ReviewJob | null> {
    try {
      const result = await this.pool.query<ReviewJobRow>(sql, values);
      if (!result.rowCount || !result.rows[0]) {
        return null;
      }
      return this.toReviewJob(result.rows[0]);
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", errorMessage, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async queryOne(
    sql: string,
    values: unknown[],
    errorMessage: string,
  ): Promise<ReviewJob> {
    try {
      const result = await this.pool.query<ReviewJobRow>(sql, values);
      if (!result.rowCount || !result.rows[0]) {
        throw new Error("未返回 review job 结果");
      }
      return this.toReviewJob(result.rows[0]);
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", errorMessage, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toReviewJob(row: ReviewJobRow): ReviewJob {
    return ReviewJobSchema.parse({
      id: row.id,
      repositoryId: row.repository_id ?? undefined,
      pullRequestId: row.pull_request_id ?? undefined,
      triggerSource: row.trigger_source,
      status: row.status,
      totalFiles: row.total_files,
      finishedFiles: row.finished_files,
      totalSlices: row.total_slices,
      finishedSlices: row.finished_slices,
      cacheHitFiles: row.cache_hit_files,
      llmProvider: row.llm_provider ?? undefined,
      llmModel: row.llm_model ?? undefined,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalCostUsd: Number(row.total_cost_usd),
      durationMs: row.duration_ms ?? undefined,
      errorMessage: row.error_message ?? undefined,
      startedAt: row.started_at?.toISOString(),
      finishedAt: row.finished_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
}
