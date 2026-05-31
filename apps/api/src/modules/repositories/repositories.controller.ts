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
  RepositoryConnectRequestSchema,
} from "@ai-pr-review/shared-types";
import { ZodError, z } from "zod";
import { ApiModuleError } from "./api-error.js";
import { RepositoryConnectService } from "./repository-connect.service.js";
import { RepositorySemanticMapService } from "./repository-semantic-map.service.js";

function toBadRequest(error: unknown): BadRequestException {
  if (error instanceof ZodError) {
    return new BadRequestException(
      ApiErrorResponseSchema.parse({
        error: {
          code: "VALIDATION_ERROR",
          message: "请求体校验失败",
          details: {
            issues: error.issues,
          },
        },
      }),
    );
  }

  if (error instanceof Error) {
    return new BadRequestException(
      ApiErrorResponseSchema.parse({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
        },
      }),
    );
  }

  return new BadRequestException(
    ApiErrorResponseSchema.parse({
      error: {
        code: "VALIDATION_ERROR",
        message: "未知请求错误",
      },
    }),
  );
}

@Controller("repositories")
export class RepositoriesController {
  constructor(
    @Inject(RepositoryConnectService)
    private readonly repositoryConnectService: RepositoryConnectService,
    @Inject(RepositorySemanticMapService)
    private readonly repositorySemanticMapService: RepositorySemanticMapService,
  ) {}

  @Post("connect")
  @HttpCode(HttpStatus.OK)
  async connect(@Body() body: unknown) {
    try {
      const request = RepositoryConnectRequestSchema.parse(body);
      return await this.repositoryConnectService.connect(request);
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }

      throw toBadRequest(error);
    }
  }

  @Get(":repositoryId/semantic-map")
  async getSemanticMap(@Param("repositoryId") repositoryId: string) {
    try {
      const parsedRepositoryId = z
        .string()
        .uuid("repositoryId 必须是合法 UUID")
        .parse(repositoryId);
      return await this.repositorySemanticMapService.getMap(parsedRepositoryId);
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }

      throw toBadRequest(error);
    }
  }
}
