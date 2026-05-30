import { Injectable } from "@nestjs/common";
import { ApiModuleError } from "./api-error.js";

@Injectable()
export class ApiConfigService {
  get port(): number {
    return Number(process.env.PORT ?? 3001);
  }

  get databaseUrl(): string {
    const value = process.env.DATABASE_URL?.trim();
    if (!value) {
      throw new ApiModuleError(
        "DATABASE_ERROR",
        "缺少 DATABASE_URL 环境变量",
        500,
      );
    }
    return value;
  }

  get githubToken(): string {
    const value = process.env.GITHUB_TOKEN?.trim();
    if (!value) {
      throw new ApiModuleError(
        "GITHUB_UNAUTHORIZED",
        "缺少 GITHUB_TOKEN 环境变量",
        401,
      );
    }
    return value;
  }

  get redisUrl(): string {
    const value = process.env.REDIS_URL?.trim();
    if (!value) {
      throw new ApiModuleError("REDIS_ERROR", "缺少 REDIS_URL 环境变量", 500);
    }
    return value;
  }

  get ruleEngineUrl(): string {
    return process.env.RULE_ENGINE_URL?.trim() || "http://127.0.0.1:58001";
  }

  get llmApiBase(): string {
    return process.env.LLM_API_BASE?.trim() || "https://aiapis.help";
  }

  get llmApiKey(): string {
    const value = process.env.LLM_API_KEY?.trim();
    if (!value) {
      throw new ApiModuleError(
        "INTERNAL_ERROR",
        "缺少 LLM_API_KEY 环境变量",
        500,
      );
    }
    return value;
  }

  get defaultLlmProvider(): string {
    return process.env.DEFAULT_LLM_PROVIDER?.trim() || "openai-compatible";
  }

  get defaultLlmModel(): string {
    return process.env.DEFAULT_LLM_MODEL?.trim() || "gpt-5.4";
  }

  get langsmithApiKey(): string | undefined {
    const value = process.env.LANGSMITH_API_KEY?.trim();
    return value || undefined;
  }

  get langsmithTracing(): boolean {
    const value = process.env.LANGSMITH_TRACING?.trim().toLowerCase();
    const enabled = value === "1" || value === "true" || value === "yes";
    return enabled && Boolean(this.langsmithApiKey);
  }

  get langsmithProject(): string {
    return process.env.LANGSMITH_PROJECT?.trim() || "ai-pr-review-assistant";
  }

  get langsmithWorkspaceId(): string | undefined {
    const value = process.env.LANGSMITH_WORKSPACE_ID?.trim();
    return value || undefined;
  }

  get langsmithEndpoint(): string {
    return (
      process.env.LANGSMITH_ENDPOINT?.trim() ||
      "https://api.smith.langchain.com"
    );
  }
}
