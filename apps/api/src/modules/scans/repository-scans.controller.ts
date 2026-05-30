import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiErrorResponseSchema,
  RepositoryScanTriggerRequestSchema,
} from "@ai-pr-review/shared-types";
import { z, ZodError } from "zod";
import { ApiModuleError } from "../repositories/api-error.js";
import { RepositoryScanService } from "./repository-scan.service.js";

function toBadRequest(error: unknown): BadRequestException {
  if (error instanceof ZodError) {
    return new BadRequestException(
      ApiErrorResponseSchema.parse({
        error: {
          code: "VALIDATION_ERROR",
          message: "请求参数校验失败",
          details: {
            issues: error.issues,
          },
        },
      }),
    );
  }

  return new BadRequestException(
    ApiErrorResponseSchema.parse({
      error: {
        code: "VALIDATION_ERROR",
        message:
          error instanceof Error ? error.message : "未知请求参数校验错误",
      },
    }),
  );
}

@Controller("repositories")
export class RepositoryScansController {
  constructor(
    @Inject(RepositoryScanService)
    private readonly repositoryScanService: RepositoryScanService,
  ) {}

  @Post(":repositoryId/scan")
  @HttpCode(HttpStatus.OK)
  async triggerScan(
    @Param("repositoryId") repositoryId: string,
    @Body() body: unknown,
  ) {
    try {
      const parsedRepositoryId = this.parseUuid(repositoryId);
      const request = RepositoryScanTriggerRequestSchema.parse(body ?? {});
      return await this.repositoryScanService.trigger(
        parsedRepositoryId,
        request,
      );
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }

  @Get(":repositoryId/scans/:scanId")
  async getScanStatus(
    @Param("repositoryId") repositoryId: string,
    @Param("scanId") scanId: string,
  ) {
    try {
      const parsedRepositoryId = this.parseUuid(repositoryId);
      const parsedScanId = this.parseUuid(scanId);
      return await this.repositoryScanService.getStatus(
        parsedRepositoryId,
        parsedScanId,
      );
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }

  private parseUuid(value: string) {
    return z.string().uuid("路径参数必须是合法 UUID").parse(value);
  }
}
