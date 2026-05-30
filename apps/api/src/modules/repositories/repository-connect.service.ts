import { Inject, Injectable } from "@nestjs/common";
import {
  RepositoryConnectResponseSchema,
  type RepositoryConnectRequest,
  type RepositoryConnectResponse,
} from "@ai-pr-review/shared-types";
import { GitHubClientService } from "./github-client.service.js";
import { RepositoryStoreService } from "./repository-store.service.js";

@Injectable()
export class RepositoryConnectService {
  constructor(
    @Inject(GitHubClientService)
    private readonly githubClientService: GitHubClientService,
    @Inject(RepositoryStoreService)
    private readonly repositoryStoreService: RepositoryStoreService,
  ) {}

  async connect(
    request: RepositoryConnectRequest,
  ): Promise<RepositoryConnectResponse> {
    const githubRepository = await this.githubClientService.getRepository({
      provider: request.provider,
      owner: request.owner,
      repo: request.repo,
    });

    const repository = await this.repositoryStoreService.upsert({
      provider: request.provider,
      owner: request.owner,
      repo: request.repo,
      // M1 以 GitHub 真源返回的默认分支为准，避免请求提示值污染仓库事实。
      defaultBranch: githubRepository.defaultBranch,
      cloneUrl: githubRepository.cloneUrl,
      isActive: true,
    });

    return RepositoryConnectResponseSchema.parse({
      repository,
      accepted: true,
    });
  }
}
