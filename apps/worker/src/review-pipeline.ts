// Worker 只保留兼容导出，真实首轮审查纯逻辑已经上移到 review-core，
// 这样 API、Worker 与后续评估脚本都能复用同一套 first-pass 行为。
export {
  runFirstPassReviewPipeline,
  runReviewPipeline,
  type FirstPassReviewInput,
  type FirstPassReviewPipelineResult,
  type ReviewPipelineResult,
} from "@ai-pr-review/review-core";
