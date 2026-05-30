import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function main() {
  const ruleEngineUrl = process.env.RULE_ENGINE_URL ?? "http://127.0.0.1:58001";
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "ai-pr-review-rule-engine-"),
  );

  try {
    const configPath = path.join(tempRoot, "semgrep-rule.yml");
    await writeFile(
      configPath,
      `
rules:
  - id: custom.no-eval
    patterns:
      - pattern: eval(...)
    message: 禁止直接调用 eval
    severity: ERROR
    languages: [javascript, typescript]
    metadata:
      category: security
`,
      "utf8",
    );

    const healthResponse = await fetch(`${ruleEngineUrl}/health`);
    assert.equal(healthResponse.status, 200, "rule-engine 必须先可用");

    const response = await fetch(`${ruleEngineUrl}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [
          {
            path: "src/danger.js",
            content:
              "export function run(userInput) { return eval(userInput); }\n",
          },
        ],
        engines: ["semgrep"],
        timeoutSeconds: 30,
        moduleRuleConfigs: {
          src: configPath,
        },
      }),
    });

    assert.equal(response.status, 200, "rule-engine /scan 应返回成功");
    const payload = (await response.json()) as {
      violations?: Array<{
        engine?: string;
        ruleId?: string;
        filePath?: string;
      }>;
      failures?: Array<{ engine?: string; message?: string }>;
    };

    assert.equal(
      payload.failures?.length ?? 0,
      0,
      "自定义 semgrep 规则联调不应出现失败",
    );
    assert.ok(
      (payload.violations ?? []).some(
        (violation) =>
          violation.engine === "semgrep" &&
          violation.ruleId === "custom.no-eval" &&
          violation.filePath === "src/danger.js",
      ),
      "moduleRuleConfigs 应命中自定义 eval 规则",
    );

    console.log("rule engine smoke passed");
  } finally {
    await rm(tempRoot, {
      recursive: true,
      force: true,
    });
  }
}

void main().catch((error) => {
  console.error("rule engine smoke failed", error);
  process.exit(1);
});
