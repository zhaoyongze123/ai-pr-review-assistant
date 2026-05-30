import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Post,
} from "@nestjs/common";
import {
  ApiErrorResponseSchema,
  RepositoryConnectRequestSchema,
} from "@ai-pr-review/shared-types";
import { ZodError } from "zod";
import { ApiModuleError } from "./api-error.js";
import { RepositoryConnectService } from "./repository-connect.service.js";

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
}
