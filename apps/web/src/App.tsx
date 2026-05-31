import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ApiErrorResponseSchema,
  CreateReviewJobResponseSchema,
  FileReviewCompletedEventSchema,
  ReviewJobCommentsResponseSchema,
  ReviewJobDetailResponseSchema,
  ReviewJobFilesResponseSchema,
  ReviewJobProgressEventSchema,
  type DiffLine,
  type DiffParseResult,
  type FileReview,
  type JobStatus,
  type MergeRecommendation,
  type PullRequestFile,
  type ReviewComment,
  type ReviewJobDetailResponse,
  type ReviewJobFileView,
  type ReviewSeverity,
} from "@ai-pr-review/shared-types";
import { io } from "socket.io-client";

type SeverityFilter = "ALL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

type ReviewFileEntry = {
  filePath: string;
  pullRequestFile: PullRequestFile;
  fileReview?: FileReview;
  diff?: DiffParseResult;
  comments: ReviewComment[];
  isPending: boolean;
};

type PullRequestRef = {
  owner: string;
  repo: string;
  prNumber: number;
  url: string;
};

const DEFAULT_PR_URL =
  "https://github.com/zhaoyongze123/ai-pr-review-assistant/pull/11";

const SEVERITY_LABELS: Record<SeverityFilter, string> = {
  ALL: "全部",
  HIGH: "HIGH",
  MEDIUM: "MED",
  LOW: "LOW",
  INFO: "INFO",
};

