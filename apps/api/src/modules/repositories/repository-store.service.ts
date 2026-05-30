import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import type { Repository } from "@ai-pr-review/shared-types";
import { Pool } from "pg";
import { RepositorySchema } from "@ai-pr-review/shared-types";
import { ApiConfigService } from "./api-config.service.js";
import { ApiModuleError } from "./api-error.js";

type RepositoryRow = {
  id: string;
  provider: string;
  owner: string;
  repo: string;
  default_branch: string;
  clone_url: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class RepositoryStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async upsert(repository: Repository): Promise<Repository> {
    try {
      const result = await this.pool.query<RepositoryRow>(
        `
          insert into repositories (
            provider,
            owner,
            repo,
            default_branch,
            clone_url,
            is_active
          )
          values ($1, $2, $3, $4, $5, $6)
          on conflict (provider, owner, repo)
          do update set
            default_branch = excluded.default_branch,
            clone_url = excluded.clone_url,
            is_active = excluded.is_active,
            updated_at = now()
          returning
            id,
            provider,
            owner,
            repo,
            default_branch,
            clone_url,
            is_active,
            created_at,
            updated_at
        `,
        [
          repository.provider,
          repository.owner,
          repository.repo,
          repository.defaultBranch,
          repository.cloneUrl,
          repository.isActive,
        ],
      );

      return RepositorySchema.parse({
        id: result.rows[0]?.id,
        provider: result.rows[0]?.provider,
        owner: result.rows[0]?.owner,
        repo: result.rows[0]?.repo,
        defaultBranch: result.rows[0]?.default_branch,
        cloneUrl: result.rows[0]?.clone_url,
        isActive: result.rows[0]?.is_active,
        createdAt: result.rows[0]?.created_at?.toISOString(),
        updatedAt: result.rows[0]?.updated_at?.toISOString(),
      });
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "写入 repositories 表失败",
        500,
        {
          message: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async findById(repositoryId: string): Promise<Repository | null> {
    try {
      const result = await this.pool.query<RepositoryRow>(
        `
          select
            id,
            provider,
            owner,
            repo,
            default_branch,
            clone_url,
            is_active,
            created_at,
            updated_at
          from repositories
          where id = $1
        `,
        [repositoryId],
      );

      if (!result.rowCount) {
        return null;
      }

      return RepositorySchema.parse({
        id: result.rows[0]?.id,
        provider: result.rows[0]?.provider,
        owner: result.rows[0]?.owner,
        repo: result.rows[0]?.repo,
        defaultBranch: result.rows[0]?.default_branch,
        cloneUrl: result.rows[0]?.clone_url,
        isActive: result.rows[0]?.is_active,
        createdAt: result.rows[0]?.created_at?.toISOString(),
        updatedAt: result.rows[0]?.updated_at?.toISOString(),
      });
    } catch (error) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "查询 repositories 表失败",
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
}
