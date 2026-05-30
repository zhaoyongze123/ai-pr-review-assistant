import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SemanticDocumentSchema,
  SemanticSearchResultSchema,
  type SemanticDocument,
  type SemanticDocumentType,
  type SemanticSearchResult,
} from "@ai-pr-review/shared-types";

const DOCUMENT_DIRECTORIES = new Set(["docs", "adr", "design", ".github"]);
const MAX_CHUNK_LENGTH = 1200;
const EMBEDDING_DIMENSION = 1536;

export type SemanticDocumentBuildInput = {
  repositoryId: string;
  scanId: string;
  rootDir: string;
};

export type SemanticSearchInput = {
  query: string;
  documents: SemanticDocument[];
  moduleName?: string;
  documentTypes?: SemanticDocumentType[];
  limit?: number;
};

type ChunkDraft = {
  sourcePath: string;
  documentType: SemanticDocumentType;
  title?: string;
  moduleName?: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

export async function buildSemanticDocuments(
  input: SemanticDocumentBuildInput,
): Promise<SemanticDocument[]> {
  const filePaths = await listSemanticSourceFiles(input.rootDir);
  const documents: SemanticDocument[] = [];

  for (const absolutePath of filePaths) {
    const relativePath = normalizeRelativePath(input.rootDir, absolutePath);
    const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
    if (!content.trim()) {
      continue;
    }

    const chunks = splitDocumentIntoChunks(relativePath, content);
    chunks.forEach((chunk, index) => {
      documents.push(
        SemanticDocumentSchema.parse({
          repositoryId: input.repositoryId,
          scanId: input.scanId,
          sourcePath: chunk.sourcePath,
          documentType: chunk.documentType,
          chunkIndex: index,
          title: chunk.title,
          moduleName: chunk.moduleName,
          content: chunk.content,
          tags: chunk.tags,
          metadata: {
            ...chunk.metadata,
            embedding: createEmbedding(chunk.content),
          },
        }),
      );
    });
  }

  return documents;
}

export function scoreSemanticDocuments(
  input: SemanticSearchInput,
): SemanticSearchResult[] {
  const queryEmbedding = createEmbedding(input.query);
  const queryTokens = tokenize(input.query);
  const filtered = input.documents.filter((document) => {
    if (input.moduleName && document.moduleName !== input.moduleName) {
      return false;
    }
    if (
      input.documentTypes &&
      input.documentTypes.length > 0 &&
      !input.documentTypes.includes(document.documentType)
    ) {
      return false;
    }
    return true;
  });

  return filtered
    .map((document) => {
      const embedding = extractEmbedding(document);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      const lexical = overlapScore(queryTokens, tokenize(document.content));
      const titleBonus = document.title
        ? overlapScore(queryTokens, tokenize(document.title))
        : 0;
      return SemanticSearchResultSchema.parse({
        document,
        score: similarity * 0.65 + lexical * 0.25 + titleBonus * 0.1,
      });
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit ?? 5);
}

async function listSemanticSourceFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const currentDir = queue.shift()!;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === "dist"
        ) {
          continue;
        }
        queue.push(absolutePath);
        continue;
      }

      const relativePath = normalizeRelativePath(rootDir, absolutePath);
      const lower = relativePath.toLowerCase();
      if (
        lower === "readme.md" ||
        lower.endsWith(".md") ||
        lower.endsWith(".mdx")
      ) {
        const topLevel = lower.split("/")[0] ?? "";
        if (
          lower === "readme.md" ||
          DOCUMENT_DIRECTORIES.has(topLevel) ||
          lower.includes("/docs/") ||
          lower.includes("/adr/")
        ) {
          results.push(absolutePath);
        }
      }
    }
  }

  return results.sort();
}

