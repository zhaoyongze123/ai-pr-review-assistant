import {
  type QualityScoreBreakdown,
  QualityScoreBreakdownSchema,
  type ReviewCommentCandidate,
  ReviewCommentCandidateSchema,
} from "@ai-pr-review/shared-types";

const LOW_SIGNAL_PATTERNS = [
  "可以考虑",
  "建议优化",
  "增强可读性",
  "潜在风险",
  "最好补一下日志",
  "建议增加校验",
  "建议关注",
  "需要确认一下",
  "可能有问题",
  "也许可以",
  "注意一下",
];

const IMPACT_SIGNAL_PATTERN =
  /(如果|当|一旦|会导致|导致|when|if|意味着|暴露|泄露|绕过|误判|失败|阻塞|占用|伪造|越权|风险)/i;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function hasClearImpactSignal(message: string) {
  return IMPACT_SIGNAL_PATTERN.test(message);
}

export function scoreCommentCandidate(
  candidateInput: ReviewCommentCandidate,
): QualityScoreBreakdown {
  const candidate = ReviewCommentCandidateSchema.parse(candidateInput);
  const normalizedMessage = `${candidate.title} ${candidate.message} ${candidate.suggestion ?? ""}`;

  const evidenceStrength = clamp(
    (candidate.diffLineRef ? 35 : 0) +
      Math.min(candidate.evidenceRefs.length * 18, 45) +
      (candidate.lineRefs.length > 0 ? 10 : 0),
  );

  const impactClarity = clamp(
    (hasClearImpactSignal(candidate.message) ? 55 : 20) +
      (candidate.severity === "HIGH"
        ? 25
        : candidate.severity === "MEDIUM"
          ? 15
          : 5),
  );

  const actionability = clamp(
    (candidate.suggestion ? 55 : 10) +
      (candidate.suggestion && candidate.suggestion.length >= 12 ? 25 : 0),
  );

  const specificity = clamp(
    (candidate.title.length >= 8 ? 30 : 10) +
      (candidate.message.length >= 40 ? 30 : 10) +
      (candidate.diffLineRef ? 20 : 0) +
      (candidate.category !== "style" ? 20 : 0),
  );

  const novelty = clamp(
    (candidate.duplicateFingerprint ? 70 : 55) +
      (candidate.evidenceRefs.length >= 2 ? 10 : 0) +
      (candidate.title.length >= 14 ? 10 : 0),
  );

  const noisePenalty = clamp(
    LOW_SIGNAL_PATTERNS.reduce(
      (sum, pattern) => sum + (normalizedMessage.includes(pattern) ? 18 : 0),
      0,
    ) +
      (candidate.category === "style" ? 20 : 0) +
      ((candidate.confidence ?? 0.5) < 0.55 ? 15 : 0) +
      (candidate.message.length < 24 ? 12 : 0),
  );

  const total = clamp(
    evidenceStrength * 0.28 +
      impactClarity * 0.24 +
      actionability * 0.18 +
      specificity * 0.18 +
      novelty * 0.12 -
      noisePenalty * 0.35,
  );

  return QualityScoreBreakdownSchema.parse({
    evidenceStrength,
    impactClarity,
    actionability,
    specificity,
    novelty,
    noisePenalty,
    total,
  });
}
