import { existsSync } from "node:fs";
import { Inject, Injectable } from "@nestjs/common";
import { parseUnifiedDiffPatch } from "@ai-pr-review/diff-core";
import {
  buildFileReviewSummary,
  buildReviewAggregateResult,
  calibrateFirstPassDecision,
  calibrateSecondPassResult,
  finalizeFileReviewComments,
  runFirstPassReviewPipeline,
  runReviewPipeline,
} from "@ai-pr-review/review-core";
import {
  buildFirstPassReviewPrompt,
  buildSecondPassReviewPrompt,
} from "@ai-pr-review/prompt-builder";
import {
  runFirstPassTriage,
  runSecondPassReview,
} from "@ai-pr-review/llm-gateway";
import {
  FirstPassReviewRunResponseSchema,
  type CreateReviewJobRequest,
  type CreateReviewJobResponse,
  type ContextBudget,
  type ContextFetchResult,
  type FileReview,
  type HighestSeverity,
  type LlmCallLog,
  type PullRequest,
  type ReviewAggregateResult,
  type ReviewComment,
  type ReviewCommentCandidate,
  type ReviewJob,
  type RuleViolation,
  type ReviewRiskLevel,
  type ReviewTriageDecision,
  type SecondPassReviewResult,
  type FirstPassReviewRunRequest,
  type FirstPassReviewRunResponse,
} from "@ai-pr-review/shared-types";
import { ContextFetchLogStoreService } from "../context/context-fetch-log-store.service.js";
import { ContextFetcherService } from "../context/context-fetcher.service.js";
import { ApiConfigService } from "../repositories/api-config.service.js";
import { ApiModuleError } from "../repositories/api-error.js";
import { RepositoryConnectService } from "../repositories/repository-connect.service.js";
import { RepositoryStoreService } from "../repositories/repository-store.service.js";
import { GitHubClientService } from "../repositories/github-client.service.js";
import { RepositoryScanService } from "../scans/repository-scan.service.js";
import { RepositoryScanStoreService } from "../scans/repository-scan-store.service.js";
import { FileReviewStoreService } from "./file-review-store.service.js";
import { LangsmithTraceService } from "./langsmith-trace.service.js";
import { LlmCallLogStoreService } from "./llm-call-log-store.service.js";
import { PullRequestStoreService } from "./pull-request-store.service.js";
import { ReviewCommentStoreService } from "./review-comment-store.service.js";
import { ReviewEventsService } from "./review-events.service.js";
import { ReviewJobStoreService } from "./review-job-store.service.js";
import { RuleEngineClientService } from "./rule-engine-client.service.js";
import { withClonedRepository } from "./with-cloned-repository.js";

type PreparedReviewRun = {
  request: FirstPassReviewRunRequest;
  startedAt: number;
  repository: Awaited<ReturnType<RepositoryStoreService["findByRef"]>>;
  persistedPullRequest: PullRequest;
  reviewableFiles: PullRequest["files"];
  reviewJob: ReviewJob;
};

const AUTO_SCAN_POLL_ATTEMPTS = 90;
const AUTO_SCAN_POLL_INTERVAL_MS = 1000;

@Injectable()
export class FirstPassReviewService {
  constructor(
    @Inject(ContextFetcherService)
    private readonly contextFetcherService: ContextFetcherService,
    @Inject(ContextFetchLogStoreService)
    private readonly contextFetchLogStoreService: ContextFetchLogStoreService,
    @Inject(ApiConfigService)
    private readonly configService: ApiConfigService,
    @Inject(RepositoryStoreService)
    private readonly repositoryStoreService: RepositoryStoreService,
    @Inject(RepositoryConnectService)
    private readonly repositoryConnectService: RepositoryConnectService,
    @Inject(GitHubClientService)
    private readonly gitHubClientService: GitHubClientService,
    @Inject(RepositoryScanService)
    private readonly repositoryScanService: RepositoryScanService,
    @Inject(RepositoryScanStoreService)
    private readonly repositoryScanStoreService: RepositoryScanStoreService,
    @Inject(RuleEngineClientService)
    private readonly ruleEngineClientService: RuleEngineClientService,
    @Inject(PullRequestStoreService)
    private readonly pullRequestStoreService: PullRequestStoreService,
    @Inject(ReviewJobStoreService)
    private readonly reviewJobStoreService: ReviewJobStoreService,
    @Inject(FileReviewStoreService)
    private readonly fileReviewStoreService: FileReviewStoreService,
    @Inject(LlmCallLogStoreService)
    private readonly llmCallLogStoreService: LlmCallLogStoreService,
    @Inject(ReviewCommentStoreService)
    private readonly reviewCommentStoreService: ReviewCommentStoreService,
    @Inject(ReviewEventsService)
    private readonly reviewEventsService: ReviewEventsService,
    @Inject(LangsmithTraceService)
    private readonly langsmithTraceService: LangsmithTraceService,
  ) {}

