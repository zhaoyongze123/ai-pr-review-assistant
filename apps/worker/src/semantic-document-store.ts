import { Pool } from "pg";
import {
  SemanticDocumentSchema,
  type SemanticDocument,
} from "@ai-pr-review/shared-types";

function toVectorLiteral(values: number[]) {
  return `[${values.map((value) => Number(value).toFixed(6)).join(",")}]`;
}

export class SemanticDocumentStore {
  constructor(private readonly pool: Pool) {}

  async replaceForScan(
    repositoryId: string,
    scanId: string,
    documents: SemanticDocument[],
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from semantic_documents where scan_id = $1`, [
        scanId,
      ]);

      for (const document of documents) {
        const embedding = Array.isArray(document.metadata?.embedding)
          ? document.metadata.embedding.map((value) => Number(value))
          : null;
        const metadata = {
          ...(document.metadata ?? {}),
        };
        delete metadata.embedding;

        await client.query(
          `
            insert into semantic_documents (
              repository_id,
              scan_id,
              source_path,
              document_type,
              chunk_index,
              title,
              module_name,
              content,
              tags,
              metadata,
              embedding
            )
            values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::vector
            )
          `,
          [
            repositoryId,
            scanId,
            document.sourcePath,
            document.documentType,
            document.chunkIndex,
            document.title ?? null,
            document.moduleName ?? null,
            document.content,
            JSON.stringify(document.tags ?? []),
            JSON.stringify(metadata),
            embedding ? toVectorLiteral(embedding) : null,
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw new Error(
        `写入语义语料失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      client.release();
    }
  }

  async countByScan(scanId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `select count(*)::text as count from semantic_documents where scan_id = $1`,
      [scanId],
    );
    return Number(result.rows[0]?.count ?? "0");
  }
}
