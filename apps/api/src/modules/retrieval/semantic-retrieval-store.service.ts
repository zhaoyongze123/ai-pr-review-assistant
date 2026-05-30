import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import {
  SemanticDocumentSchema,
  type SemanticDocument,
  type SemanticDocumentType,
} from "@ai-pr-review/shared-types";
import { scoreSemanticDocuments } from "@ai-pr-review/retrieval-core";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type SemanticDocumentRow = {
  id: string;
  repository_id: string;
  scan_id: string;
  source_path: string;
  document_type: SemanticDocumentType;
  chunk_index: number;
  title: string | null;
  module_name: string | null;
  content: string;
  tags: string[];
  metadata: Record<string, unknown> | null;
};

@Injectable()
export class SemanticRetrievalStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async search(input: {
    repositoryId: string;
    query: string;
    moduleName?: string;
    documentTypes?: SemanticDocumentType[];
    limit: number;
  }) {
    try {
      const result = await this.pool.query<SemanticDocumentRow>(
        `
          select
            id,
            repository_id,
            scan_id,
            source_path,
            document_type,
            chunk_index,
            title,
            module_name,
            content,
            tags,
            metadata
          from semantic_documents
          where repository_id = $1
            and scan_id = (
              select id
              from repository_scans
              where repository_id = $1
                and status = 'done'
              order by finished_at desc nulls last, created_at desc
              limit 1
            )
        `,
        [input.repositoryId],
      );

      const documents = result.rows.map((row) =>
        SemanticDocumentSchema.parse({
          id: row.id,
          repositoryId: row.repository_id,
          scanId: row.scan_id,
          sourcePath: row.source_path,
          documentType: row.document_type,
          chunkIndex: row.chunk_index,
          title: row.title ?? undefined,
          moduleName: row.module_name ?? undefined,
          content: row.content,
          tags: row.tags ?? [],
          metadata: row.metadata ?? {},
        }),
      );

      return scoreSemanticDocuments({
        query: input.query,
        documents,
        moduleName: input.moduleName,
        documentTypes: input.documentTypes,
        limit: input.limit,
      });
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", "查询语义语料失败", 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