  async start(
    request: CreateReviewJobRequest,
  ): Promise<CreateReviewJobResponse> {
    const prepared = await this.prepareRun(toFirstPassRunRequest(request));

    setTimeout(() => {
      void this.executeRun(prepared).catch((error) => {
        console.error("review job background run failed", error);
      });
    }, 0);

    return {
      reviewJobId: prepared.reviewJob.id!,
      status: prepared.reviewJob.status,
    };
  }

  async run(
    request: FirstPassReviewRunRequest,
  ): Promise<FirstPassReviewRunResponse> {
    const prepared = await this.prepareRun(request);
    return this.executeRun(prepared);
  }

  private async prepareRun(
    request: FirstPassReviewRunRequest,
  ): Promise<PreparedReviewRun> {
    const repository = await this.ensureRepositoryConnected(request.repository);
    const pullRequest = await this.gitHubClientService.getPullRequest(
      request.repository,
      request.prNumber,
    );
    const persistedPullRequest = await this.pullRequestStoreService.upsert({
      repositoryId: repository?.id,
      pullRequest,
    });
    const reviewableFiles = persistedPullRequest.files.filter(
      (file) => typeof file.patch === "string" && file.patch.length > 0,
    );
    const reviewJob = await this.reviewJobStoreService.createRunning({
      repositoryId: repository?.id,
      pullRequestId: persistedPullRequest.id,
      triggerSource: request.triggerSource,
      totalFiles: reviewableFiles.length,
      totalSlices: reviewableFiles.length,
      llmProvider: this.configService.defaultLlmProvider,
      llmModel: this.configService.defaultLlmModel,
    });

    this.publishReviewJobProgress(reviewJob);

    return {
      request,
      startedAt: Date.now(),
      repository,
      persistedPullRequest,
      reviewableFiles,
      reviewJob,
    };
  }

