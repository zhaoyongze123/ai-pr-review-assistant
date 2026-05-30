import { Pool, type PoolClient } from "pg";
import {
  RepositoryFileSchema,
  SymbolEdgeSchema,
  SymbolSchema,
  type RepositoryFile,
  type Symbol,
  type SymbolEdge,
} from "@ai-pr-review/shared-types";

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
  created_at: Date;
  updated_at: Date;
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

export class RepositoryIndexStore {
  constructor(private readonly pool: Pool) {}

  async replaceForScan(
    repositoryId: string,
    scanId: string,
    payload: {
      files: RepositoryFile[];
      symbols: Symbol[];
      edges: SymbolEdge[];
    },
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from repository_files where scan_id = $1`, [
        scanId,
      ]);
      await client.query(`delete from symbols where scan_id = $1`, [scanId]);
      await client.query(`delete from symbol_edges where scan_id = $1`, [
        scanId,
      ]);

      for (const file of payload.files) {
        await client.query(
          `
            insert into repository_files (
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
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb)
          `,
          [
            repositoryId,
            scanId,
            file.filePath,
            file.language,
            file.kind,
            file.moduleName ?? null,
            file.summary ?? null,
            JSON.stringify(file.riskTags ?? []),
            file.checksum ?? null,
            JSON.stringify(file.metadata ?? {}),
          ],
        );
      }

      for (const symbol of payload.symbols) {
        await client.query(
          `
            insert into symbols (
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
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)
          `,
          [
            repositoryId,
            scanId,
            symbol.filePath,
            symbol.symbolName,
            symbol.qualifiedName,
            symbol.kind,
            symbol.startLine,
            symbol.endLine,
            symbol.signature ?? null,
            symbol.moduleName ?? null,
            JSON.stringify(symbol.riskTags ?? []),
            JSON.stringify(symbol.metadata ?? {}),
          ],
        );
      }

      for (const edge of payload.edges) {
        await client.query(
          `
            insert into symbol_edges (
              repository_id,
              scan_id,
              from_qualified_name,
              to_qualified_name,
              edge_type,
              metadata
            )
            values ($1, $2, $3, $4, $5, $6::jsonb)
          `,
          [
            repositoryId,
            scanId,
            edge.fromQualifiedName,
            edge.toQualifiedName,
            edge.edgeType,
            JSON.stringify(edge.metadata ?? {}),
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(
        `写入结构化索引失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  async findSymbolDefinition(
    repositoryId: string,
    symbolName: string,
  ): Promise<Symbol | null> {
    const result = await this.pool.query<SymbolRow>(
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
          metadata,
          created_at,
          updated_at
        from symbols
        where repository_id = $1
          and (symbol_name = $2 or qualified_name = $2)
        order by updated_at desc
        limit 1
      `,
      [repositoryId, symbolName],
    );

    return result.rows[0] ? toSymbol(result.rows[0]) : null;
  }

  async findCallers(
    repositoryId: string,
    qualifiedName: string,
  ): Promise<SymbolEdge[]> {
    return this.findEdges(repositoryId, "to_qualified_name", qualifiedName);
  }

  async findCallees(
    repositoryId: string,
    qualifiedName: string,
  ): Promise<SymbolEdge[]> {
    return this.findEdges(repositoryId, "from_qualified_name", qualifiedName);
  }

  private async findEdges(
    repositoryId: string,
    column: "from_qualified_name" | "to_qualified_name",
    qualifiedName: string,
  ): Promise<SymbolEdge[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<SymbolEdgeRow>(
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
            and edge_type = 'calls'
            and ${column} = $2
          order by id asc
        `,
        [repositoryId, qualifiedName],
      );

      return result.rows.map((row) =>
        SymbolEdgeSchema.parse({
          id: row.id,
          repositoryId: row.repository_id,
          scanId: row.scan_id,
          fromQualifiedName: row.from_qualified_name,
          toQualifiedName: row.to_qualified_name,
          edgeType: row.edge_type,
          metadata: row.metadata ?? {},
        }),
      );
    } finally {
      client.release();
    }
  }
}

function toSymbol(row: SymbolRow): Symbol {
  return SymbolSchema.parse({
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
  });
}
