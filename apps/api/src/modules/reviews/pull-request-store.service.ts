import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import {
  PullRequestSchema,
  type PullRequest,
} from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type PullRequestRow = {
  id: string;
  repository_id: string | null;
  provider: string;
  owner: string;
  repo: string;
  pr_number: number;
  title: string;
  author_login: string | null;
  base_branch: string;
  head_branch: string;
  base_sha: string;
  head_sha: string;
  changed_files: number;
  additions: number;
  deletions: number;
  state: PullRequest["state"];
  raw_payload: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class PullRequestStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async upsert(input: {
    repositoryId?: string;
    pullRequest: PullRequest;
  }): Promise<PullRequest> {
    try {
      const result = await this.pool.query<PullRequestRow>(
        `
          insert into pull_requests (
            repository_id,
            provider,
            owner,
            repo,
            pr_number,
            title,
            author_login,
            base_branch,
            head_branch,
            base_sha,
            head_sha,
            changed_files,
            additions,
            deletions,
            state,
            raw_payload
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16::jsonb
          )
          on conflict (provider, owner, repo, pr_number)
          do update set
            repository_id = excluded.repository_id,
            title = excluded.title,
            author_login = excluded.author_login,
            base_branch = excluded.base_branch,
            head_branch = excluded.head_branch,
            base_sha = excluded.base_sha,
            head_sha = excluded.head_sha,
            changed_files = excluded.changed_files,
            additions = excluded.additions,
            deletions = excluded.deletions,
            state = excluded.state,
            raw_payload = excluded.raw_payload,
            updated_at = now()
          returning
            id,
            repository_id,
            provider,
            owner,
            repo,
            pr_number,
            title,
            author_login,
            base_branch,
            head_branch,
            base_sha,
            head_sha,
            changed_files,
            additions,
            deletions,
            state,
            raw_payload,
            created_at,
            updated_at
        `,
        [
          input.repositoryId ?? null,
          input.pullRequest.provider,
          input.pullRequest.owner,
          input.pullRequest.repo,
          input.pullRequest.prNumber,
          input.pullRequest.title,
          input.pullRequest.authorLogin ?? null,
          input.pullRequest.baseBranch,
          input.pullRequest.headBranch,
          input.pullRequest.baseSha,
          input.pullRequest.headSha,
          input.pullRequest.changedFiles,
          input.pullRequest.additions,
          input.pullRequest.deletions,
          input.pullRequest.state,
          JSON.stringify(input.pullRequest.rawPayload ?? {}),
        ],
      );

      return this.toPullRequest(result.rows[0]!);
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "写入 pull_requests 表失败",
        500,
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async findById(pullRequestId: string): Promise<PullRequest | null> {
    try {
      const result = await this.pool.query<PullRequestRow>(
        `
          select
            id,
            repository_id,
            provider,
            owner,
            repo,
            pr_number,
            title,
            author_login,
            base_branch,
            head_branch,
            base_sha,
            head_sha,
            changed_files,
            additions,
            deletions,
            state,
            raw_payload,
            created_at,
            updated_at
          from pull_requests
          where id = $1
        `,
        [pullRequestId],
      );

      if (!result.rowCount || !result.rows[0]) {
        return null;
      }

      return this.toPullRequest(result.rows[0]);
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "查询 pull_requests 表失败",
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

  private toPullRequest(row: PullRequestRow): PullRequest {
    return PullRequestSchema.parse({
      id: row.id,
      repositoryId: row.repository_id ?? undefined,
      provider: row.provider,
      owner: row.owner,
      repo: row.repo,
      prNumber: row.pr_number,
      title: row.title,
      authorLogin: row.author_login ?? undefined,
      baseBranch: row.base_branch,
      headBranch: row.head_branch,
      baseSha: row.base_sha,
      headSha: row.head_sha,
      changedFiles: row.changed_files,
      additions: row.additions,
      deletions: row.deletions,
      state: row.state,
      files: extractFiles(row.raw_payload),
      rawPayload: row.raw_payload ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    });
  }
}

function extractFiles(
  rawPayload: Record<string, unknown> | null,
): PullRequest["files"] {
  const files = rawPayload?.files;
  return Array.isArray(files) ? files : [];
}