  private async executeRun(
    prepared: PreparedReviewRun,
  ): Promise<FirstPassReviewRunResponse> {
    const {
      request,
      startedAt,
      repository,
      persistedPullRequest,
      reviewableFiles,
      reviewJob,
    } = prepared;
    const reviewJobTrace = await this.langsmithTraceService.startRun({
      name: "review-job",
      runType: "chain",
      inputs: {
        repository: request.repository,
        prNumber: request.prNumber,
        triggerSource: request.triggerSource,
        ruleScanTimeoutSeconds: request.ruleScanTimeoutSeconds,
        ruleScanEngines: request.ruleScanEngines,
      },
      metadata: {
        stage: "first-pass-review",
        reviewJobId: reviewJob.id,
      },
      tags: ["review-job", "first-pass"],
    });

    try {
      await this.ensureRepositoryScanReady({
        repositoryId: repository?.id,
        repository: request.repository,
        targetSha: persistedPullRequest.headSha,
        reviewJobId: reviewJob.id!,
        parentRun: reviewJobTrace,
      });

      const response = await this.langsmithTraceService.withRunTree(
        reviewJobTrace,
        async () =>
          withClonedRepository({
            cloneUrl:
              repository?.cloneUrl ??
              `https://github.com/${request.repository.owner}/${request.repository.repo}.git`,
            ref: persistedPullRequest.headSha,
            authToken: this.configService.githubToken,
            callback: async (repositoryPath) => {
              const ruleScanTrace = await this.langsmithTraceService.startRun({
                name: "rule-engine-scan",
                runType: "tool",
                parentRun: reviewJobTrace,
                inputs: {
                  repositoryPath,
                  timeoutSeconds: request.ruleScanTimeoutSeconds,
                  engines: request.ruleScanEngines,
                },
                metadata: {
                  reviewJobId: reviewJob.id,
                },
                tags: ["rule-engine", "scan"],
              });

              let ruleScan;
              try {
                ruleScan = await this.ruleEngineClientService.scanRepository({
                  repositoryPath,
                  timeoutSeconds: request.ruleScanTimeoutSeconds,
                  engines: request.ruleScanEngines,
                  semgrepConfigs: discoverSemgrepConfigs(repositoryPath),
                  moduleRuleConfigs: discoverModuleRuleConfigs(repositoryPath),
                });
                await this.langsmithTraceService.endRun({
                  run: ruleScanTrace,
                  outputs: {
                    violationCount: ruleScan.violations.length,
                    failureCount: ruleScan.failures.length,
                  },
                });
              } catch (error) {
                await this.langsmithTraceService.endRun({
                  run: ruleScanTrace,
                  error: this.getSafeErrorMessage(error),
                });
                throw error;
              }

              const fileReviews: FileReview[] = [];
              const comments: ReviewComment[] = [];
              const llmCalls: LlmCallLog[] = [];
              const files: FirstPassReviewRunResponse["files"] = [];
              let totalInputTokens = 0;
              let totalOutputTokens = 0;

              for (const file of reviewableFiles) {
                const fileTrace = await this.langsmithTraceService.startRun({
                  name: "review-file",
                  runType: "chain",
                  parentRun: reviewJobTrace,
                  inputs: {
                    filePath: file.filePath,
                    status: file.status,
                    additions: file.additions,
                    deletions: file.deletions,
                  },
                  metadata: {
                    reviewJobId: reviewJob.id,
                    repository: `${request.repository.owner}/${request.repository.repo}`,
                    prNumber: request.prNumber,
                  },
                  tags: ["review-file"],
                });

                try {
                  const result = await this.langsmithTraceService.withRunTree(
                    fileTrace,
                    async () =>
                      this.processFileReview({
                        request,
                        repositoryId: repository?.id,
                        repositoryPath,
                        reviewJobId: reviewJob.id!,
                        pullRequestId: persistedPullRequest.id!,
                        file,
                        ruleViolations: ruleScan.violations,
                        parentRun: fileTrace,
                      }),
                  );

                  fileReviews.push(result.fileReview);
                  comments.push(...result.comments);
                  files.push(result.fileResult);
                  if (result.llmCalls.length > 0) {
                    llmCalls.push(...result.llmCalls);
                    totalInputTokens += result.llmCalls.reduce(
                      (sum, item) => sum + item.inputTokens,
                      0,
                    );
                    totalOutputTokens += result.llmCalls.reduce(
                      (sum, item) => sum + item.outputTokens,
                      0,
                    );
                  }

                  const progressReviewJob =
                    await this.reviewJobStoreService.markProgress({
                      reviewJobId: reviewJob.id!,
                      finishedFiles: fileReviews.length,
                      finishedSlices: files.length,
                      totalInputTokens,
                      totalOutputTokens,
                    });
                  this.publishReviewJobProgress(progressReviewJob);
                  this.publishFileReviewCompleted({
                    reviewJobId: reviewJob.id!,
                    fileReview: result.fileReview,
                    comments: result.comments,
                  });

                  await this.langsmithTraceService.endRun({
                    run: fileTrace,
                    outputs: {
                      triageDecision: result.fileReview.triageDecision,
                      highestSeverity: result.fileReview.highestSeverity,
                      aiCommentCount: result.fileReview.aiCommentCount,
                      ruleCommentCount: result.fileReview.ruleCommentCount,
                      contextArtifacts:
                        result.fileResult.contextResult?.artifacts.length ?? 0,
                      secondPassDecision:
                        result.fileResult.secondPass?.decision ?? null,
                      finalCommentCount: result.comments.length,
                    },
                  });
                } catch (error) {
                  await this.langsmithTraceService.endRun({
                    run: fileTrace,
                    error: this.getSafeErrorMessage(error),
                  });
                  throw error;
                }
              }

              const finishedReviewJob =
                await this.reviewJobStoreService.markDone({
                  reviewJobId: reviewJob.id!,
                  finishedFiles: files.length,
                  finishedSlices: files.length,
                  totalInputTokens,
                  totalOutputTokens,
                  totalCostUsd: 0,
                  durationMs: Date.now() - startedAt,
                });
              this.publishReviewJobProgress(finishedReviewJob);

              const aggregateResult = buildReviewAggregateResult({
                reviewJob: finishedReviewJob,
                pullRequest: persistedPullRequest,
                fileReviews,
                comments,
              });
              await this.traceAggregateSummary({
                reviewJobId: reviewJob.id!,
                parentRun: reviewJobTrace,
                aggregateResult,
              });

              return FirstPassReviewRunResponseSchema.parse({
                reviewJob: finishedReviewJob,
                pullRequest: persistedPullRequest,
                repositoryPath,
                ruleViolations: ruleScan.violations,
                ruleFailures: ruleScan.failures,
                fileReviews,
                comments,
                summary: aggregateResult.summary,
                aggregateResult,
                llmCalls,
                files,
              });
            },
          }),
      );

      await this.langsmithTraceService.endRun({
        run: reviewJobTrace,
        outputs: {
          reviewJobId: response.reviewJob?.id,
          totalFiles: response.files.length,
          totalComments: response.comments.length,
          totalRuleViolations: response.ruleViolations.length,
          totalLlmCalls: response.llmCalls.length,
          mergeRecommendation: response.summary?.mergeRecommendation ?? null,
        },
      });
      await this.langsmithTraceService.flush();
      return response;
    } catch (error) {
      const failedReviewJob = await this.reviewJobStoreService.markFailed(
        reviewJob.id!,
        this.getSafeErrorMessage(error),
      );
      this.publishReviewJobProgress(failedReviewJob);
      await this.langsmithTraceService.endRun({
        run: reviewJobTrace,
        error: this.getSafeErrorMessage(error),
      });
      await this.langsmithTraceService.flush();
      throw error;
    }
  }

