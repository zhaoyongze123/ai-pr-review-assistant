import { Inject, Injectable } from "@nestjs/common";
import {
  RepositorySemanticMapSchema,
  type RepositorySemanticMap,
} from "@ai-pr-review/shared-types";
import { RepositoryContextStoreService } from "../context/repository-context-store.service.js";
import { SemanticRetrievalStoreService } from "../retrieval/semantic-retrieval-store.service.js";
import { RepositoryScanStoreService } from "../scans/repository-scan-store.service.js";
import { ApiModuleError } from "./api-error.js";
import { RepositoryStoreService } from "./repository-store.service.js";

@Injectable()
export class RepositorySemanticMapService {
  constructor(
    @Inject(RepositoryContextStoreService)
    private readonly repositoryContextStoreService: RepositoryContextStoreService,
    @Inject(RepositoryStoreService)
    private readonly repositoryStoreService: RepositoryStoreService,
    @Inject(RepositoryScanStoreService)
    private readonly repositoryScanStoreService: RepositoryScanStoreService,
    @Inject(SemanticRetrievalStoreService)
    private readonly semanticRetrievalStoreService: SemanticRetrievalStoreService,
  ) {}

  async getMap(repositoryId: string): Promise<RepositorySemanticMap> {
    const repository = await this.repositoryStoreService.findById(repositoryId);
    if (!repository) {
      throw new ApiModuleError("REPOSITORY_NOT_FOUND", "指定仓库不存在", 404);
    }

    const latestScan =
      await this.repositoryScanStoreService.findLatestDoneByRepositoryId(
        repositoryId,
      );
    if (!latestScan) {
      throw new ApiModuleError(
        "SCAN_NOT_FOUND",
        "该仓库还没有可用的语义地图扫描结果",
        404,
      );
    }

    const [snapshot, semanticDocuments] = await Promise.all([
      this.repositoryContextStoreService.loadLatestSnapshot(repositoryId),
      this.semanticRetrievalStoreService.listLatestDocuments(repositoryId),
    ]);

    return RepositorySemanticMapSchema.parse({
      repository,
      latestScan,
      files: snapshot.files,
      symbols: snapshot.symbols,
      edges: snapshot.edges,
      semanticDocuments,
    });
  }
}
