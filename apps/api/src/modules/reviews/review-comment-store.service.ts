import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import {
  ReviewCommentSchema,
  type ReviewComment,
} from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type ReviewCommentRow = {
  id: string;
  review_job_id: string;
  file_review_id: string | null;
  source: ReviewComment["source"];
  category: ReviewComment["category"];
  severity: ReviewComment["severity"];
  title: string;
  message: string;
  suggestion: string | null;
  file_path: string;
  diff_line_ref: string | null;
  line_start: number | null;
  line_end: number | null;
  old_line_start: number | null;
  old_line_end: number | null;
  fingerprint: string | null;
  evidence_refs: string[] | null;
  quality_score: string | null;
  admission_reasons: string[] | null;
  is_resolved: boolean;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class ReviewCommentStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async createMany(comments: ReviewComment[]): Promise<ReviewComment[]> {
    const created: ReviewComment[] = [];

    for (const comment of comments) {
      created.push(await this.create(comment));
    }

    return created;
  }

  async findByReviewJobId(reviewJobId: string): Promise<ReviewComment[]> {
    try {
      const result = await this.pool.query<ReviewCommentRow>(
        `
          select *
          from review_comments
          where review_job_id = $1
          order by
            case severity
              when 'HIGH' then 0
              when 'MEDIUM' then 1
              when 'LOW' then 2
              else 3
            end asc,
            created_at asc
        `,
        [reviewJobId],
      );

      return result.rows.map((row) => this.toReviewComment(row));
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "查询 review_comments 表失败",
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

  private async create(comment: ReviewComment): Promise<ReviewComment> {
    try {
      const result = await this.pool.query<ReviewCommentRow>(
        `
          insert into review_comments (
            review_job_id,
            file_review_id,
            source,
            category,
            severity,
            title,
            message,
            suggestion,
            file_path,
            diff_line_ref,
            line_start,
            line_end,
            old_line_start,
            old_line_end,
            fingerprint,
            evidence_refs,
            quality_score,
            admission_reasons,
            is_resolved,
            metadata
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15, $16::jsonb, $17, $18::jsonb, $19, $20::jsonb
          )
          returning *
        `,
        [
          comment.reviewJobId,
          comment.fileReviewId ?? null,
          comment.source,
          comment.category,
          comment.severity,
          comment.title,
          comment.message,
          comment.suggestion ?? null,
          comment.filePath,
          comment.diffLineRef ?? null,
          comment.lineStart ?? null,
          comment.lineEnd ?? null,
          comment.oldLineStart ?? null,
          comment.oldLineEnd ?? null,
          comment.fingerprint ?? null,
          JSON.stringify(comment.evidenceRefs),
          comment.qualityScore ?? null,
          JSON.stringify(comment.admissionReasons),
          comment.isResolved,
          JSON.stringify(comment.metadata ?? {}),
        ],
      );

      return this.toReviewComment(result.rows[0]!);
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "写入 review_comments 表失败",
        500,
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  private toReviewComment(row: ReviewCommentRow): ReviewComment {
    return ReviewCommentSchema.parse({
      id: row.id,
      reviewJobId: row.review_job_id,
      fileReviewId: row.file_review_id ?? undefined,
      source: row.source,
      category: row.category,
      severity: row.severity,
      title: row.title,
      message: row.message,
      suggestion: row.suggestion ?? undefined,
      filePath: row.file_path,
      diffLineRef: row.diff_line_ref ?? undefined,
      lineStart: row.line_start ?? undefined,
      lineEnd: row.line_end ?? undefined,
      oldLineStart: row.old_line_start ?? undefined,
      oldLineEnd: row.old_line_end ?? undefined,
      fingerprint: row.fingerprint ?? undefined,
      evidenceRefs: row.evidence_refs ?? [],
      qualityScore:
        row.quality_score !== null ? Number(row.quality_score) : undefined,
      admissionReasons: row.admission_reasons ?? [],
      isResolved: row.is_resolved,
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
}