  private async processFileReview(input: {
    request: FirstPassReviewRunRequest;
    repositoryId?: string;
    repositoryPath: string;
    reviewJobId: string;
    pullRequestId: string;
    file: FirstPassReviewRunResponse["files"][number]["file"];
    ruleViolations: RuleViolation[];
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
  }): Promise<{
    fileReview: FileReview;
    comments: ReviewComment[];
    llmCalls: LlmCallLog[];
    fileResult: FirstPassReviewRunResponse["files"][number];
  }> {
    const diff = parseUnifiedDiffPatch(input.file);
    const relatedViolations = input.ruleViolations.filter(
      (violation) => violation.filePath === input.file.filePath,
    );
    const fileStartedAt = Date.now();
    const prompt = buildFirstPassReviewPrompt({
      file: input.file,
      diff,
      ruleViolations: relatedViolations,
    });
    const fallback = runFirstPassReviewPipeline({
      reviewJobId: input.reviewJobId,
      file: input.file,
      diff,
      ruleViolations: relatedViolations,
    });

    let decision: ReviewTriageDecision;
    let llmResult: Awaited<ReturnType<typeof runFirstPassTriage>> | undefined;
    let contextResult: ContextFetchResult | undefined;
    let secondPass: Awaited<ReturnType<typeof runSecondPassReview>> | undefined;
    let secondPassResult: SecondPassReviewResult | undefined;

    try {
      llmResult = await runFirstPassTriage({
        apiBase: this.configService.llmApiBase,
        apiKey: this.configService.llmApiKey,
        provider: this.configService.defaultLlmProvider,
        model: this.configService.defaultLlmModel,
        promptKind: "triage",
        messages: prompt.messages,
        temperature: 0,
        langsmith: this.langsmithTraceService.buildLlmTrace({
          runName: "first-pass-review",
          metadata: {
            reviewJobId: input.reviewJobId,
            repository: `${input.request.repository.owner}/${input.request.repository.repo}`,
            prNumber: input.request.prNumber,
            filePath: input.file.filePath,
            promptVersion: prompt.promptVersion,
            triggerSource: input.request.triggerSource,
            ruleHitCount: relatedViolations.length,
          },
          tags: ["first-pass", "triage", this.configService.defaultLlmModel],
        }),
      });
      decision = calibrateFirstPassDecision({
        decision: llmResult.parsed,
        file: input.file,
        diff,
        ruleViolations: relatedViolations,
      });
    } catch {
      decision = fallback.firstPass;
    }

    const budget = createDefaultFirstPassBudget();
    const pipeline = runReviewPipeline(decision, budget);
    const contextPlan = await this.createContextPlan({
      reviewJobId: input.reviewJobId,
      filePath: input.file.filePath,
      decision,
      budget,
      parentRun: input.parentRun,
      fallbackPlan: pipeline.contextPlan,
    });

    if (pipeline.triage.action === "fetch_more_context") {
      contextResult = await this.executeContextFetch({
        reviewJobId: input.reviewJobId,
        repositoryId: input.repositoryId,
        repositoryPath: input.repositoryPath,
        filePath: input.file.filePath,
        request: decision.contextRequest,
        budget,
        parentRun: input.parentRun,
        contextPlan,
      });

      if (contextResult) {
        secondPass = await this.runSecondPass({
          request: input.request,
          reviewJobId: input.reviewJobId,
          file: input.file,
          diff,
          ruleViolations: relatedViolations,
          firstPass: decision,
          contextResult,
        });
        secondPassResult = secondPass
          ? calibrateSecondPassResult({
              result: secondPass.parsed,
              file: input.file,
              diff,
              firstPass: decision,
            })
          : undefined;
      }

      if (!secondPassResult && contextResult) {
        secondPassResult = createSecondPassFallback({
          firstPass: decision,
          contextResult,
        });
      }
    }

    const finalDecision = secondPassResult?.decision ?? decision.decision;
    const finalCandidates =
      secondPassResult?.candidateComments ?? decision.provisionalFindings;
    const contextRound = contextResult ? 1 : 0;
    const finalizedComments = finalizeFileReviewComments({
      reviewJobId: input.reviewJobId,
      filePath: input.file.filePath,
      diff,
      aiCandidates: finalCandidates,
      ruleViolations: relatedViolations,
      triageDecision: finalDecision,
      contextRound,
    });
    await this.traceQualityScoring({
      reviewJobId: input.reviewJobId,
      filePath: input.file.filePath,
      parentRun: input.parentRun,
      finalizedComments,
    });
    await this.traceCommentAdmission({
      reviewJobId: input.reviewJobId,
      filePath: input.file.filePath,
      parentRun: input.parentRun,
      finalizedComments,
    });
    const highestSeverity = pickHighestSeverity(
      relatedViolations,
      finalCandidates,
    );
    const riskScore = mapRiskScore(decision.riskLevel, highestSeverity);
    const fileSummary = buildFileReviewSummary({
      comments: finalizedComments.comments,
      fallbackSummary: secondPassResult?.rationale ?? decision.rationale,
      triageDecision: finalDecision,
    });

    const fileReview = await this.fileReviewStoreService.upsertResult({
      reviewJobId: input.reviewJobId,
      pullRequestId: input.pullRequestId,
      file: input.file,
      triageDecision: finalDecision,
      aiCommentCount: finalizedComments.aiComments.length,
      ruleCommentCount: finalizedComments.ruleComments.length,
      highestSeverity,
      riskScore,
      summary: fileSummary,
      durationMs: Date.now() - fileStartedAt,
      contextRound,
    });
    const comments = await this.reviewCommentStoreService.createMany(
      finalizedComments.comments.map((comment) => ({
        ...comment,
        fileReviewId: fileReview.id,
      })),
    );

    const llmCalls: LlmCallLog[] = [];
    if (llmResult) {
      llmCalls.push(
        await this.llmCallLogStoreService.create({
          reviewJobId: input.reviewJobId,
          fileReviewId: fileReview.id,
          provider: llmResult.provider,
          model: llmResult.model,
          promptKind: "triage",
          inputTokens: llmResult.inputTokens,
          outputTokens: llmResult.outputTokens,
          latencyMs: llmResult.latencyMs,
          requestMetadata: {
            ...llmResult.requestMetadata,
            promptVersion: prompt.promptVersion,
            filePath: input.file.filePath,
          },
          responseMetadata: llmResult.responseMetadata,
        }),
      );
    }
    if (secondPass) {
      llmCalls.push(
        await this.llmCallLogStoreService.create({
          reviewJobId: input.reviewJobId,
          fileReviewId: fileReview.id,
          provider: secondPass.provider,
          model: secondPass.model,
          promptKind: "second_pass_review",
          inputTokens: secondPass.inputTokens,
          outputTokens: secondPass.outputTokens,
          latencyMs: secondPass.latencyMs,
          requestMetadata: {
            ...secondPass.requestMetadata,
            promptVersion: "second-pass-review.v2",
            filePath: input.file.filePath,
            contextArtifactCount: contextResult?.artifacts.length ?? 0,
          },
          responseMetadata: secondPass.responseMetadata,
        }),
      );
    }
    await this.persistContextFetchLog({
      reviewJobId: input.reviewJobId,
      fileReviewId: fileReview.id,
      contextRequest: decision.contextRequest,
      contextPlan,
      contextResult,
    });

    return {
      fileReview,
      comments,
      llmCalls,
      fileResult: {
        file: input.file,
        diff,
        ruleViolations: relatedViolations,
        firstPass: decision,
        triage: pipeline.triage,
        contextPlan,
        contextResult,
        secondPass: secondPassResult,
      },
    };
  }

