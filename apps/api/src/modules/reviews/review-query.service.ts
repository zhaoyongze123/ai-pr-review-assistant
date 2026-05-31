import { Inject, Injectable } from "@nestjs/common";
import { parseUnifiedDiffPatch } from "@ai-pr-review/diff-core";
import { buildReviewAggregateResult } from "@ai-pr-review/review-core";
import {
  PullRequestFileSchema,
  ReviewJobCommentsResponseSchema,
  ReviewJobDetailResponseSchema,
  ReviewJobFilesResponseSchema,
  type FileReview,
  type PullRequest,
  type ReviewComment,
  type ReviewJob,
  type ReviewJobCommentsResponse,
  type ReviewJobDetailResponse,
  type ReviewJobFilesResponse,
} from "@ai-pr-review/shared-types";
import { ApiModuleError } from "../repositories/api-error.js";
import { FileReviewStoreService } from "./file-review-store.service.js";
import { PullRequestStoreService } from "./pull-request-store.service.js";
import { ReviewCommentStoreService } from "./review-comment-store.service.js";
import { ReviewJobStoreService } from "./review-job-store.service.js";

type ReviewJobBundle = {
  reviewJob: ReviewJob;
  pullRequest: PullRequest;
  fileReviews: FileReview[];
  comments: ReviewComment[];
};

@Injectable()
export class ReviewQueryService {
  constructor(
    @Inject(FileReviewStoreService)
    private readonly fileReviewStoreService: FileReviewStoreService,
    @Inject(PullRequestStoreService)
    private readonly pullRequestStoreService: PullRequestStoreService,
    @Inject(ReviewCommentStoreService)
    private readonly reviewCommentStoreService: ReviewCommentStoreService,
    @Inject(ReviewJobStoreService)
    private readonly reviewJobStoreService: ReviewJobStoreService,
  ) {}

  async getDetail(reviewJobId: string): Promise<ReviewJobDetailResponse> {
    const bundle = await this.loadReviewJobBundle(reviewJobId);
    const aggregateResult = buildReviewAggregateResult({
      reviewJob: bundle.reviewJob,
      pullRequest: bundle.pullRequest,
      fileReviews: bundle.fileReviews,
      comments: bundle.comments,
    });

    return ReviewJobDetailResponseSchema.parse({
      reviewJob: bundle.reviewJob,
      pullRequest: bundle.pullRequest,
      summary: aggregateResult.summary,
    });
  }

  async getFiles(reviewJobId: string): Promise<ReviewJobFilesResponse> {
    const bundle = await this.loadReviewJobBundle(reviewJobId);
    const pullRequestFileMap = new Map(
      bundle.pullRequest.files.map((file) => [file.filePath, file]),
    );

    return ReviewJobFilesResponseSchema.parse({
      reviewJobId,
      files: bundle.fileReviews.map((fileReview) => {
        const pullRequestFile =
          pullRequestFileMap.get(fileReview.filePath) ??
          PullRequestFileSchema.parse({
            filePath: fileReview.filePath,
            status: fileReview.fileStatus,
            additions: 0,
            deletions: 0,
            language: fileReview.language,
          });

        return {
          fileReview,
          pullRequestFile,
          diff: pullRequestFile.patch
            ? parseUnifiedDiffPatch(pullRequestFile)
            : undefined,
        };
      }),
    });
  }

  async getComments(reviewJobId: string): Promise<ReviewJobCommentsResponse> {
    const reviewJob = await this.reviewJobStoreService.findById(reviewJobId);
    if (!reviewJob?.id) {
      throw new ApiModuleError(
        "REVIEW_JOB_NOT_FOUND",
        "指定的审查任务不存在",
        404,
      );
    }

    const comments =
      await this.reviewCommentStoreService.findByReviewJobId(reviewJobId);

    return ReviewJobCommentsResponseSchema.parse({
      reviewJobId,
      comments,
    });
  }

  private async loadReviewJobBundle(
    reviewJobId: string,
  ): Promise<ReviewJobBundle> {
    const reviewJob = await this.reviewJobStoreService.findById(reviewJobId);
    if (!reviewJob?.id) {
      throw new ApiModuleError(
        "REVIEW_JOB_NOT_FOUND",
        "指定的审查任务不存在",
        404,
      );
    }

    if (!reviewJob.pullRequestId) {
      throw new ApiModuleError(
        "PULL_REQUEST_NOT_FOUND",
        "该审查任务缺少关联的 PR 快照",
        404,
      );
    }

    const [pullRequest, fileReviews, comments] = await Promise.all([
      this.pullRequestStoreService.findById(reviewJob.pullRequestId),
      this.fileReviewStoreService.findByReviewJobId(reviewJobId),
      this.reviewCommentStoreService.findByReviewJobId(reviewJobId),
    ]);

    if (!pullRequest) {
      throw new ApiModuleError(
        "PULL_REQUEST_NOT_FOUND",
        "指定的 PR 快照不存在",
        404,
      );
    }

    return {
      reviewJob,
      pullRequest,
      fileReviews,
      comments,
    };
  }
}
