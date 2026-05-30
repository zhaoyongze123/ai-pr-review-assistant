import { Inject, Injectable } from "@nestjs/common";
import type { RepositoryRef } from "@ai-pr-review/shared-types";
import { ApiConfigService } from "./api-config.service.js";
import { ApiModuleError } from "./api-error.js";

type GitHubRepositoryPayload = {
  default_branch: string;
  clone_url: string;
  private: boolean;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
};

export type GitHubRepositoryInfo = {
  defaultBranch: string;
  cloneUrl: string;
  isPrivate: boolean;
  canRead: boolean;
};

@Injectable()
export class GitHubClientService {
  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {}

  async getRepository(
    repository: RepositoryRef,
  ): Promise<GitHubRepositoryInfo> {
    const response = await fetch(
      `https://api.github.com/repos/${repository.owner}/${repository.repo}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.configService.githubToken}`,
          "User-Agent": "ai-pr-review-assistant",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );

    if (response.status === 401) {
      throw new ApiModuleError(
        "GITHUB_UNAUTHORIZED",
        "GitHub 认证失败，请检查 GITHUB_TOKEN",
        401,
      );
    }

    if (response.status === 404) {
      throw new ApiModuleError(
        "REPOSITORY_NOT_FOUND",
        "目标仓库不存在，或当前 token 无法看到该仓库",
        404,
        repository,
      );
    }

    if (response.status === 403) {
      throw new ApiModuleError(
        "REPOSITORY_FORBIDDEN",
        "当前 token 没有访问该仓库的权限",
        403,
        repository,
      );
    }

    if (!response.ok) {
      throw new ApiModuleError(
        "INTERNAL_ERROR",
        `GitHub API 请求失败，状态码 ${response.status}`,
        502,
      );
    }

    const payload = (await response.json()) as GitHubRepositoryPayload;
    const canRead = payload.permissions?.pull ?? true;

    if (!canRead) {
      throw new ApiModuleError(
        "REPOSITORY_FORBIDDEN",
        "当前 token 缺少该仓库的读取权限",
        403,
        repository,
      );
    }

    return {
      defaultBranch: payload.default_branch,
      cloneUrl: payload.clone_url,
      isPrivate: payload.private,
      canRead,
    };
  }
}
