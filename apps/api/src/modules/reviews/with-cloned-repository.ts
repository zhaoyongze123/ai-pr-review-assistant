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
  const repositoryPath = path.join(tempRoot, "repo");

  try {
    await cloneRepository({
      targetDir: repositoryPath,
      cloneUrl: options.cloneUrl,
      authToken: options.authToken,
    });
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "fetch",
      "--depth",
      "1",
      "origin",
      options.ref,
    ]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "checkout",
      "FETCH_HEAD",
    ]);
    return await options.callback(repositoryPath);
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }
}

async function cloneRepository(options: {
  targetDir: string;
  cloneUrl: string;
  authToken?: string;
}) {
  const attempts = buildCloneAttempts(options.cloneUrl, options.authToken);
  const failures: string[] = [];

  for (const attempt of attempts) {
    await rm(options.targetDir, {
      recursive: true,
      force: true,
    });

    try {
      await execFileAsync("git", [
        "clone",
        "--depth",
        "1",
        attempt.cloneUrl,
        options.targetDir,
      ]);
      return;
    } catch (error) {
      failures.push(
        `${attempt.label}失败：${formatCloneError(error, options.authToken)}`,
      );
    }
  }

  throw new Error(`仓库克隆失败。${failures.join("；")}`);
}

function buildCloneAttempts(cloneUrl: string, authToken?: string) {
  const attempts: Array<{ label: string; cloneUrl: string }> = [];
  const authenticatedCloneUrl = injectGitHubToken(cloneUrl, authToken);

  if (authenticatedCloneUrl !== cloneUrl) {
    attempts.push({
      label: "认证地址克隆",
      cloneUrl: authenticatedCloneUrl,
    });
  }

  attempts.push({
    label: "公开地址克隆",
    cloneUrl,
  });

  return attempts;
}

function injectGitHubToken(cloneUrl: string, authToken?: string) {
  if (!authToken || !cloneUrl.startsWith("https://")) {
    return cloneUrl;
  }

  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = authToken;
  return url.toString();
}

function formatCloneError(error: unknown, authToken?: string) {
  const message =
    error instanceof Error ? error.message : "未知 git clone 错误";

  return sanitizeSensitiveText(message, authToken);
}

function sanitizeSensitiveText(text: string, authToken?: string) {
  let sanitized = text;

  if (authToken) {
    sanitized = sanitized.split(authToken).join("[REDACTED_GITHUB_TOKEN]");
  }

  return sanitized
    .replace(
      /(https?:\/\/)([^/\s:@]+):([^@\s]+)@/g,
      "$1$2:[REDACTED_GITHUB_TOKEN]@",
    )
    .replace(/\bgh[opus]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]");
}
