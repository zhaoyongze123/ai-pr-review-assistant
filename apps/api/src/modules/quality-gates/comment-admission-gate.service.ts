import { Injectable } from "@nestjs/common";
import { evaluateCommentAdmission } from "@ai-pr-review/review-core";
import type {
  CommentAdmissionDecision,
  ReviewCommentCandidate,
} from "@ai-pr-review/shared-types";

@Injectable()
export class CommentAdmissionGateService {
  evaluate(candidate: ReviewCommentCandidate): CommentAdmissionDecision {
    return evaluateCommentAdmission(candidate);
  }
}
