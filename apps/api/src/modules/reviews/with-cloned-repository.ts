import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function withClonedRepository<T>(options: {
  cloneUrl: string;
  ref: string;
  authToken?: string;
  callback: (rootDir: string) => Promise<T>;
}): Promise<T> {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "ai-pr-review-first-pass-"),
  );

  try {
    const cloneUrl = injectGitHubToken(options.cloneUrl, options.authToken);
    await execFileAsync("git", ["clone", "--depth", "1", cloneUrl, tempRoot]);
    await execFileAsync("git", [
      "-C",
      tempRoot,
      "fetch",
      "--depth",
      "1",
      "origin",
      options.ref,
    ]);
    await execFileAsync("git", ["-C", tempRoot, "checkout", "FETCH_HEAD"]);
    return await options.callback(tempRoot);
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }
}

function injectGitHubToken(cloneUrl: string, authToken?: string): string {
  if (!authToken || !cloneUrl.startsWith("https://")) {
    return cloneUrl;
  }

  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = authToken;
  return url.toString();
}
