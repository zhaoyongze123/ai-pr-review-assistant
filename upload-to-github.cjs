const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const repoOwner = 'zhaoyongze123';
const repoName = 'ai-pr-review-assistant';
const branchName = 'feature/M5-M6-M7基础版';
const root = process.cwd();

function getToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  const output = cp.execFileSync('git', ['credential', 'fill'], {
    input,
    encoding: 'utf8',
  });
  const line = output.split(/\r?\n/).find((item) => item.startsWith('password='));
  if (!line) throw new Error('GitHub credential token not found');
  return line.slice('password='.length);
}

const token = getToken();
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'codex-local-uploader',
  'X-GitHub-Api-Version': '2022-11-28',
};

async function github(method, apiPath, body) {
  const response = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(`${method} ${apiPath} failed: ${response.status} ${text}`);
  }
  return payload;
}

function listFiles(dir) {
  const entries = [];
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, name.name);
    const relPath = path.relative(root, fullPath).replaceAll('\\', '/');
    if (
      relPath === '.git' ||
      relPath === 'node_modules' ||
      relPath === 'dist' ||
      relPath.endsWith('/__pycache__') ||
      relPath.includes('/node_modules/') ||
      relPath.includes('/.git/') ||
      relPath.includes('/dist/') ||
      relPath.includes('/__pycache__/')
    ) {
      continue;
    }
    if (name.isDirectory()) {
      entries.push(...listFiles(fullPath));
    } else if (name.isFile()) {
      entries.push(relPath);
    }
  }
  return entries;
}

(async () => {
  const mainRef = await github('GET', '/git/ref/heads/main');
  const baseSha = mainRef.object.sha;
  const files = listFiles(root).sort();
  const tree = files.map((filePath) => ({
    path: filePath,
    mode: '100644',
    type: 'blob',
    content: fs.readFileSync(path.join(root, filePath), 'utf8'),
  }));

  const createdTree = await github('POST', '/git/trees', { tree });
  const commit = await github('POST', '/git/commits', {
    message: 'feat: 完成 M5 M6 M7 基础版',
    tree: createdTree.sha,
    parents: [baseSha],
  });

  const refBody = { ref: `refs/heads/${branchName}`, sha: commit.sha };
  try {
    await github('POST', '/git/refs', refBody);
  } catch (error) {
    if (!String(error.message).includes('422')) throw error;
    const encodedRef = encodeURIComponent(`heads/${branchName}`);
    await github('PATCH', `/git/refs/${encodedRef}`, { sha: commit.sha, force: true });
  }

  console.log(JSON.stringify({ branchName, commitSha: commit.sha, fileCount: files.length }, null, 2));
})();