function splitDocumentIntoChunks(
  relativePath: string,
  content: string,
): ChunkDraft[] {
  const lines = content.split(/\r?\n/);
  const sections: Array<{ heading?: string; body: string[] }> = [];
  let current: { heading?: string; body: string[] } = {
    heading: undefined,
    body: [],
  };

  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line) && current.body.length > 0) {
      sections.push(current);
      current = {
        heading: line.replace(/^#{1,4}\s+/, "").trim(),
        body: [],
      };
      continue;
    }
    if (/^#{1,4}\s+/.test(line)) {
      current.heading = line.replace(/^#{1,4}\s+/, "").trim();
      continue;
    }
    current.body.push(line);
  }
  if (current.body.length > 0 || current.heading) {
    sections.push(current);
  }

  const chunks: ChunkDraft[] = [];
  for (const section of sections) {
    const paragraphs = section.body
      .join("\n")
      .split(/\n{2,}/)
      .map((value) => value.trim())
      .filter(Boolean);
    const paragraphGroups = groupParagraphs(paragraphs);
    for (const group of paragraphGroups) {
      chunks.push({
        sourcePath: relativePath,
        documentType: detectDocumentType(relativePath),
        title: section.heading ?? inferTitle(relativePath),
        moduleName: detectModuleName(relativePath),
        content: group,
        tags: detectTags(relativePath, section.heading, group),
        metadata: {
          heading: section.heading,
          charLength: group.length,
          sourceKind: "semantic_document",
        },
      });
    }
  }

  return chunks;
}

function groupParagraphs(paragraphs: string[]): string[] {
  const groups: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > MAX_CHUNK_LENGTH && current) {
      groups.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) {
    groups.push(current);
  }
  return groups;
}

function detectDocumentType(relativePath: string): SemanticDocumentType {
  const lower = relativePath.toLowerCase();
  if (lower === "readme.md") {
    return "readme";
  }
  if (lower.includes("/adr/") || lower.startsWith("adr/")) {
    return "adr";
  }
  if (lower.includes("api")) {
    return "api_doc";
  }
  if (lower.includes("config") || lower.includes("env")) {
    return "config_note";
  }
  return "doc";
}

function detectModuleName(relativePath: string): string | undefined {
  const segments = relativePath.split("/");
  if (segments[0] === "docs" && segments[1]) {
    return segments[1];
  }
  if (segments[0] && segments[0] !== "readme.md") {
    return segments[0];
  }
  return "root";
}

function inferTitle(relativePath: string): string {
  return path.basename(relativePath).replace(/\.(md|mdx)$/i, "");
}

function detectTags(
  relativePath: string,
  heading: string | undefined,
  content: string,
): string[] {
  const text = `${relativePath}\n${heading ?? ""}\n${content}`.toLowerCase();
  const tags = new Set<string>();
  if (/auth|jwt|token|login|oauth/.test(text)) tags.add("auth");
  if (/payment|billing|invoice|refund|checkout/.test(text)) tags.add("payment");
  if (/database|schema|migration|postgres|mysql|sqlite/.test(text))
    tags.add("database");
  if (/cache|redis/.test(text)) tags.add("cache");
  if (/feature flag|toggle|experiment/.test(text)) tags.add("feature_flag");
  return Array.from(tags);
}

function normalizeRelativePath(rootDir: string, absolutePath: string) {
  return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 2);
}

function overlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const rightSet = new Set(right);
  let hits = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      hits += 1;
    }
  }
  return hits / Math.max(left.length, 1);
}

function extractEmbedding(document: SemanticDocument): number[] {
  const raw = document.metadata?.embedding;
  if (Array.isArray(raw)) {
    return raw.map((value) => Number(value));
  }
  return createEmbedding(document.content);
}

function createEmbedding(text: string): number[] {
  const embedding = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    const index = hashToken(token) % EMBEDDING_DIMENSION;
    embedding[index] += 1;
  }
  const norm = Math.sqrt(
    embedding.reduce((sum, value) => sum + value * value, 0),
  );
  if (norm === 0) {
    return embedding;
  }
  return embedding.map((value) => Number((value / norm).toFixed(6)));
}

function hashToken(token: string): number {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = (hash * 31 + token.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