  private async createContextPlan(input: {
    reviewJobId: string;
    filePath: string;
    decision: ReviewTriageDecision;
    budget: ContextBudget;
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
    fallbackPlan?: ContextFetchResult;
  }): Promise<ContextFetchResult | undefined> {
    const request = input.decision.contextRequest;
    if (!request || !input.fallbackPlan) {
      return undefined;
    }

    const contextPlanTrace = await this.langsmithTraceService.startRun({
      name: "context-fetch-plan",
      runType: "tool",
      parentRun: input.parentRun,
      inputs: {
        request,
        budget: input.budget,
      },
      metadata: {
        reviewJobId: input.reviewJobId,
        filePath: input.filePath,
      },
      tags: ["context-fetch", "plan"],
    });

    try {
      const contextPlan = await this.langsmithTraceService.withRunTree(
        contextPlanTrace,
        async () =>
          this.contextFetcherService.createPlan(request, input.budget),
      );

      await this.langsmithTraceService.endRun({
        run: contextPlanTrace,
        outputs: {
          status: contextPlan.status,
          plannedCalls: contextPlan.plannedCalls.length,
          reason: contextPlan.reason,
        },
      });

      return contextPlan;
    } catch (error) {
      await this.langsmithTraceService.endRun({
        run: contextPlanTrace,
        error: this.getSafeErrorMessage(error),
      });
      return input.fallbackPlan;
    }
  }

  private async executeContextFetch(input: {
    reviewJobId: string;
    repositoryId?: string;
    repositoryPath: string;
    filePath: string;
    request?: ReviewTriageDecision["contextRequest"];
    budget: ContextBudget;
    contextPlan?: ContextFetchResult;
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
  }): Promise<ContextFetchResult | undefined> {
    if (!input.request) {
      return undefined;
    }

    if (!input.contextPlan || input.contextPlan.status !== "planned") {
      return input.contextPlan;
    }

    if (!input.repositoryId) {
      return {
        ...input.contextPlan,
        status: "skipped",
        reason: "仓库未落库，无法执行真实上下文检索",
        artifacts: [],
      };
    }

    const contextTrace = await this.langsmithTraceService.startRun({
      name: "context-fetch-summary",
      runType: "tool",
      parentRun: input.parentRun,
      inputs: {
        request: input.request,
        plannedCalls: input.contextPlan.plannedCalls,
        budget: input.budget,
      },
      metadata: {
        reviewJobId: input.reviewJobId,
        filePath: input.filePath,
      },
      tags: ["context-fetch", "execute"],
    });

    try {
      const result = await this.langsmithTraceService.withRunTree(
        contextTrace,
        async () =>
          this.contextFetcherService.execute({
            repositoryId: input.repositoryId!,
            repositoryPath: input.repositoryPath,
            request: input.request!,
            budget: input.budget,
            focusFilePath: input.filePath,
          }),
      );

      await this.langsmithTraceService.endRun({
        run: contextTrace,
        outputs: {
          status: result.status,
          artifactCount: result.artifacts.length,
          plannedCalls: result.plannedCalls.length,
          reason: result.reason,
        },
      });
      return result;
    } catch (error) {
      await this.langsmithTraceService.endRun({
        run: contextTrace,
        error: this.getSafeErrorMessage(error),
      });
      return {
        ...input.contextPlan,
        status: "skipped",
        reason: "上下文检索执行失败，已回退到首轮结果",
        artifacts: [],
      };
    }
  }

