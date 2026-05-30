import {
  createContextFetchPlan,
  evaluateCommentAdmission,
  evaluateReviewTriage,
  scoreCommentCandidate,
} from "@ai-pr-review/review-core";
import type {
  ContextBudget,
  ContextFetchResult,
  ReviewCommentCandidate,
  ReviewTriageDecision,
} from "@ai-pr-review/shared-types";

export interface ReviewPipelineResult {
  triage: ReturnType<typeof evaluateReviewTriage>;
  contextPlan?: ContextFetchResult;
  scoredFindings: Array<{
    candidate: ReviewCommentCandidate;
    qualityScore: ReturnType<typeof scoreCommentCandidate>;
    admission: ReturnType<typeof evaluateCommentAdmission>;
  }>;
}

export function runReviewPipeline(
  decision: ReviewTriageDecision,
  budget: ContextBudget,
): ReviewPipelineResult {
  const triage = evaluateReviewTriage(decision, budget);
  const scoredFindings = (decision.provisionalFindings ?? []).map(
    (candidate) => ({
      candidate,
      qualityScore: scoreCommentCandidate(candidate),
      admission: evaluateCommentAdmission(candidate),
    }),
  );

  if (triage.action !== "fetch_more_context" || !decision.contextRequest) {
    return {
      triage,
      scoredFindings,
    };
  }

  return {
    triage,
    contextPlan: createContextFetchPlan(decision.contextRequest, budget),
    scoredFindings,
  };
}
