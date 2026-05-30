import { Injectable } from "@nestjs/common";
import { evaluateReviewTriage } from "@ai-pr-review/review-core";
import type {
  ContextBudget,
  ReviewTriageDecision,
  TriageEvaluation,
} from "@ai-pr-review/shared-types";

@Injectable()
export class ReviewTriageService {
  evaluate(
    decision: ReviewTriageDecision,
    budget: ContextBudget,
  ): TriageEvaluation {
    return evaluateReviewTriage(decision, budget);
  }
}
