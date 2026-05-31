import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import {
  RepositoryScanSchema,
  type LanguageSummary,
  type RepositoryScan,
  type RepositoryScanType,
} from "@ai-pr-review/shared-types";
import { Pool } from "pg";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type RepositoryScanRow = {
  id: string;
  repository_id: string;
  scan_type: RepositoryScanType;
  target_sha: string;
  status: RepositoryScan["status"];
  language_summary: LanguageSummary[];
  framework_summary: string[];
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class RepositoryScanStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async findActiveByRepositoryId(
    repositoryId: string,
  ): Promise<RepositoryScan | null> {
    return this.findOne(
      `
        select
          id,
          repository_id,
          scan_type,
          target_sha,
          status,
          language_summary,
          framework_summary,
          started_at,
          finished_at,
          created_at,
          updated_at
        from repository_scans
        where repository_id = $1
          and status in ('pending', 'running')
        order by created_at desc
        limit 1
      `,
      [repositoryId],
      "查询活动扫描记录失败",
    );
  }

  async createPending(input: {
    repositoryId: string;
    scanType: RepositoryScanType;
    targetSha: string;
  }): Promise<RepositoryScan> {
    const result = await this.queryOne(
      `
        insert into repository_scans (
          repository_id,
          scan_type,
          target_sha,
          status
        )
        values ($1, $2, $3, 'pending')
        returning
          id,
          repository_id,
          scan_type,
          target_sha,
          status,
          language_summary,
          framework_summary,
          started_at,
          finished_at,
          created_at,
          updated_at
      `,
      [input.repositoryId, input.scanType, input.targetSha],
      "创建 repository_scans 记录失败",
    );

    if (!result) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "创建 repository_scans 记录后未返回结果",
        500,
      );
    }

    return this.toRepositoryScan(result);
  }

  async findById(
    repositoryId: string,
    scanId: string,
  ): Promise<RepositoryScan | null> {
    return this.findOne(
      `
        select
          id,
          repository_id,
          scan_type,
          target_sha,
          status,
          language_summary,
          framework_summary,
          started_at,
          finished_at,
          created_at,
          updated_at
        from repository_scans
        where repository_id = $1
          and id = $2
      `,
      [repositoryId, scanId],
      "查询 repository_scans 记录失败",
    );
  }

  async findLatestDoneByRepositoryId(
    repositoryId: string,
  ): Promise<RepositoryScan | null> {
    return this.findOne(
      `
        select
          id,
          repository_id,
          scan_type,
          target_sha,
          status,
          language_summary,
          framework_summary,
          started_at,
          finished_at,
          created_at,
          updated_at
        from repository_scans
        where repository_id = $1
          and status = 'done'
        order by finished_at desc nulls last, created_at desc
        limit 1
      `,
      [repositoryId],
      "查询最新已完成 repository_scans 记录失败",
    );
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async findOne(
    sql: string,
    values: unknown[],
    errorMessage: string,
  ): Promise<RepositoryScan | null> {
    const row = await this.queryOne(sql, values, errorMessage, false);
    if (!row) {
      return null;
    }
    return this.toRepositoryScan(row);
  }

  private async queryOne(
    sql: string,
    values: unknown[],
    errorMessage: string,
    required = true,
  ): Promise<RepositoryScanRow | null> {
    try {
      const result = await this.pool.query<RepositoryScanRow>(sql, values);
      if (!result.rowCount) {
        return required ? null : null;
      }
      return result.rows[0] ?? null;
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", errorMessage, 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private toRepositoryScan(row: RepositoryScanRow): RepositoryScan {
    return RepositoryScanSchema.parse({
      id: row.id,
      repositoryId: row.repository_id,
      scanType: row.scan_type,
      targetSha: row.target_sha,
      status: row.status,
      languageSummary: row.language_summary ?? [],
      frameworkSummary: row.framework_summary ?? [],
      startedAt: row.started_at?.toISOString(),
      finishedAt: row.finished_at?.toISOString(),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
}
