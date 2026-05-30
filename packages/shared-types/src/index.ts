import { z } from "zod";

const UuidSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const MetadataSchema = z.record(z.string(), z.unknown());
const NonEmptyStringSchema = z.string().min(1);

// 基础枚举和通用值类型。这里优先约束稳定字段，避免跨模块各自发明状态名。
export const RepositoryProviderSchema = z.enum(["github"]);
export type RepositoryProvider = z.infer<typeof RepositoryProviderSchema>;

export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "done",
  "failed",
  "canceled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const RepositoryScanTypeSchema = z.enum(["full", "incremental"]);
export type RepositoryScanType = z.infer<typeof RepositoryScanTypeSchema>;

export const RepositoryFileKindSchema = z.enum([
  "source",
  "test",
  "doc",
  "config",
  "schema",
  "asset",
  "unknown",
]);
export type RepositoryFileKind = z.infer<typeof RepositoryFileKindSchema>;

export const SymbolKindSchema = z.enum([
  "function",
  "class",
  "method",
  "interface",
  "type",
  "enum",
  "variable",
  "module",
  "route",
]);
export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const SymbolEdgeTypeSchema = z.enum([
  "imports",
  "calls",
  "references",
  "tests",
  "defines",
  "extends",
  "implements",
]);
export type SymbolEdgeType = z.infer<typeof SymbolEdgeTypeSchema>;

export const SemanticDocumentTypeSchema = z.enum([
  "readme",
  "doc",
  "adr",
  "module_summary",
  "api_doc",
  "config_note",
]);
export type SemanticDocumentType = z.infer<typeof SemanticDocumentTypeSchema>;

export const PullRequestStateSchema = z.enum(["open", "closed", "merged"]);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

export const PullRequestFileStatusSchema = z.enum([
  "added",
  "modified",
  "removed",
  "renamed",
]);
export type PullRequestFileStatus = z.infer<typeof PullRequestFileStatusSchema>;

export const ReviewTriggerSourceSchema = z.enum(["manual", "webhook", "retry"]);
export type ReviewTriggerSource = z.infer<typeof ReviewTriggerSourceSchema>;

export const ReviewCommentSourceSchema = z.enum(["ai", "rule", "human"]);
export type ReviewCommentSource = z.infer<typeof ReviewCommentSourceSchema>;

export const ReviewSeveritySchema = z.enum(["HIGH", "MEDIUM", "LOW", "INFO"]);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const HighestSeveritySchema = z.enum([
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
  "NONE",
]);
export type HighestSeverity = z.infer<typeof HighestSeveritySchema>;

export const ReviewCategorySchema = z.enum([
  "security",
  "bug",
  "performance",
  "concurrency",
  "style",
  "maintainability",
  "testing",
]);
export type ReviewCategory = z.infer<typeof ReviewCategorySchema>;

export const ReviewRiskLevelSchema = z.enum(["low", "medium", "high"]);
export type ReviewRiskLevel = z.infer<typeof ReviewRiskLevelSchema>;

export const ReviewDecisionSchema = z.enum([
  "final_review",
  "need_more_context",
  "no_issue",
  "insufficient_evidence",
]);
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export const MergeRecommendationSchema = z.enum([
  "approve",
  "comment",
  "request_changes",
  "blocked",
  "insufficient_evidence",
]);
export type MergeRecommendation = z.infer<typeof MergeRecommendationSchema>;

export const ContextRelationSchema = z.enum([
  "definition",
  "caller",
  "callee",
  "test",
  "schema",
  "config",
]);
export type ContextRelation = z.infer<typeof ContextRelationSchema>;

export const ContextToolNameSchema = z.enum([
  "find_symbol_definition",
  "find_callers",
  "find_callees",
  "read_file_snippet",
  "find_related_tests",
  "find_schema_or_migration",
  "read_config_or_feature_flag",
]);
export type ContextToolName = z.infer<typeof ContextToolNameSchema>;

export const ContextFetchStatusSchema = z.enum([
  "planned",
  "rejected",
  "budget_exceeded",
  "skipped",
]);
export type ContextFetchStatus = z.infer<typeof ContextFetchStatusSchema>;