export function App() {
  const [pullRequestUrl, setPullRequestUrl] = useState(DEFAULT_PR_URL);
  const [analysisStage, setAnalysisStage] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [reviewJobId, setReviewJobId] = useState("");
  const [jobDetail, setJobDetail] = useState<ReviewJobDetailResponse | null>(
    null,
  );
  const [fileViews, setFileViews] = useState<ReviewJobFileView[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("ALL");
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeFilePath, setActiveFilePath] = useState("");
  const [activeCommentId, setActiveCommentId] = useState("");

  const lineElementMapRef = useRef(new Map<string, HTMLDivElement>());

  const fileEntries = jobDetail
    ? buildReviewFileEntries(jobDetail.pullRequest.files, fileViews, comments)
    : [];
  const filteredEntries = fileEntries.filter((entry) =>
    matchesSeverityFilter(entry, severityFilter),
  );
  const activeEntry =
    filteredEntries.find((entry) => entry.filePath === activeFilePath) ??
    fileEntries.find((entry) => entry.filePath === activeFilePath) ??
    filteredEntries[0] ??
    fileEntries[0];
  const activeCommentsByLine = activeEntry
    ? groupCommentsByLine(activeEntry.comments)
    : new Map<string, ReviewComment[]>();
  const activeComment =
    activeEntry?.comments.find((comment) => comment.id === activeCommentId) ??
    activeEntry?.comments[0];
  const filterCounts = buildFilterCounts(fileEntries);
  const highRiskPaths = buildHighRiskPaths(fileEntries);
  const recommendationReasons = buildRecommendationReasons(
    jobDetail?.summary?.notableFindings ?? [],
    comments,
  );
  const recommendationLabel = mapRecommendationLabel(
    jobDetail?.summary?.mergeRecommendation,
  );
  const recommendationTone = mapRecommendationTone(
    jobDetail?.summary?.mergeRecommendation,
  );
  const progressStats = buildProgressStats(jobDetail, fileEntries);
  const progressTone = mapJobTone(jobDetail?.reviewJob.status, isAnalyzing);
  const topProgressValue = buildTopProgressValue(progressStats, isAnalyzing);
  const topProgressLabel = buildTopProgressLabel(
    analysisStage,
    progressStats,
    isAnalyzing,
  );

  const refreshReviewJobSnapshot = useEffectEvent(
    async (nextReviewJobId: string) => {
      const [detail, filesResponse, commentsResponse] = await Promise.all([
        fetchReviewJobDetail(nextReviewJobId),
        fetchReviewJobFiles(nextReviewJobId),
        fetchReviewJobComments(nextReviewJobId),
      ]);

      startTransition(() => {
        setJobDetail(detail);
        setFileViews(filesResponse.files);
        setComments(dedupeComments(commentsResponse.comments));
        setAnalysisStage(
          formatProgressLabel(
            detail.reviewJob.status,
            detail.reviewJob.finishedFiles,
            detail.reviewJob.totalFiles,
          ),
        );

        if (detail.reviewJob.status === "done") {
          setIsAnalyzing(false);
        } else if (detail.reviewJob.status === "failed") {
          setIsAnalyzing(false);
          setErrorMessage(detail.reviewJob.errorMessage ?? "审查任务失败");
        } else {
          setIsAnalyzing(true);
        }
      });
    },
  );

  const refreshReviewJobFiles = useEffectEvent(
    async (nextReviewJobId: string) => {
      const response = await fetchReviewJobFiles(nextReviewJobId);
      startTransition(() => {
        setFileViews(response.files);
      });
    },
  );

  useEffect(() => {
    if (!activeEntry) {
      setActiveFilePath("");
      setActiveCommentId("");
      return;
    }

    if (!activeFilePath) {
      setActiveFilePath(activeEntry.filePath);
    }

    if (!activeCommentId && activeEntry.comments[0]?.id) {
      setActiveCommentId(activeEntry.comments[0].id);
    }
  }, [activeCommentId, activeEntry, activeFilePath]);

  useEffect(() => {
    if (!isDrawerOpen || !activeComment?.diffLineRef) {
      return;
    }

    const target = lineElementMapRef.current.get(activeComment.diffLineRef);
    target?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeComment?.diffLineRef, activeComment?.id, isDrawerOpen]);

  useEffect(() => {
    if (!reviewJobId) {
      return;
    }

    void refreshReviewJobSnapshot(reviewJobId);

    const socket = io(resolveReviewEventsUrl(), {
      transports: ["websocket", "polling"],
    });
    socket.on("connect", () => {
      socket.emit("subscribe_review_job", {
        reviewJobId,
      });
    });

    socket.on("review_job_progress", (event) => {
      const parsed = ReviewJobProgressEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.payload.reviewJobId !== reviewJobId) {
        return;
      }

      startTransition(() => {
        setAnalysisStage(
          formatProgressLabel(
            parsed.data.payload.status,
            parsed.data.payload.finishedFiles,
            parsed.data.payload.totalFiles,
          ),
        );
        setJobDetail((previous) =>
          previous
            ? {
                ...previous,
                reviewJob: {
                  ...previous.reviewJob,
                  status: parsed.data.payload.status,
                  finishedFiles: parsed.data.payload.finishedFiles,
                  totalFiles: parsed.data.payload.totalFiles,
                  finishedSlices: parsed.data.payload.finishedSlices,
                  totalSlices: parsed.data.payload.totalSlices,
                },
              }
            : previous,
        );
      });

      if (
        parsed.data.payload.status === "done" ||
        parsed.data.payload.status === "failed"
      ) {
        void refreshReviewJobSnapshot(reviewJobId);
      }
    });

    socket.on("file_review_completed", (event) => {
      const parsed = FileReviewCompletedEventSchema.safeParse(event);
      if (!parsed.success || parsed.data.payload.reviewJobId !== reviewJobId) {
        return;
      }

      startTransition(() => {
        setComments((previous) =>
          dedupeComments([...previous, ...parsed.data.payload.comments]),
        );
      });

      void refreshReviewJobFiles(reviewJobId);
    });

    const pollTimer = window.setInterval(() => {
      void refreshReviewJobSnapshot(reviewJobId);
    }, 5000);

    return () => {
      window.clearInterval(pollTimer);
      socket.disconnect();
    };
  }, [refreshReviewJobFiles, refreshReviewJobSnapshot, reviewJobId]);

  async function handleAnalyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsAnalyzing(true);
    setAnalysisStage("解析 PR 地址...");

    try {
      const reference = parsePullRequestUrl(pullRequestUrl);
      setAnalysisStage(`连接仓库 ${reference.owner}/${reference.repo}...`);
      await connectRepository(reference);

      setAnalysisStage(`创建 PR #${reference.prNumber} 审查任务...`);
      const created = await createReviewJob(reference);

      startTransition(() => {
        setReviewJobId(created.reviewJobId);
        setJobDetail(null);
        setFileViews([]);
        setComments([]);
        setSeverityFilter("ALL");
        setActiveFilePath("");
        setActiveCommentId("");
        setIsDrawerOpen(false);
        setAnalysisStage("审查任务已创建，等待文件分析...");
      });
    } catch (error) {
      setIsAnalyzing(false);
      setAnalysisStage("");
      setErrorMessage(
        error instanceof Error ? error.message : "分析过程中发生未知错误",
      );
    }
  }

  function handleOpenDrawer(entry: ReviewFileEntry, commentId?: string) {
    startTransition(() => {
      setActiveFilePath(entry.filePath);
      setActiveCommentId(commentId ?? entry.comments[0]?.id ?? "");
      setIsDrawerOpen(true);
    });
  }

  function handleSelectComment(entry: ReviewFileEntry, comment: ReviewComment) {
    startTransition(() => {
      setActiveFilePath(entry.filePath);
      setActiveCommentId(comment.id ?? "");
      setIsDrawerOpen(true);
    });
  }

  function handleMoveComment(step: 1 | -1) {
    if (!activeEntry || activeEntry.comments.length === 0) {
      return;
    }

    const currentIndex = activeEntry.comments.findIndex(
      (comment) => comment.id === activeComment?.id,
    );
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + step + activeEntry.comments.length) %
          activeEntry.comments.length
        : 0;

    setActiveCommentId(activeEntry.comments[nextIndex]?.id ?? "");
  }

  const pullRequestLabel = buildPullRequestLabel(jobDetail, pullRequestUrl);
  const selectedCommentIndex = activeEntry?.comments.findIndex(
    (comment) => comment.id === activeComment?.id,
  );
  const summaryText =
    jobDetail?.summary?.riskSummary ??
    "输入 PR URL 后，系统会自动连接仓库、创建审查任务，并在这里生成整体风险摘要。";

  return (
    <div className="codex-page">
      <div className="codex-frame">
        <header className="codex-header">
          <div className="codex-header__brand">
            <div className="codex-header__mark" aria-hidden="true">
              <TerminalIcon className="codex-header__mark-icon" />
            </div>
            <h1>ai-pr-review-assistant</h1>
          </div>

          <div className="codex-header__actions">
            <button type="button" className="codex-header__link">
              Docs
            </button>
            <button
              type="button"
              className="codex-header__link codex-header__link--active"
            >
              Logs
            </button>
          </div>
        </header>

        <div
          className="analysis-progress-band"
          data-tone={progressTone}
          data-active={isAnalyzing || reviewJobId ? "true" : "false"}
        >
          <div className="analysis-progress-band__track" aria-hidden="true">
            <div
              className="analysis-progress-band__fill"
              style={{
                width: `${topProgressValue}%`,
              }}
            />
          </div>
          <div className="analysis-progress-band__meta">
            <span>{topProgressLabel}</span>
            <span>
              {progressStats.finishedFiles}/{progressStats.totalFiles || 0}
            </span>
          </div>
        </div>

        <div
          className="codex-workspace"
          data-drawer-open={isDrawerOpen ? "true" : "false"}
        >
          <main className="codex-main">
            <section className="context-panel">
              <div className="context-panel__section">
                <div className="context-panel__heading">
                  <h2>PR Review Analysis</h2>
                  <div className="context-panel__subline">
                    <div className="context-panel__repo">
                      <GitPullRequestIcon className="icon-sm" />
                      {pullRequestLabel}
                    </div>
                    <span className="context-panel__divider" />
                    <div
                      className="job-status-pill"
                      data-tone={mapJobTone(
                        jobDetail?.reviewJob.status,
                        isAnalyzing,
                      )}
                    >
                      <span className="job-status-pill__dot" />
                      {formatJobStatus(jobDetail?.reviewJob.status)}
                    </div>
                  </div>
                </div>

                <div className="stats-grid">
                  <StatTile
                    icon={<FileCodeIcon className="icon-sm" />}
                    label="Total Files"
                    value={String(progressStats.totalFiles)}
                  />
                  <StatTile
                    icon={<AlertCircleIcon className="icon-sm" />}
                    label="High Risk"
                    value={String(filterCounts.HIGH)}
                  />
                  <StatTile
                    icon={<BugIcon className="icon-sm" />}
                    label="Med Risk"
                    value={String(filterCounts.MEDIUM)}
                  />
                  <StatTile
                    icon={<CheckCircleIcon className="icon-sm" />}
                    label="Coverage"
                    value={`${progressStats.percent}%`}
                  />
                </div>

                {jobDetail?.summary || isAnalyzing ? (
                  <div className="summary-strip">
                    <div className="summary-strip__copy">
                      <span>AI Summary</span>
                      <p>{summaryText}</p>
                    </div>
                    <div className="summary-strip__side">
                      <span
                        className="recommendation-chip"
                        data-tone={recommendationTone}
                      >
                        {recommendationLabel}
                      </span>
                      <span className="summary-strip__progress">
                        {progressStats.finishedFiles}/
                        {progressStats.totalFiles || 0}
                      </span>
                    </div>
                  </div>
                ) : null}

                {jobDetail?.summary &&
                (highRiskPaths.length > 0 || recommendationReasons.length > 0) ? (
                  <div className="summary-tags">
                    {highRiskPaths.map((filePath) => (
                      <span key={filePath} className="summary-tag">
                        {getDisplayFileName(filePath)}
                      </span>
                    ))}
                    {recommendationReasons.map((reason) => (
                      <span key={reason} className="summary-tag summary-tag--wide">
                        {reason}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="files-panel">
              <div className="files-panel__toolbar">
                <span className="files-panel__label">Analyzed Files</span>
                <div className="files-panel__filters">
                  {(["ALL", "HIGH", "MEDIUM", "LOW", "INFO"] as const).map(
                    (filter) => (
                      <button
                        key={filter}
                        type="button"
                        className="severity-filter-chip"
                        data-active={severityFilter === filter}
                        onClick={() => setSeverityFilter(filter)}
                      >
                        {SEVERITY_LABELS[filter]} {filterCounts[filter]}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="files-panel__list">
                {filteredEntries.length > 0 ? (
                  filteredEntries.map((entry) => {
                    const isSelected =
                      isDrawerOpen && activeEntry?.filePath === entry.filePath;
                    const issueSummary = buildFileIssueSummary(entry);
                    const rowPreview =
                      entry.fileReview?.summary ??
                      entry.comments
                        .slice(0, 2)
                        .map((comment) => comment.title)
                        .join(" · ");

                    return (
                      <button
                        key={entry.filePath}
                        type="button"
                        className="file-row"
                        data-selected={isSelected}
                        onClick={() => handleOpenDrawer(entry)}
                      >
                        <div className="file-row__content">
                          <div className="file-row__titleline">
                            {entry.comments.length > 0 ? (
                              <AlertCircleIcon className="file-row__icon file-row__icon--alert" />
                            ) : entry.isPending ? (
                              <ClockIcon className="file-row__icon" />
                            ) : (
                              <CheckCircleIcon className="file-row__icon file-row__icon--muted" />
                            )}

                            <div className="file-row__titlecopy">
                              <div className="file-row__nameplate">
                                <h4>{getDisplayFileName(entry.filePath)}</h4>
                                {entry.isPending ? (
                                  <span className="file-row__status-badge">
                                    Pending
                                  </span>
                                ) : null}
                              </div>

                              <div className="file-row__meta">
                                <span className="file-row__delta">
                                  <span className="file-row__delta--add">
                                    +{entry.pullRequestFile.additions}
                                  </span>
                                  <span className="file-row__delta--remove">
                                    -{entry.pullRequestFile.deletions}
                                  </span>
                                </span>
                                <span>{issueSummary}</span>
                              </div>

                              <p className="file-row__preview">
                                {rowPreview ||
                                  "当前文件暂无结构化摘要。"}
                              </p>
                            </div>
                          </div>
                        </div>

                        <ChevronRightIcon className="file-row__chevron" />
                      </button>
                    );
                  })
                ) : (
                  <div className="panel-empty-state">
                    当前筛选条件下没有文件结果。
                  </div>
                )}
              </div>
            </section>
          </main>

          {isDrawerOpen && activeEntry ? (
            <aside className="codex-drawer">
              <div className="codex-drawer__header">
                <h3>
                  <FileCodeIcon className="icon-sm" />
                  <span>{activeEntry.filePath}</span>
                </h3>

                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setIsDrawerOpen(false)}
                  aria-label="关闭"
                >
                  <XIcon className="icon-sm" />
                </button>
              </div>

              <div className="codex-drawer__body">
                <div className="comment-card">
                  <div className="comment-card__nav">
                    <div className="comment-card__index">
                      <span className="comment-card__dot" />
                      <span>
                        {activeEntry.comments.length > 0
                          ? `${Math.max((selectedCommentIndex ?? 0) + 1, 1)} / ${activeEntry.comments.length}`
                          : "0 / 0"}
                      </span>
                    </div>

                    <div className="comment-card__nav-actions">
                      <button
                        type="button"
                        className="tiny-button"
                        onClick={() => handleMoveComment(-1)}
                        disabled={activeEntry.comments.length <= 1}
                      >
                        上一条
                      </button>
                      <button
                        type="button"
                        className="tiny-button"
                        onClick={() => handleMoveComment(1)}
                        disabled={activeEntry.comments.length <= 1}
                      >
                        下一条
                      </button>
                    </div>
                  </div>

                  {activeComment ? (
                    <>
                      <div className="comment-card__headline">
                        <div>
                          <span
                            className="comment-card__severity"
                            data-tone={mapSeverityTone(activeComment.severity)}
                          >
                            {activeComment.severity}
                          </span>
                          <h4>{activeComment.title}</h4>
                        </div>

                        <div className="comment-card__meta">
                          <span>{activeComment.source.toUpperCase()}</span>
                          <span>{activeComment.category}</span>
                        </div>
                      </div>

                      <p className="comment-card__message">
                        {activeComment.message}
                      </p>

                      <div className="suggestion-panel">
                        <div className="suggestion-panel__title">
                          Suggested Fix
                        </div>
                        <div className="suggestion-panel__body">
                          <code>
                            {activeComment.suggestion ??
                              "当前评论没有给出可直接应用的建议代码。"}
                          </code>
                        </div>
                      </div>

                      {activeEntry.comments.length > 1 ? (
                        <div className="comment-card__switcher">
                          {activeEntry.comments.map((comment) => (
                            <button
                              key={buildCommentRenderKey(comment, "drawer-tabs")}
                              type="button"
                              className="comment-chip"
                              data-active={comment.id === activeComment.id}
                              onClick={() => handleSelectComment(activeEntry, comment)}
                            >
                              {comment.title}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {activeComment.evidenceRefs.length > 0 ? (
                        <div className="comment-card__evidence">
                          {activeComment.evidenceRefs.map((evidence) => (
                            <span key={evidence} className="evidence-pill">
                              {evidence}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="comment-card__empty">
                      当前文件暂无最终评论。
                    </div>
                  )}
                </div>

                <div className="diff-panel">
                  <div className="diff-panel__header">
                    <div className="diff-panel__filename">
                      {getDisplayFileName(activeEntry.filePath)}
                    </div>
                    <div className="diff-panel__delta">
                      <span className="file-row__delta--add">
                        +{activeEntry.pullRequestFile.additions}
                      </span>
                      <span className="file-row__delta--remove">
                        -{activeEntry.pullRequestFile.deletions}
                      </span>
                    </div>
                  </div>

                  <div className="diff-panel__body">
                    {activeEntry.diff ? (
                      activeEntry.diff.hunks.map((hunk) => (
                        <section key={hunk.hunkId} className="diff-hunk-panel">
                          <div className="diff-hunk-panel__header">
                            {hunk.header}
                          </div>

                          <div className="diff-hunk-panel__rows">
                            {hunk.lines.map((line) => {
                              const lineComments =
                                activeCommentsByLine.get(line.ref) ?? [];
                              const isSelectedLine = lineComments.some(
                                (comment) => comment.id === activeComment?.id,
                              );

                              return (
                                <div key={line.ref} className="diff-line-block">
                                  <div
                                    ref={(element) => {
                                      if (element) {
                                        lineElementMapRef.current.set(
                                          line.ref,
                                          element,
                                        );
                                      } else {
                                        lineElementMapRef.current.delete(
                                          line.ref,
                                        );
                                      }
                                    }}
                                    className="diff-code-row"
                                    data-line-type={line.lineType}
                                    data-active={isSelectedLine}
                                  >
                                    <span className="diff-code-row__number">
                                      {line.oldLineNumber ?? ""}
                                    </span>
                                    <span className="diff-code-row__number diff-code-row__number--next">
                                      {line.newLineNumber ?? ""}
                                    </span>
                                    <div className="diff-code-row__content">
                                      <span
                                        className="diff-code-row__sign"
                                        data-line-type={line.lineType}
                                      >
                                        {formatDiffPrefix(line).trim() || " "}
                                      </span>
                                      <code>
                                        {renderHighlightedCode(line.content)}
                                      </code>
                                    </div>
                                  </div>

                                  {lineComments.map((comment) => (
                                    <button
                                      key={buildCommentRenderKey(
                                        comment,
                                        `inline-${line.ref}`,
                                      )}
                                      type="button"
                                      className="inline-review-card"
                                      data-selected={
                                        comment.id === activeComment?.id
                                      }
                                      onClick={() =>
                                        setActiveCommentId(comment.id ?? "")
                                      }
                                    >
                                      <div className="inline-review-card__badges">
                                        <span className="inline-review-card__source">
                                          {comment.source.toUpperCase()}
                                        </span>
                                        <span
                                          className="comment-card__severity"
                                          data-tone={mapSeverityTone(
                                            comment.severity,
                                          )}
                                        >
                                          {comment.severity}
                                        </span>
                                      </div>
                                      <h5>{comment.title}</h5>
                                      <p>{comment.message}</p>
                                    </button>
                                  ))}
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))
                    ) : (
                      <div className="diff-panel__empty">
                        当前文件还在分析，首轮结果入库后才会展示 diff。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>

      <div className="floating-review-bar">
        <form className="floating-review-bar__form" onSubmit={handleAnalyze}>
          <div className="floating-review-bar__icon">
            <GitPullRequestIcon className="icon-sm" />
          </div>
          <input
            value={pullRequestUrl}
            onChange={(event) => setPullRequestUrl(event.target.value)}
            placeholder="Enter GitHub Pull Request URL..."
          />
          <button
            type="submit"
            className="floating-review-bar__submit"
            disabled={isAnalyzing}
          >
            <PlayIcon className="icon-xs icon-fill" />
            {isAnalyzing ? "Analyzing..." : "Analyze"}
          </button>
        </form>

        {analysisStage || errorMessage ? (
          <div className="floating-review-bar__status">
            {analysisStage ? <span>{analysisStage}</span> : null}
            {errorMessage ? (
              <span className="floating-review-bar__error">
                {errorMessage}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function StatTile(input: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__label">
        {input.icon}
        <span>{input.label}</span>
      </div>
      <div className="stat-tile__value">{input.value}</div>
    </div>
  );
}

function buildPullRequestLabel(
  detail: ReviewJobDetailResponse | null,
  currentUrl: string,
) {
  if (detail) {
    return `${detail.pullRequest.owner}/${detail.pullRequest.repo} #${detail.pullRequest.prNumber}`;
  }

  try {
    const reference = parsePullRequestUrl(currentUrl);
    return `${reference.owner}/${reference.repo} #${reference.prNumber}`;
  } catch {
    return "owner/repo #123";
  }
}

function buildFileIssueSummary(entry: ReviewFileEntry) {
  if (entry.isPending) {
    return "Queued for review";
  }

  if (entry.comments.length > 0) {
    return `${entry.comments.length} issues`;
  }

  if (entry.fileReview?.summary) {
    return entry.fileReview.summary;
  }

  return "No inline issues";
}

function renderHighlightedCode(content: string) {
  const tokenPattern =
    /("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b(?:import|export|class|function|const|let|var|if|else|return|catch|try|await|async|throw|new|switch|case|default|this|true|false|null|undefined)\b)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match = tokenPattern.exec(content);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(
        <span key={`text-${lastIndex}`}>{content.slice(lastIndex, match.index)}</span>,
      );
    }

    const value = match[0];
    nodes.push(
      <span
        key={`token-${match.index}`}
        className={
          value.startsWith('"') ||
          value.startsWith("'") ||
          value.startsWith("`")
            ? "diff-token diff-token--string"
            : value === "true" ||
                value === "false" ||
                value === "null" ||
                value === "undefined"
              ? "diff-token diff-token--literal"
              : "diff-token diff-token--keyword"
        }
      >
        {value}
      </span>,
    );

    lastIndex = match.index + value.length;
    match = tokenPattern.exec(content);
  }

  if (lastIndex < content.length) {
    nodes.push(<span key={`text-tail-${lastIndex}`}>{content.slice(lastIndex)}</span>);
  }

  return nodes;
}

function mapJobTone(status?: JobStatus, isAnalyzing?: boolean) {
  if (status === "failed") {
    return "failed";
  }
  if (status === "done") {
    return "done";
  }
  if (status === "running" || isAnalyzing) {
    return "running";
  }
  return "pending";
}

function buildTopProgressValue(
  progressStats: ReturnType<typeof buildProgressStats>,
  isAnalyzing: boolean,
) {
  if (progressStats.totalFiles > 0) {
    return Math.max(progressStats.percent, progressStats.finishedFiles > 0 ? 8 : 4);
  }

  return isAnalyzing ? 12 : 0;
}

function buildTopProgressLabel(
  analysisStage: string,
  progressStats: ReturnType<typeof buildProgressStats>,
  isAnalyzing: boolean,
) {
  if (analysisStage) {
    return analysisStage;
  }

  if (isAnalyzing) {
    return "正在准备审查任务...";
  }

  if (progressStats.totalFiles > 0) {
    return "分析已完成";
  }

  return "等待开始分析";
}

type IconProps = {
  className?: string;
};

function TerminalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 6.75 9 10.75 5 14.75"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 15H18.25"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GitPullRequestIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM21 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M5 8v8M5 10h6a4 4 0 0 0 4-4V4M15 4h4v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FileCodeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M14 3H7.8A1.8 1.8 0 0 0 6 4.8v14.4A1.8 1.8 0 0 0 7.8 21h8.4A1.8 1.8 0 0 0 18 19.2V7l-4-4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v4h4M10 10 8.5 12 10 14M14 10 15.5 12 14 14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5Z" />
    </svg>
  );
}

function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="m10 7 5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 8v4.4M12 15.3h.01"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m8.7 12.1 2.2 2.2 4.4-4.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BugIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M8.5 10.5h7v4.2a3.5 3.5 0 0 1-7 0v-4.2ZM10.3 7.6a2.4 2.4 0 0 1 3.4 0l.3.3a2.4 2.4 0 0 1 .7 1.7V10H9.6v-.4a2.4 2.4 0 0 1 .7-1.7l.3-.3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M7 9H5M19 9h-2M7 13H4.5M19.5 13H17M8 18l-1.5 1.5M16 18l1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 7.6v4.7l3.2 1.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function XIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M7 7 17 17M17 7 7 17"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function getDisplayFileName(filePath: string) {
  const segments = filePath.split("/");
  return segments[segments.length - 1] ?? filePath;
}

function buildReviewFileEntries(
  pullRequestFiles: PullRequestFile[],
  fileViews: ReviewJobFileView[],
  comments: ReviewComment[],
): ReviewFileEntry[] {
  const reviewableFiles = pullRequestFiles.filter(
    (file) => typeof file.patch === "string" && file.patch.length > 0,
  );
  const fileViewMap = new Map(
    fileViews.map((item) => [item.pullRequestFile.filePath, item]),
  );
  const commentMap = new Map<string, ReviewComment[]>();

  for (const comment of comments) {
    const bucket = commentMap.get(comment.filePath) ?? [];
    bucket.push(comment);
    commentMap.set(comment.filePath, bucket);
  }

  return reviewableFiles
    .map((pullRequestFile) => {
      const fileView = fileViewMap.get(pullRequestFile.filePath);
      return {
        filePath: pullRequestFile.filePath,
        pullRequestFile: fileView?.pullRequestFile ?? pullRequestFile,
        fileReview: fileView?.fileReview,
        diff: fileView?.diff,
        comments: sortComments(commentMap.get(pullRequestFile.filePath) ?? []),
        isPending: !fileView?.fileReview,
      };
    })
    .sort(compareReviewEntries);
}

function buildFilterCounts(entries: ReviewFileEntry[]) {
  const counts: Record<SeverityFilter, number> = {
    ALL: entries.length,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  for (const entry of entries) {
    const severity = entry.fileReview?.highestSeverity;
    if (severity === "HIGH") counts.HIGH += 1;
    if (severity === "MEDIUM") counts.MEDIUM += 1;
    if (severity === "LOW") counts.LOW += 1;
    if (severity === "INFO") counts.INFO += 1;
  }

  return counts;
}

function buildHighRiskPaths(entries: ReviewFileEntry[]) {
  return entries
    .filter((entry) => entry.fileReview?.highestSeverity === "HIGH")
    .map((entry) => entry.filePath)
    .slice(0, 5);
}

function buildRecommendationReasons(
  notableFindings: string[],
  comments: ReviewComment[],
) {
  const commentReasons = sortComments(comments)
    .slice(0, 3)
    .map((comment) => comment.title);

  if (commentReasons.length > 0) {
    return dedupeStrings(commentReasons).slice(0, 3);
  }

  return dedupeStrings(notableFindings).slice(0, 3);
}

function buildProgressStats(
  jobDetail: ReviewJobDetailResponse | null,
  entries: ReviewFileEntry[],
) {
  const totalFiles =
    jobDetail?.reviewJob.totalFiles ??
    (jobDetail
      ? jobDetail.pullRequest.files.filter(
          (file) => typeof file.patch === "string" && file.patch.length > 0,
        ).length
      : 0);
  const finishedFiles =
    jobDetail?.reviewJob.finishedFiles ??
    entries.filter((entry) => entry.fileReview).length;

  return {
    totalFiles,
    finishedFiles,
    percent:
      totalFiles > 0 ? Math.round((finishedFiles / totalFiles) * 100) : 0,
  };
}

function groupCommentsByLine(comments: ReviewComment[]) {
  const grouped = new Map<string, ReviewComment[]>();

  for (const comment of comments) {
    if (!comment.diffLineRef) {
      continue;
    }

    const bucket = grouped.get(comment.diffLineRef) ?? [];
    bucket.push(comment);
    grouped.set(comment.diffLineRef, bucket);
  }

  return grouped;
}

function matchesSeverityFilter(
  entry: ReviewFileEntry,
  severityFilter: SeverityFilter,
) {
  if (severityFilter === "ALL") {
    return true;
  }

  return entry.fileReview?.highestSeverity === severityFilter;
}

function compareReviewEntries(left: ReviewFileEntry, right: ReviewFileEntry) {
  if (left.fileReview && right.fileReview) {
    return compareFileReviews(left.fileReview, right.fileReview);
  }

  if (left.fileReview && !right.fileReview) {
    return -1;
  }

  if (!left.fileReview && right.fileReview) {
    return 1;
  }

  return left.filePath.localeCompare(right.filePath);
}

function compareFileReviews(left: FileReview, right: FileReview) {
  const severityGap =
    getSeverityRank(left.highestSeverity) -
    getSeverityRank(right.highestSeverity);
  if (severityGap !== 0) {
    return severityGap;
  }

  const riskGap = right.riskScore - left.riskScore;
  if (riskGap !== 0) {
    return riskGap;
  }

  return left.filePath.localeCompare(right.filePath);
}

function sortComments(comments: ReviewComment[]) {
  return [...comments].sort((left, right) => {
    const severityGap =
      getSeverityRank(left.severity) - getSeverityRank(right.severity);
    if (severityGap !== 0) {
      return severityGap;
    }

    const scoreGap = (right.qualityScore ?? 0) - (left.qualityScore ?? 0);
    if (scoreGap !== 0) {
      return scoreGap;
    }

    return left.title.localeCompare(right.title);
  });
}

function dedupeComments(comments: ReviewComment[]) {
  const seen = new Set<string>();
  const deduped: ReviewComment[] = [];

  for (const comment of comments) {
    const key =
      comment.id ??
      comment.fingerprint ??
      `${comment.filePath}:${comment.diffLineRef ?? ""}:${comment.title}:${comment.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(comment);
  }

  return sortComments(deduped);
}

function dedupeStrings(values: string[]) {
  return [...new Set(values)];
}

function buildCommentRenderKey(comment: ReviewComment, scope: string) {
  return (
    comment.id ??
    comment.fingerprint ??
    `${scope}:${comment.filePath}:${comment.diffLineRef ?? ""}:${comment.title}:${comment.message}`
  );
}

function pickOverallSeverity(
  entries: ReviewFileEntry[],
): ReviewSeverity | "NONE" {
  for (const entry of entries) {
    if (entry.fileReview?.highestSeverity === "HIGH") {
      return "HIGH";
    }
    if (entry.fileReview?.highestSeverity === "MEDIUM") {
      return "MEDIUM";
    }
    if (entry.fileReview?.highestSeverity === "LOW") {
      return "LOW";
    }
    if (entry.fileReview?.highestSeverity === "INFO") {
      return "INFO";
    }
  }

  return "NONE";
}

function getSeverityRank(
  severity: ReviewSeverity | FileReview["highestSeverity"],
) {
  switch (severity) {
    case "HIGH":
      return 0;
    case "MEDIUM":
      return 1;
    case "LOW":
      return 2;
    case "INFO":
      return 3;
    default:
      return 4;
  }
}

function mapSeverityTone(
  severity: ReviewSeverity | FileReview["highestSeverity"] | "NONE",
) {
  switch (severity) {
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    case "INFO":
      return "info";
    default:
      return "subtle";
  }
}

function mapRecommendationLabel(recommendation?: MergeRecommendation) {
  switch (recommendation) {
    case "approve":
      return "建议直接合并";
    case "comment":
      return "建议带评论合并";
    case "request_changes":
      return "建议修复后再合并";
    case "blocked":
      return "当前阻塞，不建议合并";
    case "insufficient_evidence":
      return "证据不足，建议补上下文后再判断";
    default:
      return "等待分析结果";
  }
}

function mapRecommendationTone(recommendation?: MergeRecommendation) {
  switch (recommendation) {
    case "approve":
      return "positive";
    case "comment":
      return "neutral";
    case "request_changes":
      return "warning";
    case "blocked":
      return "danger";
    case "insufficient_evidence":
      return "muted";
    default:
      return "muted";
  }
}

function formatDiffPrefix(line: DiffLine) {
  if (line.lineType === "add") {
    return "+ ";
  }
  if (line.lineType === "remove") {
    return "- ";
  }
  return "  ";
}

function formatJobStatus(status?: JobStatus) {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Analyzing";
    case "done":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    default:
      return "Idle";
  }
}

function formatProgressLabel(
  status: JobStatus,
  finishedFiles: number,
  totalFiles: number,
) {
  if (status === "done") {
    return "审查完成";
  }
  if (status === "failed") {
    return "审查失败";
  }
  if (status === "pending") {
    return "审查任务已创建，等待执行...";
  }
  return `已完成 ${finishedFiles} / ${totalFiles} 个文件`;
}

function parsePullRequestUrl(value: string): PullRequestRef {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(
      "PR URL 不是合法链接，请输入完整的 GitHub Pull Request 地址。",
    );
  }

  if (url.hostname !== "github.com") {
    throw new Error("当前仅支持 GitHub Pull Request 地址。");
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 4 || segments[2] !== "pull") {
    throw new Error("PR URL 格式不正确，期望形如 /owner/repo/pull/123。");
  }

  const prNumber = Number(segments[3]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error("PR 编号必须是正整数。");
  }

  return {
    owner: segments[0]!,
    repo: segments[1]!,
    prNumber,
    url: value.trim(),
  };
}

async function connectRepository(reference: PullRequestRef) {
  const response = await fetch("/api/repositories/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      provider: "github",
      owner: reference.owner,
      repo: reference.repo,
    }),
  });

  await assertOk(response, "仓库接入失败");
}

async function createReviewJob(reference: PullRequestRef) {
  const response = await fetch("/api/review-jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repository: {
        provider: "github",
        owner: reference.owner,
        repo: reference.repo,
      },
      prNumber: reference.prNumber,
      triggerSource: "manual",
    }),
  });

  const payload = await assertOk(response, "创建审查任务失败");
  return CreateReviewJobResponseSchema.parse(payload);
}

async function fetchReviewJobDetail(reviewJobId: string) {
  const response = await fetch(`/api/review-jobs/${reviewJobId}`);
  const payload = await assertOk(response, "读取审查任务详情失败");
  return ReviewJobDetailResponseSchema.parse(payload);
}

async function fetchReviewJobFiles(reviewJobId: string) {
  const response = await fetch(`/api/review-jobs/${reviewJobId}/files`);
  const payload = await assertOk(response, "读取文件审查结果失败");
  return ReviewJobFilesResponseSchema.parse(payload);
}

async function fetchReviewJobComments(reviewJobId: string) {
  const response = await fetch(`/api/review-jobs/${reviewJobId}/comments`);
  const payload = await assertOk(response, "读取审查评论失败");
  return ReviewJobCommentsResponseSchema.parse(payload);
}

async function assertOk(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => null);
  if (response.ok) {
    return payload;
  }

  const parsed = ApiErrorResponseSchema.safeParse(payload);
  throw new Error(parsed.success ? parsed.data.error.message : fallbackMessage);
}

function resolveReviewEventsUrl() {
  const current = new URL(window.location.origin);
  if (current.port === "3000") {
    current.port = "3001";
  }
  current.pathname = "/review-events";
  return current.toString();
}
