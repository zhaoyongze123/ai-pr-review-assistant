import { Inject, Injectable } from "@nestjs/common";
import {
  SemanticSearchResponseSchema,
  type SemanticSearchRequest,
  type SemanticSearchResponse,
} from "@ai-pr-review/shared-types";
import { RepositoryStoreService } from "../repositories/repository-store.service.js";
import { ApiModuleError } from "../repositories/api-error.js";
import { SemanticRetrievalStoreService } from "./semantic-retrieval-store.service.js";

@Injectable()
export class SemanticRetrievalService {
  constructor(
    @Inject(RepositoryStoreService)
    private readonly repositoryStoreService: RepositoryStoreService,
    @Inject(SemanticRetrievalStoreService)
    private readonly semanticRetrievalStoreService: SemanticRetrievalStoreService,
  ) {}

  async search(
    repositoryId: string,
    request: SemanticSearchRequest,
  ): Promise<SemanticSearchResponse> {
    const repository = await this.repositoryStoreService.findById(repositoryId);
    if (!repository) {
      throw new ApiModuleError("REPOSITORY_NOT_FOUND", "目标仓库不存在", 404, {
        repositoryId,
      });
    }

    const results = await this.semanticRetrievalStoreService.search({
      repositoryId,
      query: request.query,
      moduleName: request.moduleName,
      documentTypes: request.documentTypes,
      limit: request.limit,
    });

    return SemanticSearchResponseSchema.parse({
      repositoryId,
      query: request.query,
      results,
    });
  }
}