export const ReviewEventNameSchema = z.enum([
  "repository_scan_started",
  "repository_scan_completed",
  "repository_scan_failed",
  "review_job_started",
  "review_job_progress",
  "file_review_started",
  "file_review_completed",
  "review_job_completed",
  "review_job_failed",
]);
export type ReviewEventName = z.infer<typeof ReviewEventNameSchema>;

// 仓库接入与语义地图相关契约。这一段给扫描链路和结构化索引使用。
export const LanguageSummarySchema = z.object({
  language: NonEmptyStringSchema,
  fileCount: z.number().int().nonnegative(),
  estimatedLines: z.number().int().nonnegative().default(0),
});
export type LanguageSummary = z.infer<typeof LanguageSummarySchema>;

export const RepositoryRefSchema = z.object({
  provider: RepositoryProviderSchema.default("github"),
  owner: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
});
export type RepositoryRef = z.infer<typeof RepositoryRefSchema>;

export const RepositorySchema = RepositoryRefSchema.extend({
  id: UuidSchema.optional(),
  defaultBranch: NonEmptyStringSchema,
  cloneUrl: z.string().url(),
  isActive: z.boolean().default(true),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type Repository = z.infer<typeof RepositorySchema>;

export const RepositoryConnectRequestSchema = RepositoryRefSchema.extend({
  installationId: z.number().int().positive().optional(),
  defaultBranchHint: NonEmptyStringSchema.optional(),
});
export type RepositoryConnectRequest = z.infer<
  typeof RepositoryConnectRequestSchema
>;

export const RepositoryConnectResponseSchema = z.object({
  repository: RepositorySchema,
  accepted: z.boolean(),
});
export type RepositoryConnectResponse = z.infer<
  typeof RepositoryConnectResponseSchema
>;

export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "GITHUB_UNAUTHORIZED",
  "REPOSITORY_NOT_FOUND",
  "REPOSITORY_FORBIDDEN",
  "SCAN_NOT_FOUND",
  "DATABASE_ERROR",
  "REDIS_ERROR",
  "INTERNAL_ERROR",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: NonEmptyStringSchema,
    details: MetadataSchema.optional(),
  }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const REPOSITORY_SCAN_QUEUE_NAME = "repository-scan";

export const RepositoryScanRequestSchema = z.object({
  repositoryId: UuidSchema,
  scanType: RepositoryScanTypeSchema.default("full"),
  targetSha: NonEmptyStringSchema.optional(),
  requestedBy: NonEmptyStringSchema.optional(),
});
export type RepositoryScanRequest = z.infer<typeof RepositoryScanRequestSchema>;

export const RepositoryScanTriggerRequestSchema = z.object({
  scanType: RepositoryScanTypeSchema.default("full"),
  targetSha: NonEmptyStringSchema.optional(),
  requestedBy: NonEmptyStringSchema.optional(),
});
export type RepositoryScanTriggerRequest = z.infer<
  typeof RepositoryScanTriggerRequestSchema
>;

export const RepositoryScanSchema = z.object({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema,
  scanType: RepositoryScanTypeSchema,
  targetSha: NonEmptyStringSchema,
  status: JobStatusSchema,
  languageSummary: z.array(LanguageSummarySchema).default([]),
  frameworkSummary: z.array(NonEmptyStringSchema).default([]),
  startedAt: TimestampSchema.optional(),
  finishedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type RepositoryScan = z.infer<typeof RepositoryScanSchema>;

export const RepositoryScanTriggerResponseSchema = z.object({
  scan: RepositoryScanSchema,
  queued: z.boolean(),
  deduplicated: z.boolean(),
});
export type RepositoryScanTriggerResponse = z.infer<
  typeof RepositoryScanTriggerResponseSchema
>;

export const RepositoryScanJobPayloadSchema = z.object({
  scanId: UuidSchema,
  repositoryId: UuidSchema,
  scanType: RepositoryScanTypeSchema,
  targetSha: NonEmptyStringSchema,
  requestedBy: NonEmptyStringSchema.optional(),
});
export type RepositoryScanJobPayload = z.infer<
  typeof RepositoryScanJobPayloadSchema
>;

export const RepositoryFileSchema = z.object({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema,
  scanId: UuidSchema,
  filePath: NonEmptyStringSchema,
  language: NonEmptyStringSchema,
  kind: RepositoryFileKindSchema,
  moduleName: NonEmptyStringSchema.optional(),
  summary: NonEmptyStringSchema.optional(),
  riskTags: z.array(NonEmptyStringSchema).default([]),
  checksum: NonEmptyStringSchema.optional(),
  metadata: MetadataSchema.optional(),
});
export type RepositoryFile = z.infer<typeof RepositoryFileSchema>;

export const RepositoryScanStartedEventSchema = z.object({
  eventName: z.literal("repository_scan_started"),
  occurredAt: TimestampSchema,
  payload: z.object({
    repositoryId: UuidSchema,
    scanId: UuidSchema,
    targetSha: NonEmptyStringSchema,
    status: z.literal("running"),
  }),
});
export type RepositoryScanStartedEvent = z.infer<
  typeof RepositoryScanStartedEventSchema
>;

export const RepositoryScanCompletedEventSchema = z.object({
  eventName: z.literal("repository_scan_completed"),
  occurredAt: TimestampSchema,
  payload: z.object({
    repositoryId: UuidSchema,
    scanId: UuidSchema,
    targetSha: NonEmptyStringSchema,
    status: z.literal("done"),
    fileCount: z.number().int().nonnegative(),
    symbolCount: z.number().int().nonnegative(),
    semanticDocumentCount: z.number().int().nonnegative(),
  }),
});
export type RepositoryScanCompletedEvent = z.infer<
  typeof RepositoryScanCompletedEventSchema
>;

export const RepositoryScanFailedEventSchema = z.object({
  eventName: z.literal("repository_scan_failed"),
  occurredAt: TimestampSchema,
  payload: z.object({
    repositoryId: UuidSchema,
    scanId: UuidSchema,
    targetSha: NonEmptyStringSchema,
    status: z.literal("failed"),
    errorMessage: NonEmptyStringSchema,
  }),
});
export type RepositoryScanFailedEvent = z.infer<
  typeof RepositoryScanFailedEventSchema
>;

export const RepositoryScanEventSchema = z.discriminatedUnion("eventName", [
  RepositoryScanStartedEventSchema,
  RepositoryScanCompletedEventSchema,
  RepositoryScanFailedEventSchema,
]);
export type RepositoryScanEvent = z.infer<typeof RepositoryScanEventSchema>;

export const RepositoryScanStatusResponseSchema = z.object({
  scan: RepositoryScanSchema,
  events: z.array(RepositoryScanEventSchema).default([]),
});
export type RepositoryScanStatusResponse = z.infer<
  typeof RepositoryScanStatusResponseSchema
>;

export const SymbolSchema = z.object({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema,
  scanId: UuidSchema,
  filePath: NonEmptyStringSchema,
  symbolName: NonEmptyStringSchema,
  qualifiedName: NonEmptyStringSchema,
  kind: SymbolKindSchema,
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  signature: NonEmptyStringSchema.optional(),
  moduleName: NonEmptyStringSchema.optional(),
  riskTags: z.array(NonEmptyStringSchema).default([]),
  metadata: MetadataSchema.optional(),
});
export type Symbol = z.infer<typeof SymbolSchema>;

export const SymbolEdgeSchema = z.object({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema,
  scanId: UuidSchema,
  fromQualifiedName: NonEmptyStringSchema,
  toQualifiedName: NonEmptyStringSchema,
  edgeType: SymbolEdgeTypeSchema,
  metadata: MetadataSchema.optional(),
});
export type SymbolEdge = z.infer<typeof SymbolEdgeSchema>;

export const SemanticDocumentSchema = z.object({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema,
  scanId: UuidSchema,
  sourcePath: NonEmptyStringSchema,
  documentType: SemanticDocumentTypeSchema,
  chunkIndex: z.number().int().nonnegative(),
  title: NonEmptyStringSchema.optional(),
  moduleName: NonEmptyStringSchema.optional(),
  content: NonEmptyStringSchema,
  tags: z.array(NonEmptyStringSchema).default([]),
  metadata: MetadataSchema.default({}),
});
export type SemanticDocument = z.infer<typeof SemanticDocumentSchema>;

export const SemanticSearchResultSchema = z.object({
  document: SemanticDocumentSchema,
  score: z.number(),
});
export type SemanticSearchResult = z.infer<typeof SemanticSearchResultSchema>;

export const SemanticSearchRequestSchema = z.object({
  query: NonEmptyStringSchema,
  moduleName: NonEmptyStringSchema.optional(),
  documentTypes: z.array(SemanticDocumentTypeSchema).default([]),
  limit: z.number().int().positive().max(20).default(5),
});
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;

export const SemanticSearchResponseSchema = z.object({
  repositoryId: UuidSchema,
  query: NonEmptyStringSchema,
  results: z.array(SemanticSearchResultSchema).default([]),
});
export type SemanticSearchResponse = z.infer<
  typeof SemanticSearchResponseSchema
>;

export const RepositorySemanticMapSchema = z.object({
  repository: RepositorySchema,
  latestScan: RepositoryScanSchema,
  files: z.array(RepositoryFileSchema).default([]),
  symbols: z.array(SymbolSchema).default([]),
  edges: z.array(SymbolEdgeSchema).default([]),
  semanticDocuments: z.array(SemanticDocumentSchema).default([]),
});
export type RepositorySemanticMap = z.infer<typeof RepositorySemanticMapSchema>;

// PR 拉取和 diff 解析契约。这一段是 GitHub Fetcher 和 Diff Core 的共享面。
export const PullRequestFileSchema = z.object({
  filePath: NonEmptyStringSchema,
  previousFilePath: NonEmptyStringSchema.optional(),
  status: PullRequestFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: NonEmptyStringSchema.optional(),
  language: NonEmptyStringSchema.optional(),
});
export type PullRequestFile = z.infer<typeof PullRequestFileSchema>;

export const PullRequestSchema = RepositoryRefSchema.extend({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema.optional(),
  prNumber: z.number().int().positive(),
  title: NonEmptyStringSchema,
  authorLogin: NonEmptyStringSchema.optional(),
  baseBranch: NonEmptyStringSchema,
  headBranch: NonEmptyStringSchema,
  baseSha: NonEmptyStringSchema,
  headSha: NonEmptyStringSchema,
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  state: PullRequestStateSchema,
  files: z.array(PullRequestFileSchema).default([]),
  rawPayload: MetadataSchema.optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const CreateReviewJobRequestSchema = z.object({
  repository: RepositoryRefSchema,
  prNumber: z.number().int().positive(),
  triggerSource: ReviewTriggerSourceSchema.default("manual"),
  requestedBy: NonEmptyStringSchema.optional(),
});
export type CreateReviewJobRequest = z.infer<
  typeof CreateReviewJobRequestSchema
>;

export const CreateReviewJobResponseSchema = z.object({
  reviewJobId: UuidSchema,
  status: JobStatusSchema,
});
export type CreateReviewJobResponse = z.infer<
  typeof CreateReviewJobResponseSchema
>;

export const DiffLineSchema = z.object({
  ref: NonEmptyStringSchema,
  lineType: z.enum(["add", "remove", "context"]),
  oldLineNumber: z.number().int().positive().optional(),
  newLineNumber: z.number().int().positive().optional(),
  content: z.string(),
});
export type DiffLine = z.infer<typeof DiffLineSchema>;

export const DiffLineRefMapEntrySchema = z.object({
  hunkId: NonEmptyStringSchema,
  lineType: z.enum(["add", "remove", "context"]),
  oldLineNumber: z.number().int().positive().optional(),
  newLineNumber: z.number().int().positive().optional(),
});
export type DiffLineRefMapEntry = z.infer<typeof DiffLineRefMapEntrySchema>;

export const DiffHunkSchema = z.object({
  hunkId: NonEmptyStringSchema,
  header: NonEmptyStringSchema,
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  lines: z.array(DiffLineSchema).default([]),
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const DiffParseResultSchema = z.object({
  filePath: NonEmptyStringSchema,
  language: NonEmptyStringSchema.optional(),
  hunks: z.array(DiffHunkSchema).default([]),
  lineRefMap: z
    .record(NonEmptyStringSchema, DiffLineRefMapEntrySchema)
    .default({}),
  totalAddedLines: z.number().int().nonnegative(),
  totalRemovedLines: z.number().int().nonnegative(),
});
export type DiffParseResult = z.infer<typeof DiffParseResultSchema>;

// Review Pipeline 契约。这里描述规则结果、triage、上下文请求和候选评论。
export const RiskSignalsSchema = z.object({
  touchesAuth: z.boolean(),
  touchesTransaction: z.boolean(),
  touchesCache: z.boolean(),
  touchesRetry: z.boolean(),
  touchesFeatureFlag: z.boolean(),
  touchesSchema: z.boolean(),
});
export type RiskSignals = z.infer<typeof RiskSignalsSchema>;

export const RuleViolationSchema = z.object({
  source: z.literal("rule"),
  engine: z.enum(["semgrep", "eslint"]),
  ruleId: NonEmptyStringSchema,
  filePath: NonEmptyStringSchema,
  severity: ReviewSeveritySchema,
  category: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  suggestion: NonEmptyStringSchema.optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  metadata: MetadataSchema.optional(),
});
export type RuleViolation = z.infer<typeof RuleViolationSchema>;

export const ContextBudgetSchema = z.object({
  maxRounds: z.number().int().nonnegative(),
  maxToolCalls: z.number().int().nonnegative(),
  maxExtraFiles: z.number().int().nonnegative(),
  maxCallDepth: z.number().int().nonnegative(),
  maxExtraTokens: z.number().int().nonnegative(),
  usedRounds: z.number().int().nonnegative().default(0),
  usedToolCalls: z.number().int().nonnegative().default(0),
  usedExtraFiles: z.number().int().nonnegative().default(0),
  usedExtraTokens: z.number().int().nonnegative().default(0),
});
export type ContextBudget = z.infer<typeof ContextBudgetSchema>;

export const ReviewCommentCandidateSchema = z.object({
  diffLineRef: NonEmptyStringSchema.optional(),
  lineRefs: z.array(NonEmptyStringSchema).default([]),
  severity: ReviewSeveritySchema,
  category: ReviewCategorySchema,
  title: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  suggestion: NonEmptyStringSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  duplicateFingerprint: NonEmptyStringSchema.optional(),
});
export type ReviewCommentCandidate = z.infer<
  typeof ReviewCommentCandidateSchema
>;

export const EvidenceCoverageSchema = z.object({
  modifiedSymbol: z.boolean(),
  localContext: z.boolean(),
  callers: z.boolean(),
  callees: z.boolean(),
  tests: z.boolean(),
  schema: z.boolean(),
});
export type EvidenceCoverage = z.infer<typeof EvidenceCoverageSchema>;

export const ContextRequestSchema = z.object({
  reason: NonEmptyStringSchema,
  symbols: z.array(NonEmptyStringSchema).default([]),
  files: z.array(NonEmptyStringSchema).default([]),
  callersOf: z.array(NonEmptyStringSchema).default([]),
  calleesOf: z.array(NonEmptyStringSchema).default([]),
  tests: z.array(NonEmptyStringSchema).default([]),
  schemaTargets: z.array(NonEmptyStringSchema).default([]),
});
export type ContextRequest = z.infer<typeof ContextRequestSchema>;

export const ReviewTriageDecisionSchema = z.object({
  decision: ReviewDecisionSchema,
  confidence: z.number().min(0).max(1),
  riskLevel: ReviewRiskLevelSchema,
  rationale: NonEmptyStringSchema.optional(),
  evidenceCoverage: EvidenceCoverageSchema,
  provisionalFindings: z.array(ReviewCommentCandidateSchema).default([]),
  contextRequest: ContextRequestSchema.optional(),
});
export type ReviewTriageDecision = z.infer<typeof ReviewTriageDecisionSchema>;

export const ContextArtifactSchema = z.object({
  toolName: ContextToolNameSchema,
  relation: ContextRelationSchema.optional(),
  filePath: NonEmptyStringSchema,
  symbolName: NonEmptyStringSchema.optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  preview: NonEmptyStringSchema,
});
export type ContextArtifact = z.infer<typeof ContextArtifactSchema>;

export const PlannedToolCallSchema = z.object({
  toolName: ContextToolNameSchema,
  query: NonEmptyStringSchema,
  estimatedFiles: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
});
export type PlannedToolCall = z.infer<typeof PlannedToolCallSchema>;

export const ContextFetchResultSchema = z.object({
  status: ContextFetchStatusSchema,
  reason: NonEmptyStringSchema,
  plannedCalls: z.array(PlannedToolCallSchema).default([]),
  artifacts: z.array(ContextArtifactSchema).default([]),
  remainingBudget: ContextBudgetSchema,
});
export type ContextFetchResult = z.infer<typeof ContextFetchResultSchema>;

export const QualityScoreBreakdownSchema = z.object({
  evidenceStrength: z.number().min(0).max(100),
  impactClarity: z.number().min(0).max(100),
  actionability: z.number().min(0).max(100),
  specificity: z.number().min(0).max(100),
  novelty: z.number().min(0).max(100),
  noisePenalty: z.number().min(0).max(100),
  total: z.number().min(0).max(100),
});
export type QualityScoreBreakdown = z.infer<typeof QualityScoreBreakdownSchema>;

export const CommentAdmissionDecisionSchema = z.object({
  admitted: z.boolean(),
  reasons: z.array(NonEmptyStringSchema),
  score: QualityScoreBreakdownSchema,
  normalizedCandidate: ReviewCommentCandidateSchema,
});
export type CommentAdmissionDecision = z.infer<
  typeof CommentAdmissionDecisionSchema
>;

export const TriageEvaluationSchema = z.object({
  action: z.enum([
    "accept_final_review",
    "fetch_more_context",
    "accept_no_issue",
    "accept_insufficient_evidence",
    "reject_due_to_budget",
  ]),
  reasons: z.array(NonEmptyStringSchema),
  remainingBudget: ContextBudgetSchema,
});
export type TriageEvaluation = z.infer<typeof TriageEvaluationSchema>;

// 运行时聚合结果契约。API、Worker、前端和回写逻辑都围绕这些对象协作。
export const ReviewJobSchema = z.object({
  id: UuidSchema.optional(),
  repositoryId: UuidSchema.optional(),
  pullRequestId: UuidSchema.optional(),
  triggerSource: ReviewTriggerSourceSchema,
  status: JobStatusSchema,
  totalFiles: z.number().int().nonnegative(),
  finishedFiles: z.number().int().nonnegative(),
  totalSlices: z.number().int().nonnegative(),
  finishedSlices: z.number().int().nonnegative(),
  cacheHitFiles: z.number().int().nonnegative().default(0),
  llmProvider: NonEmptyStringSchema.optional(),
  llmModel: NonEmptyStringSchema.optional(),
  totalInputTokens: z.number().int().nonnegative().default(0),
  totalOutputTokens: z.number().int().nonnegative().default(0),
  totalCostUsd: z.number().nonnegative().default(0),
  durationMs: z.number().int().nonnegative().optional(),
  errorMessage: NonEmptyStringSchema.optional(),
  startedAt: TimestampSchema.optional(),
  finishedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type ReviewJob = z.infer<typeof ReviewJobSchema>;

export const FileReviewSchema = z.object({
  id: UuidSchema.optional(),
  reviewJobId: UuidSchema.optional(),
  pullRequestId: UuidSchema.optional(),
  filePath: NonEmptyStringSchema,
  language: NonEmptyStringSchema.optional(),
  fileStatus: PullRequestFileStatusSchema,
  patchSha256: NonEmptyStringSchema.optional(),
  isCached: z.boolean().default(false),
  sliceCount: z.number().int().positive().default(1),
  aiCommentCount: z.number().int().nonnegative().default(0),
  ruleCommentCount: z.number().int().nonnegative().default(0),
  highestSeverity: HighestSeveritySchema.default("NONE"),
  riskScore: z.number().int().min(0).max(100).default(0),
  summary: NonEmptyStringSchema.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  triageDecision: ReviewDecisionSchema.optional(),
  contextRound: z.number().int().nonnegative().default(0),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type FileReview = z.infer<typeof FileReviewSchema>;

export const ReviewCommentSchema = z.object({
  id: UuidSchema.optional(),
  reviewJobId: UuidSchema.optional(),
  fileReviewId: UuidSchema.optional(),
  source: ReviewCommentSourceSchema,
  category: ReviewCategorySchema,
  severity: ReviewSeveritySchema,
  title: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  suggestion: NonEmptyStringSchema.optional(),
  filePath: NonEmptyStringSchema,
  diffLineRef: NonEmptyStringSchema.optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  oldLineStart: z.number().int().positive().optional(),
  oldLineEnd: z.number().int().positive().optional(),
  fingerprint: NonEmptyStringSchema.optional(),
  evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  qualityScore: z.number().min(0).max(100).optional(),
  admissionReasons: z.array(NonEmptyStringSchema).default([]),
  isResolved: z.boolean().default(false),
  metadata: MetadataSchema.optional(),
  createdAt: TimestampSchema.optional(),
  updatedAt: TimestampSchema.optional(),
});
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const PRSummarySchema = z.object({
  headline: NonEmptyStringSchema,
  riskSummary: NonEmptyStringSchema,
  mergeRecommendation: MergeRecommendationSchema,
  notableFindings: z.array(NonEmptyStringSchema).default([]),
});
export type PRSummary = z.infer<typeof PRSummarySchema>;

export const ReviewAggregateResultSchema = z.object({
  reviewJob: ReviewJobSchema,
  pullRequest: PullRequestSchema,
  files: z.array(FileReviewSchema).default([]),
  comments: z.array(ReviewCommentSchema).default([]),
  summary: PRSummarySchema,
});
export type ReviewAggregateResult = z.infer<typeof ReviewAggregateResultSchema>;

// 实时事件契约。前端只订阅这些边界稳定的消息，不直接依赖内部任务对象。
export const ReviewJobProgressEventSchema = z.object({
  eventName: z.literal("review_job_progress"),
  occurredAt: TimestampSchema,
  payload: z.object({
    reviewJobId: UuidSchema,
    status: JobStatusSchema,
    finishedFiles: z.number().int().nonnegative(),
    totalFiles: z.number().int().nonnegative(),
    finishedSlices: z.number().int().nonnegative(),
    totalSlices: z.number().int().nonnegative(),
  }),
});
export type ReviewJobProgressEvent = z.infer<
  typeof ReviewJobProgressEventSchema
>;

export const FileReviewCompletedEventSchema = z.object({
  eventName: z.literal("file_review_completed"),
  occurredAt: TimestampSchema,
  payload: z.object({
    reviewJobId: UuidSchema,
    fileReview: FileReviewSchema,
    comments: z.array(ReviewCommentSchema).default([]),
  }),
});
export type FileReviewCompletedEvent = z.infer<
  typeof FileReviewCompletedEventSchema
>;

// 调试接口契约。当前 API 先暴露这组 review-tools 端点验证核心纯逻辑。
export const ContextPlanRequestSchema = z.object({
  request: ContextRequestSchema,
  budget: ContextBudgetSchema,
});
export type ContextPlanRequest = z.infer<typeof ContextPlanRequestSchema>;

export const ReviewTriageRequestSchema = z.object({
  decision: ReviewTriageDecisionSchema,
  budget: ContextBudgetSchema,
});
export type ReviewTriageRequest = z.infer<typeof ReviewTriageRequestSchema>;

export const QualityScoreRequestSchema = z.object({
  candidate: ReviewCommentCandidateSchema,
});
export type QualityScoreRequest = z.infer<typeof QualityScoreRequestSchema>;

export const CommentAdmissionRequestSchema = z.object({
  candidate: ReviewCommentCandidateSchema,
});
export type CommentAdmissionRequest = z.infer<
  typeof CommentAdmissionRequestSchema
>;