  private async runSecondPass(input: {
    request: FirstPassReviewRunRequest;
    reviewJobId: string;
    file: FirstPassReviewRunResponse["files"][number]["file"];
    diff: ReturnType<typeof parseUnifiedDiffPatch>;
    ruleViolations: RuleViolation[];
    firstPass: ReviewTriageDecision;
    contextResult: ContextFetchResult;
  }): Promise<Awaited<ReturnType<typeof runSecondPassReview>> | undefined> {
    if (input.contextResult.status !== "completed") {
      return undefined;
    }
    if (input.contextResult.artifacts.length === 0) {
      return undefined;
    }

    const prompt = buildSecondPassReviewPrompt({
      file: input.file,
      diff: input.diff,
      ruleViolations: input.ruleViolations,
      firstPass: input.firstPass,
      contextResult: input.contextResult,
    });

    try {
      return await runSecondPassReview({
        apiBase: this.configService.llmApiBase,
        apiKey: this.configService.llmApiKey,
        provider: this.configService.defaultLlmProvider,
        model: this.configService.defaultLlmModel,
        promptKind: "second-pass-review",
        messages: prompt.messages,
        temperature: 0,
        langsmith: this.langsmithTraceService.buildLlmTrace({
          runName: "second-pass-review",
          metadata: {
            reviewJobId: input.reviewJobId,
            repository: `${input.request.repository.owner}/${input.request.repository.repo}`,
            prNumber: input.request.prNumber,
            filePath: input.file.filePath,
            promptVersion: prompt.promptVersion,
            contextArtifactCount: input.contextResult.artifacts.length,
          },
          tags: ["second-pass", this.configService.defaultLlmModel],
        }),
      });
    } catch {
      return undefined;
    }
  }

  private async persistContextFetchLog(input: {
    reviewJobId: string;
    fileReviewId?: string;
    contextRequest?: ReviewTriageDecision["contextRequest"];
    contextPlan?: ContextFetchResult;
    contextResult?: ContextFetchResult;
  }) {
    if (!input.contextRequest || !input.contextPlan) {
      return;
    }

    await this.contextFetchLogStoreService.create({
      reviewJobId: input.reviewJobId,
      fileReviewId: input.fileReviewId,
      requestPayload: input.contextRequest as Record<string, unknown>,
      resultPayload: (input.contextResult ?? input.contextPlan) as Record<
        string,
        unknown
      >,
      plannedToolCalls: input.contextPlan.plannedCalls.length,
      usedRound:
        input.contextResult?.remainingBudget.usedRounds ??
        input.contextPlan.remainingBudget.usedRounds,
    });
  }

  private async traceQualityScoring(input: {
    reviewJobId: string;
    filePath: string;
    finalizedComments: ReturnType<typeof finalizeFileReviewComments>;
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
  }) {
    const trace = await this.langsmithTraceService.startRun({
      name: "quality-scoring",
      runType: "tool",
      parentRun: input.parentRun,
      inputs: {
        candidateCount: input.finalizedComments.beforeGateCount,
      },
      metadata: {
        reviewJobId: input.reviewJobId,
        filePath: input.filePath,
      },
      tags: ["quality-scoring"],
    });

    const scores = input.finalizedComments.admissionDecisions.map(
      (decision) => decision.score.total,
    );
    const averageScore =
      scores.length > 0
        ? Math.round(
            scores.reduce((sum, value) => sum + value, 0) / scores.length,
          )
        : 0;

    await this.langsmithTraceService.endRun({
      run: trace,
      outputs: {
        candidateCount: input.finalizedComments.beforeGateCount,
        averageScore,
        maxScore: scores.length > 0 ? Math.max(...scores) : 0,
        minScore: scores.length > 0 ? Math.min(...scores) : 0,
      },
    });
  }

  private async traceCommentAdmission(input: {
    reviewJobId: string;
    filePath: string;
    finalizedComments: ReturnType<typeof finalizeFileReviewComments>;
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
  }) {
    const trace = await this.langsmithTraceService.startRun({
      name: "comment-admission",
      runType: "tool",
      parentRun: input.parentRun,
      inputs: {
        candidateCount: input.finalizedComments.beforeGateCount,
        ruleCommentCount: input.finalizedComments.ruleComments.length,
      },
      metadata: {
        reviewJobId: input.reviewJobId,
        filePath: input.filePath,
      },
      tags: ["comment-admission"],
    });

    await this.langsmithTraceService.endRun({
      run: trace,
      outputs: {
        beforeGateCount: input.finalizedComments.beforeGateCount,
        afterGateCount: input.finalizedComments.afterGateCount,
        ruleCommentCount: input.finalizedComments.ruleComments.length,
        duplicateSuppressedCount: input.finalizedComments.duplicateCount,
        suppressedCount:
          input.finalizedComments.beforeGateCount -
          input.finalizedComments.afterGateCount,
      },
    });
  }

