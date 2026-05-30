import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { ContextFetcherService } from "./modules/context/context-fetcher.service.js";
import { ApiConfigService } from "./modules/repositories/api-config.service.js";
import { GitHubClientService } from "./modules/repositories/github-client.service.js";
import { RepositoriesController } from "./modules/repositories/repositories.controller.js";
import { RepositoryConnectService } from "./modules/repositories/repository-connect.service.js";
import { RepositoryStoreService } from "./modules/repositories/repository-store.service.js";
import { CommentAdmissionGateService } from "./modules/quality-gates/comment-admission-gate.service.js";
import { QualityScoringService } from "./modules/quality-gates/quality-scoring.service.js";
import { ReviewToolsController } from "./review-tools.controller.js";
import { ReviewTriageService } from "./modules/triage/review-triage.service.js";

@Module({
  controllers: [
    HealthController,
    ReviewToolsController,
    RepositoriesController,
  ],
  providers: [
    ApiConfigService,
    ContextFetcherService,
    CommentAdmissionGateService,
    GitHubClientService,
    QualityScoringService,
    RepositoryConnectService,
    RepositoryStoreService,
    ReviewTriageService,
  ],
})
export class AppModule {}
