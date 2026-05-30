import { Injectable } from "@nestjs/common";
import { scoreCommentCandidate } from "@ai-pr-review/review-core";
import type {
  QualityScoreBreakdown,
  ReviewCommentCandidate,
} from "@ai-pr-review/shared-types";

@Injectable()
export class QualityScoringService {
  score(candidate: ReviewCommentCandidate): QualityScoreBreakdown {
    return scoreCommentCandidate(candidate);
  }
}
