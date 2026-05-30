import {
  type CommentAdmissionDecision,
  CommentAdmissionDecisionSchema,
  type ReviewCommentCandidate,
  ReviewCommentCandidateSchema,
} from "@ai-pr-review/shared-types";
import { scoreCommentCandidate } from "./quality-scoring.js";

export function evaluateCommentAdmission(
  candidateInput: ReviewCommentCandidate,
): CommentAdmissionDecision {
  const candidate = ReviewCommentCandidateSchema.parse(candidateInput);
  const score = scoreCommentCandidate(candidate);
  const reasons: string[] = [];

  if (!candidate.diffLineRef) {
    reasons.push("缺少 diff_line_ref，无法稳定锚定到代码行");
  }

  if (candidate.evidenceRefs.length === 0) {
    reasons.push("缺少 evidence_refs，无法回溯证据链");
  }

  if (!/(如果|当|会导致|导致|when|if)/i.test(candidate.message)) {
    reasons.push("消息没有明确说明故障条件或影响方式");
  }

  if ((candidate.confidence ?? 0.5) < 0.55) {
    reasons.push("模型置信度低于默认准入阈值 0.55");
  }

  if (candidate.message.trim().length < 24) {
    reasons.push("消息过短，无法支撑开发者做出准确判断");
  }

  if (score.total < 65) {
    reasons.push("质量分低于默认准入阈值 65");
  }

  return CommentAdmissionDecisionSchema.parse({
    admitted: reasons.length === 0,
    reasons,
    score,
    normalizedCandidate: candidate,
  });
}