  private async traceAggregateSummary(input: {
    reviewJobId: string;
    aggregateResult: ReviewAggregateResult;
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
  }) {
    const trace = await this.langsmithTraceService.startRun({
      name: "final-aggregate-summary",
      runType: "tool",
      parentRun: input.parentRun,
      inputs: {
        fileCount: input.aggregateResult.files.length,
        commentCount: input.aggregateResult.comments.length,
      },
      metadata: {
        reviewJobId: input.reviewJobId,
      },
      tags: ["aggregate-summary"],
    });

    await this.langsmithTraceService.endRun({
      run: trace,
      outputs: {
        mergeRecommendation: input.aggregateResult.summary.mergeRecommendation,
        headline: input.aggregateResult.summary.headline,
        notableFindings: input.aggregateResult.summary.notableFindings,
      },
    });
  }

  private publishReviewJobProgress(reviewJob: ReviewJob) {
    if (!reviewJob.id) {
      return;
    }

    this.reviewEventsService.emitReviewJobProgress({
      eventName: "review_job_progress",
      occurredAt: new Date().toISOString(),
      payload: {
        reviewJobId: reviewJob.id,
        status: reviewJob.status,
        finishedFiles: reviewJob.finishedFiles,
        totalFiles: reviewJob.totalFiles,
        finishedSlices: reviewJob.finishedSlices,
        totalSlices: reviewJob.totalSlices,
      },
    });
  }

  private publishFileReviewCompleted(input: {
    reviewJobId: string;
    fileReview: FileReview;
    comments: ReviewComment[];
  }) {
    this.reviewEventsService.emitFileReviewCompleted({
      eventName: "file_review_completed",
      occurredAt: new Date().toISOString(),
      payload: {
        reviewJobId: input.reviewJobId,
        fileReview: input.fileReview,
        comments: input.comments,
      },
    });
  }

  private async ensureRepositoryConnected(
    repositoryRef: FirstPassReviewRunRequest["repository"],
  ) {
    const existing = await this.repositoryStoreService.findByRef(repositoryRef);
    if (existing) {
      return existing;
    }

    const connected =
      await this.repositoryConnectService.connect(repositoryRef);
    return connected.repository;
  }

  private async ensureRepositoryScanReady(input: {
    repositoryId?: string;
    repository: FirstPassReviewRunRequest["repository"];
    targetSha: string;
    reviewJobId: string;
    parentRun?: Awaited<ReturnType<LangsmithTraceService["startRun"]>>;
  }) {
    if (!input.repositoryId) {
      return;
    }

    const latestDone =
      await this.repositoryScanStoreService.findLatestDoneByRepositoryId(
        input.repositoryId,
      );
    if (latestDone?.targetSha === input.targetSha) {
      return latestDone;
    }

    const scanTrace = await this.langsmithTraceService.startRun({
      name: "ensure-repository-scan",
      runType: "tool",
      parentRun: input.parentRun,
      inputs: {
        repository: input.repository,
        targetSha: input.targetSha,
      },
      metadata: {
        reviewJobId: input.reviewJobId,
      },
      tags: ["repository-scan", "review-preflight"],
    });

    try {
      const trigger = await this.langsmithTraceService.withRunTree(
        scanTrace,
        async () =>
          this.repositoryScanService.trigger(input.repositoryId!, {
            scanType: "full",
            targetSha: input.targetSha,
            requestedBy: "review-job:auto-bootstrap",
          }),
      );
      const finalScan = await this.waitForRepositoryScan(
        input.repositoryId,
        trigger.scan.id!,
      );

      await this.langsmithTraceService.endRun({
        run: scanTrace,
        outputs: {
          scanId: finalScan.id,
          status: finalScan.status,
          deduplicated: trigger.deduplicated,
        },
      });

      return finalScan;
    } catch (error) {
      await this.langsmithTraceService.endRun({
        run: scanTrace,
        error: this.getSafeErrorMessage(error),
      });
      throw error;
    }
  }

