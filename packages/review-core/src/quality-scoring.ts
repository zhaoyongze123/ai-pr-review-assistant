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
];

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
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
    (/(如果|当|会导致|导致|when|if)/i.test(candidate.message) ? 55 : 20) +
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

  const novelty = clamp(candidate.duplicateFingerprint ? 25 : 90);

  const noisePenalty = clamp(
    LOW_SIGNAL_PATTERNS.reduce(
      (sum, pattern) => sum + (normalizedMessage.includes(pattern) ? 18 : 0),
      0,
    ) +
      (candidate.category === "style" ? 20 : 0) +
      ((candidate.confidence ?? 0.5) < 0.5 ? 15 : 0),
  );

  const total = clamp(
    evidenceStrength * 0.3 +
      impactClarity * 0.25 +
      actionability * 0.2 +
      specificity * 0.15 +
      novelty * 0.1 -
      noisePenalty,
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
