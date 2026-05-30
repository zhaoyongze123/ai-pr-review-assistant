import {
  type ContextBudget,
  ContextBudgetSchema,
  type ReviewTriageDecision,
  ReviewTriageDecisionSchema,
  type TriageEvaluation,
  TriageEvaluationSchema,
} from "@ai-pr-review/shared-types";

export function evaluateReviewTriage(
  decisionInput: ReviewTriageDecision,
  budgetInput: ContextBudget,
): TriageEvaluation {
  const decision = ReviewTriageDecisionSchema.parse(decisionInput);
  const budget = ContextBudgetSchema.parse(budgetInput);
  const reasons: string[] = [];

  switch (decision.decision) {
    case "final_review":
      reasons.push("首轮判断证据充分，可以进入最终评论生成或空结果输出");
      return TriageEvaluationSchema.parse({
        action: "accept_final_review",
        reasons,
        remainingBudget: budget,
      });
    case "no_issue":
      reasons.push("首轮判断证据充分且没有发现值得开发者处理的问题");
      return TriageEvaluationSchema.parse({
        action: "accept_no_issue",
        reasons,
        remainingBudget: budget,
      });
    case "insufficient_evidence":
      reasons.push("模型明确表示证据不足，系统不应强迫其继续猜测");
      return TriageEvaluationSchema.parse({
        action: "accept_insufficient_evidence",
        reasons,
        remainingBudget: budget,
      });
    case "need_more_context":
      if (budget.usedRounds >= budget.maxRounds) {
        reasons.push("已达到最大上下文轮次，拒绝继续检索");
        return TriageEvaluationSchema.parse({
          action: "reject_due_to_budget",
          reasons,
          remainingBudget: budget,
        });
      }

      if (!decision.contextRequest) {
        reasons.push("模型请求更多上下文，但没有提供结构化 ContextRequest");
        return TriageEvaluationSchema.parse({
          action: "reject_due_to_budget",
          reasons,
          remainingBudget: budget,
        });
      }

      reasons.push("存在潜在高价值问题，但需要额外仓库证据支撑");
      return TriageEvaluationSchema.parse({
        action: "fetch_more_context",
        reasons,
        remainingBudget: budget,
      });
  }
}
