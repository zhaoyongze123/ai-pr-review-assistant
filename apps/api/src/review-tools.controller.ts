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
  CommentAdmissionRequestSchema,
  ContextPlanRequestSchema,
  FirstPassReviewRunRequestSchema,
  QualityScoreRequestSchema,
  ReviewTriageRequestSchema,
} from "@ai-pr-review/shared-types";
import { ZodError } from "zod";
import { ContextFetcherService } from "./modules/context/context-fetcher.service.js";
import { CommentAdmissionGateService } from "./modules/quality-gates/comment-admission-gate.service.js";
import { QualityScoringService } from "./modules/quality-gates/quality-scoring.service.js";
import { ApiModuleError } from "./modules/repositories/api-error.js";
import { FirstPassReviewService } from "./modules/reviews/first-pass-review.service.js";
import { ReviewTriageService } from "./modules/triage/review-triage.service.js";

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
        details: {
          detail: String(error),
        },
      },
    }),
  );
}

@Controller("review-tools")
export class ReviewToolsController {
  constructor(
    @Inject(ContextFetcherService)
    private readonly contextFetcherService: ContextFetcherService,
    @Inject(CommentAdmissionGateService)
    private readonly commentAdmissionGateService: CommentAdmissionGateService,
    @Inject(QualityScoringService)
    private readonly qualityScoringService: QualityScoringService,
    @Inject(FirstPassReviewService)
    private readonly firstPassReviewService: FirstPassReviewService,
    @Inject(ReviewTriageService)
    private readonly reviewTriageService: ReviewTriageService,
  ) {}

  @Post("context-plan")
  createContextPlan(@Body() body: unknown) {
    try {
      const payload = ContextPlanRequestSchema.parse(body);
      return this.contextFetcherService.createPlan(
        payload.request,
        payload.budget,
      );
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Post("first-pass")
  @HttpCode(HttpStatus.OK)
  async runFirstPass(@Body() body: unknown) {
    try {
      const payload = FirstPassReviewRunRequestSchema.parse(body);
      return await this.firstPassReviewService.run(payload);
    } catch (error) {
      if (error instanceof ApiModuleError) {
        throw new HttpException(error.toResponse(), error.statusCode);
      }
      throw toBadRequest(error);
    }
  }

  @Post("triage")
  evaluateTriage(@Body() body: unknown) {
    try {
      const payload = ReviewTriageRequestSchema.parse(body);
      return this.reviewTriageService.evaluate(
        payload.decision,
        payload.budget,
      );
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Post("quality-score")
  scoreCandidate(@Body() body: unknown) {
    try {
      const payload = QualityScoreRequestSchema.parse(body);
      return this.qualityScoringService.score(payload.candidate);
    } catch (error) {
      throw toBadRequest(error);
    }
  }

  @Post("comment-admission")
  evaluateComment(@Body() body: unknown) {
    try {
      const payload = CommentAdmissionRequestSchema.parse(body);
      return this.commentAdmissionGateService.evaluate(payload.candidate);
    } catch (error) {
      throw toBadRequest(error);
    }
  }
}