  private async waitForRepositoryScan(repositoryId: string, scanId: string) {
    for (let attempt = 0; attempt < AUTO_SCAN_POLL_ATTEMPTS; attempt += 1) {
      const scan = await this.repositoryScanStoreService.findById(
        repositoryId,
        scanId,
      );
      if (!scan) {
        throw new ApiModuleError(
          "SCAN_NOT_FOUND",
          "自动补扫后无法查询到扫描记录，本次审查已终止",
          404,
          {
            repositoryId,
            scanId,
          },
        );
      }

      if (scan.status === "done") {
        return scan;
      }

      if (scan.status === "failed") {
        throw new ApiModuleError(
          "INTERNAL_ERROR",
          "仓库语义扫描失败，本次 PR 审查已终止",
          409,
          {
            repositoryId,
            scanId,
            reason: "repository_scan_failed",
          },
        );
      }

      await sleep(AUTO_SCAN_POLL_INTERVAL_MS);
    }

    throw new ApiModuleError(
      "INTERNAL_ERROR",
      "等待仓库语义扫描完成超时，本次 PR 审查已终止",
      504,
      {
        repositoryId,
        scanId,
        reason: "repository_scan_timeout",
      },
    );
  }

  private getSafeErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    return message
      .split(this.configService.githubToken)
      .join("[REDACTED_GITHUB_TOKEN]")
      .replace(
        /(https?:\/\/)([^/\s:@]+):([^@\s]+)@/g,
        "$1$2:[REDACTED_GITHUB_TOKEN]@",
      )
      .replace(/\bgh[opus]_[A-Za-z0-9_]+\b/g, "[REDACTED_GITHUB_TOKEN]");
  }
}

function toFirstPassRunRequest(
  request: CreateReviewJobRequest,
): FirstPassReviewRunRequest {
  return {
    repository: request.repository,
    prNumber: request.prNumber,
    triggerSource: request.triggerSource,
    ruleScanTimeoutSeconds: 60,
    ruleScanEngines: ["semgrep"],
  };
}

function createDefaultFirstPassBudget(): ContextBudget {
  return {
    maxRounds: 1,
    maxToolCalls: 6,
    maxExtraFiles: 5,
    maxCallDepth: 1,
    maxExtraTokens: 6000,
    usedRounds: 0,
    usedToolCalls: 0,
    usedExtraFiles: 0,
    usedExtraTokens: 0,
  };
}

function pickHighestSeverity(
  violations: Array<{
    severity: HighestSeverity | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  }>,
  candidates: ReviewCommentCandidate[] = [],
): HighestSeverity {
  const severities = [
    ...violations.map((item) => item.severity),
    ...candidates.map((item) => item.severity),
  ];

  if (severities.includes("HIGH")) {
    return "HIGH";
  }
  if (severities.includes("MEDIUM")) {
    return "MEDIUM";
  }
  if (severities.includes("LOW")) {
    return "LOW";
  }
  if (severities.includes("INFO")) {
    return "INFO";
  }
  return "NONE";
}

function mapRiskScore(
  riskLevel: ReviewRiskLevel,
  highestSeverity: HighestSeverity,
): number {
  if (highestSeverity === "HIGH" || riskLevel === "high") {
    return 85;
  }
  if (highestSeverity === "MEDIUM" || riskLevel === "medium") {
    return 60;
  }
  return 25;
}

function createSecondPassFallback(input: {
  firstPass: ReviewTriageDecision;
  contextResult: ContextFetchResult;
}): SecondPassReviewResult {
  if (
    input.contextResult.artifacts.length > 0 &&
    input.firstPass.provisionalFindings.length > 0
  ) {
    return {
      decision: "final_review",
      confidence: Math.max(0.55, input.firstPass.confidence - 0.05),
      rationale:
        "已补充仓库上下文，但二轮模型调用失败，暂回退到首轮候选结论并附带上下文证据。",
      candidateComments: input.firstPass.provisionalFindings.map(
        (candidate) => ({
          ...candidate,
          evidenceRefs: Array.from(
            new Set([
              ...candidate.evidenceRefs,
              ...input.contextResult.artifacts
                .slice(0, 3)
                .map((artifact) => toContextEvidenceRef(artifact)),
            ]),
          ),
        }),
      ),
    };
  }

  return {
    decision: "insufficient_evidence",
    confidence: 0.48,
    rationale: "已执行上下文检索，但未能形成足够稳定的二轮证据，暂不输出评论。",
    candidateComments: [],
  };
}

function toContextEvidenceRef(
  artifact: ContextFetchResult["artifacts"][number],
): string {
  const symbolSuffix = artifact.symbolName ? `#${artifact.symbolName}` : "";
  return `context:${artifact.toolName}:${artifact.filePath}${symbolSuffix}`;
}

function discoverSemgrepConfigs(repositoryPath: string): string[] {
  const candidates = [
    ".semgrep.yml",
    ".semgrep.yaml",
    "semgrep.yml",
    "semgrep.yaml",
  ];

  return candidates
    .map((candidate) => `${repositoryPath}/${candidate}`)
    .filter((candidate) => existsSync(candidate));
}

function discoverModuleRuleConfigs(
  repositoryPath: string,
): Record<string, string> {
  const candidates = [
    ["apps", `${repositoryPath}/apps/.semgrep.yml`],
    ["packages", `${repositoryPath}/packages/.semgrep.yml`],
  ] as const;

  return Object.fromEntries(
    candidates.filter(([, target]) => existsSync(target)),
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
