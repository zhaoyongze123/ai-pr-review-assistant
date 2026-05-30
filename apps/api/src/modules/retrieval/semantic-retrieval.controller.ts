import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
} from "@nestjs/common";
import {
  ApiErrorResponseSchema,
  SemanticSearchRequestSchema,
} from "@ai-pr-review/shared-types";
import { z, ZodError } from "zod";
import { ApiModuleError } from "../repositories/api-error.js";
import { SemanticRetrievalService } from "./semantic-retrieval.service.js";

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
export class SemanticRetrievalController {
  constructor(
    @Inject(SemanticRetrievalService)
    private readonly semanticRetrievalService: SemanticRetrievalService,
  ) {}

  @Post(":repositoryId/retrieval/search")
  @HttpCode(HttpStatus.OK)
  async search(
    @Param("repositoryId") repositoryId: string,
    @Body() body: unknown,
  ) {
    try {
      const parsedRepositoryId = z
        .string()
        .uuid("路径参数必须是合法 UUID")
        .parse(repositoryId);
      const request = SemanticSearchRequestSchema.parse(body ?? {});
      return await this.semanticRetrievalService.search(
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
}
