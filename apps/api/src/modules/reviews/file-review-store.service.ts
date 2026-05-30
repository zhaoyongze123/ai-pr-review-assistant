import { createHash } from "node:crypto";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import {
  FileReviewSchema,
  type FileReview,
  type HighestSeverity,
  type PullRequestFile,
  type ReviewDecision,
} from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type FileReviewRow = {
  id: string;
  review_job_id: string;
  pull_request_id: string | null;
  file_path: string;
  language: string | null;
  file_status: PullRequestFile["status"];
  patch_sha256: string | null;
  is_cached: boolean;
  slice_count: number;
  ai_comment_count: number;
  rule_comment_count: number;
  highest_severity: HighestSeverity;
  risk_score: number;
  summary: string | null;
  duration_ms: number | null;
  triage_decision: ReviewDecision | null;
  context_round: number;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class FileReviewStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async upsertResult(input: {
    reviewJobId: string;
    pullRequestId?: string;
    file: PullRequestFile;
    triageDecision: ReviewDecision;
    aiCommentCount: number;
    ruleCommentCount: number;
    highestSeverity: HighestSeverity;
    riskScore: number;
    summary?: string;
    durationMs: number;
    contextRound?: number;
  }): Promise<FileReview> {
    return this.queryOne(
      `
        insert into file_reviews (
          review_job_id,
          pull_request_id,
          file_path,
          language,
          file_status,
          patch_sha256,
          is_cached,
          slice_count,
          ai_comment_count,
          rule_comment_count,
          highest_severity,
          risk_score,
          summary,
          duration_ms,
          triage_decision,
          context_round
        )
        values (
          $1, $2, $3, $4, $5, $6, false, 1, $7, $8, $9, $10, $11, $12, $13, $14
        )
        on conflict (review_job_id, file_path)
        do update set
          language = excluded.language,
          file_status = excluded.file_status,
          patch_sha256 = excluded.patch_sha256,
          ai_comment_count = excluded.ai_comment_count,
          rule_comment_count = excluded.rule_comment_count,
          highest_severity = excluded.highest_severity,
          risk_score = excluded.risk_score,
          summary = excluded.summary,
          duration_ms = excluded.duration_ms,
          triage_decision = excluded.triage_decision,
          context_round = excluded.context_round,
          updated_at = now()
        returning *
      `,
      [
        input.reviewJobId,
        input.pullRequestId ?? null,
        input.file.filePath,
        input.file.language ?? null,
        input.file.status,
        sha256(input.file.patch ?? ""),
        input.aiCommentCount,
        input.ruleCommentCount,
        input.highestSeverity,
        input.riskScore,
        input.summary ?? null,
        input.durationMs,
        input.triageDecision,
        input.contextRound ?? 0,
      ],
      "写入 file_reviews 表失败",
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async queryOne(
    sql: string,
    values: unknown[],
    errorMessage: string,
  ): Promise<FileReview> {
    try {
      const result = await this.pool.query<FileReviewRow>(sql, values);
      if (!result.rowCount || !result.rows[0]) {
        throw new Error("未返回 file review 结果");
      }
      return this.toFileReview(result.rows[0]);
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", errorMessage, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toFileReview(row: FileReviewRow): FileReview {
    return FileReviewSchema.parse({
      id: row.id,
      reviewJobId: row.review_job_id,
      pullRequestId: row.pull_request_id ?? undefined,
      filePath: row.file_path,
      language: row.language ?? undefined,
      fileStatus: row.file_status,
      patchSha256: row.patch_sha256 ?? undefined,
      isCached: row.is_cached,
      sliceCount: row.slice_count,
      aiCommentCount: row.ai_comment_count,
      ruleCommentCount: row.rule_comment_count,
      highestSeverity: row.highest_severity,
      riskScore: row.risk_score,
      summary: row.summary ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      triageDecision: row.triage_decision ?? undefined,
      contextRound: row.context_round,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
