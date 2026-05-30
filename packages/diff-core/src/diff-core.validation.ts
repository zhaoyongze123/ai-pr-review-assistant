import assert from "node:assert/strict";
import { parsePullRequestDiff, resolveDiffLineRef } from "./index.js";

const [result] = parsePullRequestDiff([
  {
    filePath: "src/auth.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    language: "TypeScript",
    patch: [
      "@@ -10,3 +10,4 @@ export function login() {",
      " const user = findUser();",
      "-return user.token;",
      "+if (!user) throw new Error('missing user');",
      "+return user.sessionToken;",
      "}",
    ].join("\n"),
  },
]);

assert.equal(result.filePath, "src/auth.ts");
assert.equal(result.hunks.length, 1);
assert.equal(result.totalAddedLines, 2);
assert.equal(result.totalRemovedLines, 1);

const addedLine = result.hunks[0]?.lines.find((line) =>
  line.content.includes("sessionToken"),
);
assert.ok(addedLine);
assert.equal(addedLine.ref, "src/auth.ts#H1:L12+");

const resolved = resolveDiffLineRef(result, addedLine.ref);
assert.deepEqual(resolved, {
  hunkId: "src/auth.ts#H1",
  lineType: "add",
  newLineNumber: 12,
});

const [binaryLike] = parsePullRequestDiff([
  {
    filePath: "assets/logo.png",
    status: "modified",
    additions: 0,
    deletions: 0,
  },
]);
assert.deepEqual(binaryLike.hunks, []);
assert.deepEqual(binaryLike.lineRefMap, {});
