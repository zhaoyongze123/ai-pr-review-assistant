import {
  type DiffLine,
  type DiffLineRefMapEntry,
  DiffParseResultSchema,
  type DiffParseResult,
  type PullRequestFile,
} from "@ai-pr-review/shared-types";

const HUNK_HEADER_PATTERN =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldLines>\d+))? \+(?<newStart>\d+)(?:,(?<newLines>\d+))? @@/;

type MutableHunk = DiffParseResult["hunks"][number];

export function parsePullRequestDiff(
  files: PullRequestFile[],
): DiffParseResult[] {
  return files.map((file) => parseUnifiedDiffPatch(file));
}

export function parseUnifiedDiffPatch(file: PullRequestFile): DiffParseResult {
  if (!file.patch) {
    return DiffParseResultSchema.parse({
      filePath: file.filePath,
      language: file.language,
      hunks: [],
      lineRefMap: {},
      totalAddedLines: 0,
      totalRemovedLines: 0,
    });
  }

  const hunks: MutableHunk[] = [];
  const lineRefMap: Record<string, DiffLineRefMapEntry> = {};
  let currentHunk: MutableHunk | undefined;
  let oldLineNumber = 0;
  let newLineNumber = 0;
  let totalAddedLines = 0;
  let totalRemovedLines = 0;

  for (const rawLine of file.patch.split(/\r?\n/)) {
    const headerMatch = HUNK_HEADER_PATTERN.exec(rawLine);
    if (headerMatch?.groups) {
      const hunkIndex = hunks.length + 1;
      oldLineNumber = Number(headerMatch.groups.oldStart);
      newLineNumber = Number(headerMatch.groups.newStart);
      currentHunk = {
        hunkId: `${file.filePath}#H${hunkIndex}`,
        header: rawLine,
        oldStart: oldLineNumber,
        oldLines: Number(headerMatch.groups.oldLines ?? 1),
        newStart: newLineNumber,
        newLines: Number(headerMatch.groups.newLines ?? 1),
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || rawLine.startsWith("\\ No newline")) {
      continue;
    }

    const marker = rawLine[0];
    const content = rawLine.slice(1);

    if (marker === "+") {
      const ref = buildDiffLineRef(
        file.filePath,
        hunks.length,
        newLineNumber,
        "+",
      );
      const line: DiffLine = {
        ref,
        lineType: "add",
        newLineNumber,
        content,
      };
      currentHunk.lines.push(line);
      lineRefMap[ref] = {
        hunkId: currentHunk.hunkId,
        lineType: "add",
        newLineNumber,
      };
      newLineNumber += 1;
      totalAddedLines += 1;
      continue;
    }

    if (marker === "-") {
      const ref = buildDiffLineRef(
        file.filePath,
        hunks.length,
        oldLineNumber,
        "-",
      );
      const line: DiffLine = {
        ref,
        lineType: "remove",
        oldLineNumber,
        content,
      };
      currentHunk.lines.push(line);
      lineRefMap[ref] = {
        hunkId: currentHunk.hunkId,
        lineType: "remove",
        oldLineNumber,
      };
      oldLineNumber += 1;
      totalRemovedLines += 1;
      continue;
    }

    const ref = buildDiffLineRef(
      file.filePath,
      hunks.length,
      newLineNumber,
      "",
    );
    const line: DiffLine = {
      ref,
      lineType: "context",
      oldLineNumber,
      newLineNumber,
      content: marker === " " ? content : rawLine,
    };
    currentHunk.lines.push(line);
    lineRefMap[ref] = {
      hunkId: currentHunk.hunkId,
      lineType: "context",
      oldLineNumber,
      newLineNumber,
    };
    oldLineNumber += 1;
    newLineNumber += 1;
  }

  return DiffParseResultSchema.parse({
    filePath: file.filePath,
    language: file.language,
    hunks,
    lineRefMap,
    totalAddedLines,
    totalRemovedLines,
  });
}

export function resolveDiffLineRef(
  result: DiffParseResult,
  ref: string,
): DiffLineRefMapEntry | undefined {
  return DiffParseResultSchema.parse(result).lineRefMap[ref];
}

function buildDiffLineRef(
  filePath: string,
  hunkIndex: number,
  lineNumber: number,
  marker: "+" | "-" | "",
): string {
  return `${filePath}#H${hunkIndex}:L${lineNumber}${marker}`;
}
