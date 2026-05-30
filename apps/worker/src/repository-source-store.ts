import { Pool } from "pg";
import { RepositorySchema, type Repository } from "@ai-pr-review/shared-types";

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

export class RepositorySourceStore {
  constructor(private readonly pool: Pool) {}

  async findById(repositoryId: string): Promise<Repository | null> {
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

    if (!result.rowCount || !result.rows[0]) {
      return null;
    }

    return RepositorySchema.parse({
      id: result.rows[0].id,
      provider: result.rows[0].provider,
      owner: result.rows[0].owner,
      repo: result.rows[0].repo,
      defaultBranch: result.rows[0].default_branch,
      cloneUrl: result.rows[0].clone_url,
      isActive: result.rows[0].is_active,
      createdAt: result.rows[0].created_at.toISOString(),
      updatedAt: result.rows[0].updated_at.toISOString(),
    });
  }
}
