import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import {
  RepositoryFileSchema,
  SymbolEdgeSchema,
  SymbolSchema,
  type RepositoryFile,
  type Symbol,
  type SymbolEdge,
} from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

type RepositoryFileRow = {
  id: string;
  repository_id: string;
  scan_id: string;
  file_path: string;
  language: string;
  kind: RepositoryFile["kind"];
  module_name: string | null;
  summary: string | null;
  risk_tags: string[];
  checksum: string | null;
  metadata: Record<string, unknown> | null;
};

type SymbolRow = {
  id: string;
  repository_id: string;
  scan_id: string;
  file_path: string;
  symbol_name: string;
  qualified_name: string;
  kind: Symbol["kind"];
  start_line: number;
  end_line: number;
  signature: string | null;
  module_name: string | null;
  risk_tags: string[];
  metadata: Record<string, unknown> | null;
};

type SymbolEdgeRow = {
  id: string;
  repository_id: string;
  scan_id: string;
  from_qualified_name: string;
  to_qualified_name: string;
  edge_type: SymbolEdge["edgeType"];
  metadata: Record<string, unknown> | null;
};

export type RepositoryContextSnapshot = {
  files: RepositoryFile[];
  symbols: Symbol[];
  edges: SymbolEdge[];
};

@Injectable()
export class RepositoryContextStoreService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {
    this.pool = new Pool({
      connectionString: this.configService.databaseUrl,
    });
  }

  async loadLatestSnapshot(
    repositoryId: string,
  ): Promise<RepositoryContextSnapshot> {
    try {
      const latestScanId = await this.findLatestDoneScanId(repositoryId);
      if (!latestScanId) {
        return {
          files: [],
          symbols: [],
          edges: [],
        };
      }

      const [filesResult, symbolsResult, edgesResult] = await Promise.all([
        this.pool.query<RepositoryFileRow>(
          `
            select
              id,
              repository_id,
              scan_id,
              file_path,
              language,
              kind,
              module_name,
              summary,
              risk_tags,
              checksum,
              metadata
            from repository_files
            where repository_id = $1
              and scan_id = $2
            order by file_path asc
          `,
          [repositoryId, latestScanId],
        ),
        this.pool.query<SymbolRow>(
          `
            select
              id,
              repository_id,
              scan_id,
              file_path,
              symbol_name,
              qualified_name,
              kind,
              start_line,
              end_line,
              signature,
              module_name,
              risk_tags,
              metadata
            from symbols
            where repository_id = $1
              and scan_id = $2
            order by file_path asc, start_line asc
          `,
          [repositoryId, latestScanId],
        ),
        this.pool.query<SymbolEdgeRow>(
          `
            select
              id,
              repository_id,
              scan_id,
              from_qualified_name,
              to_qualified_name,
              edge_type,
              metadata
            from symbol_edges
            where repository_id = $1
              and scan_id = $2
            order by id asc
          `,
          [repositoryId, latestScanId],
        ),
      ]);

      return {
        files: filesResult.rows.map((row) =>
          RepositoryFileSchema.parse({
            id: row.id,
            repositoryId: row.repository_id,
            scanId: row.scan_id,
            filePath: row.file_path,
            language: row.language,
            kind: row.kind,
            moduleName: row.module_name ?? undefined,
            summary: row.summary ?? undefined,
            riskTags: row.risk_tags ?? [],
            checksum: row.checksum ?? undefined,
            metadata: row.metadata ?? {},
          }),
        ),
        symbols: symbolsResult.rows.map((row) =>
          SymbolSchema.parse({
            id: row.id,
            repositoryId: row.repository_id,
            scanId: row.scan_id,
            filePath: row.file_path,
            symbolName: row.symbol_name,
            qualifiedName: row.qualified_name,
            kind: row.kind,
            startLine: row.start_line,
            endLine: row.end_line,
            signature: row.signature ?? undefined,
            moduleName: row.module_name ?? undefined,
            riskTags: row.risk_tags ?? [],
            metadata: row.metadata ?? {},
          }),
        ),
        edges: edgesResult.rows.map((row) =>
          SymbolEdgeSchema.parse({
            id: row.id,
            repositoryId: row.repository_id,
            scanId: row.scan_id,
            fromQualifiedName: row.from_qualified_name,
            toQualifiedName: row.to_qualified_name,
            edgeType: row.edge_type,
            metadata: row.metadata ?? {},
          }),
        ),
      };
    } catch (error) {
      throw new ApiModuleError("DATABASE_ERROR", "读取结构化上下文快照失败", 500, {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async findLatestDoneScanId(
    repositoryId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ id: string }>(
      `
        select id
        from repository_scans
        where repository_id = $1
          and status = 'done'
        order by finished_at desc nulls last, created_at desc
        limit 1
      `,
      [repositoryId],
    );

    return result.rows[0]?.id ?? null;
  }
}
