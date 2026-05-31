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
  CreateReviewJobRequestSchema,
} from "@ai-pr-review/shared-types";
import { ZodError, z } from "zod";
import { ApiModuleError } from "../repositories/api-error.js";
import { FirstPassReviewService } from "./first-pass-review.service.js";
import { ReviewQueryService } from "./review-query.service.js";

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

function parseReviewJobId(reviewJobId: string): string {
  return z.string().uuid("reviewJobId 必须是合法 UUID").parse(reviewJobId);
}

@Controller("review-jobs")
export class ReviewJobsController {
  constructor(
    @Inject(FirstPassReviewService)
    private readonly firstPassReviewService: FirstPassReviewService,
    @Inject(ReviewQueryService)
    private readonly reviewQueryService: ReviewQueryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() body: unknown) {
    try {
      const request = CreateReviewJobRequestSchema.parse(body);
      return await this.firstPassReviewService.start(request);
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }

  @Get(":reviewJobId")
  async getDetail(@Param("reviewJobId") reviewJobId: string) {
    try {
      return await this.reviewQueryService.getDetail(
        parseReviewJobId(reviewJobId),
      );
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }

  @Get(":reviewJobId/files")
  async getFiles(@Param("reviewJobId") reviewJobId: string) {
    try {
      return await this.reviewQueryService.getFiles(
        parseReviewJobId(reviewJobId),
      );
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }

  @Get(":reviewJobId/comments")
  async getComments(@Param("reviewJobId") reviewJobId: string) {
    try {
      return await this.reviewQueryService.getComments(
        parseReviewJobId(reviewJobId),
      );
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }
}
