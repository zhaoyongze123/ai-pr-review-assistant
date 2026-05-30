import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { ReviewToolsController } from "./review-tools.controller.js";
import { ContextFetcherService } from "./modules/context/context-fetcher.service.js";
import { CommentAdmissionGateService } from "./modules/quality-gates/comment-admission-gate.service.js";
import { QualityScoringService } from "./modules/quality-gates/quality-scoring.service.js";
import { ReviewTriageService } from "./modules/triage/review-triage.service.js";

@Module({
  controllers: [HealthController, ReviewToolsController],
  providers: [
    ContextFetcherService,
    CommentAdmissionGateService,
    QualityScoringService,
    ReviewTriageService,
  ],
})
export class AppModule {}
