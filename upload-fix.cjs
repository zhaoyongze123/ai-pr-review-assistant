const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

const repoOwner = 'zhaoyongze123';
const repoName = 'ai-pr-review-assistant';
const branchName = 'fix/恢复M2并完善M5-M7';
const baseSha = '0e7d8e9e74dc72a5fc43a4eb7a6dd840a8a1070e';
const root = process.cwd();

function getToken() {
  const output = cp.execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
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
  if (!response.ok) throw new Error(`${method} ${apiPath} failed: ${response.status} ${text}`);
  return payload;
}

function listFiles(dir) {
  const entries = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(root, fullPath).replaceAll('\\', '/');
    if (
      relPath === '.git' ||
      relPath === 'node_modules' ||
      relPath === 'dist' ||
      relPath.startsWith('.git/') ||
      relPath.startsWith('node_modules/') ||
      relPath.includes('/dist/') ||
      relPath.includes('/__pycache__/') ||
      relPath.endsWith('/__pycache__')
    ) continue;
    if (item.isDirectory()) entries.push(...listFiles(fullPath));
    if (item.isFile()) entries.push(relPath);
  }
  return entries;
}

(async () => {
  const files = listFiles(root).sort();
  const tree = files.map((filePath) => ({
    path: filePath,
    mode: '100644',
    type: 'blob',
    content: fs.readFileSync(path.join(root, filePath), 'utf8'),
  }));
  const createdTree = await github('POST', '/git/trees', {
    base_tree: (await github('GET', `/git/commits/${baseSha}`)).tree.sha,
    tree,
  });
  const commit = await github('POST', '/git/commits', {
    message: 'fix: 恢复 M2 并完善 M5 M6 M7 基础版',
    tree: createdTree.sha,
    parents: [baseSha],
  });
  try {
    await github('POST', '/git/refs', { ref: `refs/heads/${branchName}`, sha: commit.sha });
  } catch (error) {
    if (!String(error.message).includes('422')) throw error;
    await github('PATCH', `/git/refs/${encodeURIComponent(`heads/${branchName}`)}`, { sha: commit.sha, force: true });
  }
  console.log(JSON.stringify({ branchName, commitSha: commit.sha, fileCount: files.length }, null, 2));
})();
