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
}
