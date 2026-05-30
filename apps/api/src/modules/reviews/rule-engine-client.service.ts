import path from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import {
  RuleEngineScanRequestSchema,
  RuleEngineScanResponseSchema,
  type RuleEngineScanResponse,
} from "@ai-pr-review/shared-types";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";

@Injectable()
export class RuleEngineClientService {
  constructor(
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
  ) {}

  async scanRepository(input: {
    repositoryPath?: string;
    files?: Array<{
      path: string;
      content: string;
    }>;
    semgrepConfigs?: string[];
    moduleRuleConfigs?: Record<string, string>;
    timeoutSeconds: number;
    engines: Array<"semgrep" | "eslint">;
  }): Promise<RuleEngineScanResponse> {
    const payload = RuleEngineScanRequestSchema.parse({
      repositoryPath: input.repositoryPath,
      files: input.files ?? [],
      semgrepConfigs: input.semgrepConfigs ?? [],
      moduleRuleConfigs: input.moduleRuleConfigs ?? {},
      timeoutSeconds: input.timeoutSeconds,
      engines: input.engines,
    });

    const response = await fetch(`${this.configService.ruleEngineUrl}/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new ApiModuleError(
        "INTERNAL_ERROR",
        `rule-engine 调用失败，状态码 ${response.status}`,
        502,
      );
    }

    const parsed = RuleEngineScanResponseSchema.parse(await response.json());

    return RuleEngineScanResponseSchema.parse({
      violations: parsed.violations.map((violation) => ({
        ...violation,
        filePath: normalizeFilePath(input.repositoryPath, violation.filePath),
      })),
      failures: parsed.failures,
    });
  }
}

function normalizeFilePath(
  repositoryPath: string | undefined,
  filePath: string,
): string {
  if (!path.isAbsolute(filePath)) {
    return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  if (!repositoryPath) {
    return filePath.replace(/\\/g, "/");
  }

  const relativePath = path.relative(repositoryPath, filePath);
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}
