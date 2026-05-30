import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { ContextFetchLogStoreService } from "./modules/context/context-fetch-log-store.service.js";
import { ContextFetcherService } from "./modules/context/context-fetcher.service.js";
import { RepositoryContextStoreService } from "./modules/context/repository-context-store.service.js";
import { ApiConfigService } from "./modules/repositories/api-config.service.js";
import { GitHubClientService } from "./modules/repositories/github-client.service.js";
import { RepositoriesController } from "./modules/repositories/repositories.controller.js";
import { RepositoryConnectService } from "./modules/repositories/repository-connect.service.js";
import { RepositoryStoreService } from "./modules/repositories/repository-store.service.js";
import { CommentAdmissionGateService } from "./modules/quality-gates/comment-admission-gate.service.js";
import { QualityScoringService } from "./modules/quality-gates/quality-scoring.service.js";
import { FirstPassReviewService } from "./modules/reviews/first-pass-review.service.js";
import { FileReviewStoreService } from "./modules/reviews/file-review-store.service.js";
import { LangsmithTraceService } from "./modules/reviews/langsmith-trace.service.js";
import { LlmCallLogStoreService } from "./modules/reviews/llm-call-log-store.service.js";
import { PullRequestStoreService } from "./modules/reviews/pull-request-store.service.js";
import { ReviewJobStoreService } from "./modules/reviews/review-job-store.service.js";
import { RuleEngineClientService } from "./modules/reviews/rule-engine-client.service.js";
import { SemanticRetrievalController } from "./modules/retrieval/semantic-retrieval.controller.js";
import { SemanticRetrievalService } from "./modules/retrieval/semantic-retrieval.service.js";
import { SemanticRetrievalStoreService } from "./modules/retrieval/semantic-retrieval-store.service.js";
import { RepositoryScanEventStoreService } from "./modules/scans/repository-scan-event-store.service.js";
import { RepositoryScanQueueService } from "./modules/scans/repository-scan-queue.service.js";
import { RepositoryScanService } from "./modules/scans/repository-scan.service.js";
import { RepositoryScanStoreService } from "./modules/scans/repository-scan-store.service.js";
import { RepositoryScansController } from "./modules/scans/repository-scans.controller.js";
import { ReviewToolsController } from "./review-tools.controller.js";
import { ReviewTriageService } from "./modules/triage/review-triage.service.js";

@Module({
  controllers: [
    HealthController,
    ReviewToolsController,
    RepositoriesController,
    RepositoryScansController,
    SemanticRetrievalController,
  ],
  providers: [
    ApiConfigService,
    ContextFetchLogStoreService,
    ContextFetcherService,
    CommentAdmissionGateService,
    GitHubClientService,
    FirstPassReviewService,
    FileReviewStoreService,
    QualityScoringService,
    LangsmithTraceService,
    LlmCallLogStoreService,
    PullRequestStoreService,
    RepositoryConnectService,
    RuleEngineClientService,
    ReviewJobStoreService,
    SemanticRetrievalService,
    SemanticRetrievalStoreService,
    RepositoryScanEventStoreService,
    RepositoryScanQueueService,
    RepositoryScanService,
    RepositoryScanStoreService,
    RepositoryContextStoreService,
    RepositoryStoreService,
    ReviewTriageService,
  ],
})
export class AppModule {}
