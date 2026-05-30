import { Pool } from "pg";
import {
  RepositoryScanSchema,
  type LanguageSummary,
  type RepositoryScan,
} from "@ai-pr-review/shared-types";

type RepositoryScanRow = {
  id: string;
  repository_id: string;
  scan_type: RepositoryScan["scanType"];
  target_sha: string;
  status: RepositoryScan["status"];
  language_summary: LanguageSummary[];
  framework_summary: string[];
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export class RepositoryScanStore {
  constructor(private readonly pool: Pool) {}

  async markRunning(scanId: string): Promise<RepositoryScan> {
    return this.update(
      `
        update repository_scans
        set
          status = 'running',
          started_at = coalesce(started_at, now()),
          updated_at = now()
        where id = $1
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
      [scanId],
      "更新扫描任务为 running 失败",
    );
  }

  async markDone(
    scanId: string,
    languageSummary: LanguageSummary[],
    frameworkSummary: string[],
  ): Promise<RepositoryScan> {
    return this.update(
      `
        update repository_scans
        set
          status = 'done',
          language_summary = $2::jsonb,
          framework_summary = $3::jsonb,
          finished_at = now(),
          updated_at = now()
        where id = $1
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
      [
        scanId,
        JSON.stringify(languageSummary),
        JSON.stringify(frameworkSummary),
      ],
      "更新扫描任务为 done 失败",
    );
  }

  async markFailed(scanId: string): Promise<RepositoryScan | null> {
    const result = await this.pool.query<RepositoryScanRow>(
      `
        update repository_scans
        set
          status = 'failed',
          finished_at = now(),
          updated_at = now()
        where id = $1
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
      [scanId],
    );

    return result.rowCount ? this.toRepositoryScan(result.rows[0]!) : null;
  }

  private async update(
    sql: string,
    values: unknown[],
    errorMessage: string,
  ): Promise<RepositoryScan> {
    try {
      const result = await this.pool.query<RepositoryScanRow>(sql, values);
      if (!result.rowCount || !result.rows[0]) {
        throw new Error("未找到需要更新的扫描记录");
      }
      return this.toRepositoryScan(result.rows[0]);
    } catch (error) {
      throw new Error(
        `${errorMessage}: ${error instanceof Error ? error.message : String(error)}`,
      );
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
