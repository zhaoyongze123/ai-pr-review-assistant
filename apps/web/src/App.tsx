import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Review Workspace</p>
          <h1>AI PR Review 助手</h1>
        </div>
        <div className="topbar-actions">
          {reviewJobId ? (
            <span className="status-chip subtle">
              Job #{reviewJobId.slice(0, 8)}
            </span>
          ) : null}
          <button
            className="ghost-button"
            type="button"
            disabled={!activeEntry}
            onClick={() => {
              if (!activeEntry) {
                return;
              }
              handleOpenDrawer(activeEntry, activeComment?.id);
            }}
          >
            {isDrawerOpen ? "聚焦当前 Diff" : "打开 Diff Viewer"}
          </button>
        </div>
      </header>

      <div
        className="workspace"
        data-drawer-open={isDrawerOpen ? "true" : "false"}
      >
        <main className="main-panel">
          <section className="hero-card card">
            <div className="hero-card__head">
              <div>
                <p className="section-label">PR 概览</p>
                <h2>
                  {jobDetail?.pullRequest.title ?? "等待输入 GitHub PR URL"}
                </h2>
              </div>
              <span
                className={`status-chip ${mapSeverityTone(
                  pickOverallSeverity(fileEntries),
                )}`}
              >
                总体风险 {pickOverallSeverity(fileEntries)}
              </span>
            </div>

            <div className="meta-grid">
              <MetaItem
                label="作者"
                value={jobDetail?.pullRequest.authorLogin ?? "未开始"}
              />
              <MetaItem
                label="基础分支"
                value={jobDetail?.pullRequest.baseBranch ?? "-"}
              />
              <MetaItem
                label="来源分支"
                value={jobDetail?.pullRequest.headBranch ?? "-"}
              />
              <MetaItem
                label="文件数"
                value={String(progressStats.totalFiles)}
              />
              <MetaItem
                label="改动规模"
                value={`+${jobDetail?.pullRequest.additions ?? 0} / -${
                  jobDetail?.pullRequest.deletions ?? 0
                }`}
              />
              <MetaItem
                label="状态"
                value={formatJobStatus(jobDetail?.reviewJob.status)}
              />
            </div>

            {progressStats.totalFiles > 0 ? (
              <div className="progress-panel">
                <div className="progress-panel__meta">
                  <span>分析进度</span>
                  <strong>
                    {progressStats.finishedFiles} / {progressStats.totalFiles}
                  </strong>
                </div>
                <div className="progress-bar">
                  <span
                    style={{
                      width: `${progressStats.percent}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <section className="summary-grid">
            <article className="card">
              <div className="section-heading">
                <div>
                  <p className="section-label">AI Summary</p>
                  <h3>审查结论摘要</h3>
                </div>
                {jobDetail?.summary?.headline ? (
                  <span className="status-chip subtle">已生成</span>
                ) : null}
              </div>
              <p className="summary-copy">
                {jobDetail?.summary?.riskSummary ??
                  "输入 PR URL 后，系统会自动连接仓库、创建审查任务，并在这里生成整体风险摘要。"}
              </p>
              {jobDetail?.summary?.headline ? (
                <div className="headline-banner">
                  {jobDetail.summary.headline}
                </div>
              ) : null}
            </article>

            <article className="card">
              <div className="section-heading">
                <div>
                  <p className="section-label">Risk Panel</p>
                  <h3>高风险范围</h3>
                </div>
                <span
                  className={`status-chip ${mapSeverityTone(
                    pickOverallSeverity(fileEntries),
                  )}`}
                >
                  {pickOverallSeverity(fileEntries)}
                </span>
              </div>
              {highRiskPaths.length > 0 ? (
                <ul className="risk-list">
                  {highRiskPaths.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="empty-copy">当前没有高风险文件。</p>
              )}
            </article>
          </section>

          <section className="card">
            <div className="section-heading section-heading--spaced">
              <div>
                <p className="section-label">File Reviews</p>
                <h3>文件级问题清单</h3>
              </div>
              <div className="filter-row">
                {(["ALL", "HIGH", "MEDIUM", "LOW", "INFO"] as const).map(
                  (filter) => (
                    <button
                      key={filter}
                      type="button"
                      className="filter-chip"
                      data-active={severityFilter === filter}
                      onClick={() => setSeverityFilter(filter)}
                    >
                      {SEVERITY_LABELS[filter]} {filterCounts[filter]}
                    </button>
                  ),
                )}
              </div>
            </div>

            {filteredEntries.length > 0 ? (
              <div className="file-review-list">
                {filteredEntries.map((entry) => (
                  <article
                    key={entry.filePath}
                    className="file-review-item"
                    data-active={
                      isDrawerOpen && activeEntry?.filePath === entry.filePath
                    }
                    data-pending={entry.isPending ? "true" : "false"}
                  >
                    <div className="file-review-item__header">
                      <div className="file-review-item__title">
                        <span
                          className={`severity-badge ${mapSeverityTone(
                            entry.fileReview?.highestSeverity ?? "NONE",
                          )}`}
                        >
                          {entry.fileReview?.highestSeverity ?? "PENDING"}
                        </span>
                        <div>
                          <h4>{entry.filePath}</h4>
                          <p>
                            {entry.fileReview?.summary ??
                              (entry.isPending
                                ? "文件已入队，等待首轮审查结果。"
                                : "暂无摘要")}
                          </p>
                        </div>
                      </div>

                      <div className="file-review-item__actions">
                        {entry.isPending ? (
                          <span className="counter-pill counter-pill--pending">
                            分析中
                          </span>
                        ) : (
                          <>
                            <span className="counter-pill">
                              {entry.fileReview?.aiCommentCount ?? 0} AI
                            </span>
                            <span className="counter-pill">
                              {entry.fileReview?.ruleCommentCount ?? 0} Rule
                            </span>
                          </>
                        )}
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleOpenDrawer(entry)}
                          disabled={!entry.diff}
                        >
                          查看代码
                        </button>
                      </div>
                    </div>

                    {entry.comments.length > 0 ? (
                      <ul className="comment-list">
                        {entry.comments.map((comment) => (
                          <li key={buildCommentRenderKey(comment, "list")}>
                            <button
                              type="button"
                              className="comment-link"
                              data-selected={activeComment?.id === comment.id}
                              onClick={() =>
                                handleSelectComment(entry, comment)
                              }
                            >
                              <span
                                className={`mini-severity ${mapSeverityTone(
                                  comment.severity,
                                )}`}
                              >
                                {comment.severity}
                              </span>
                              <span>{comment.title}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty-copy">
                        {entry.isPending
                          ? "当前文件还在分析，完成后会自动展示评论。"
                          : "当前文件没有最终输出评论。"}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>当前筛选条件下没有文件结果。</p>
              </div>
            )}
          </section>

          <section
            className="card recommendation-card"
            data-tone={recommendationTone}
          >
            <div className="section-heading">
              <div>
                <p className="section-label">Final Recommendation</p>
                <h3>{recommendationLabel}</h3>
              </div>
              {jobDetail?.summary?.mergeRecommendation ? (
                <span className="status-chip subtle">
                  {jobDetail.summary.mergeRecommendation}
                </span>
              ) : null}
            </div>

            <p className="summary-copy">
              {jobDetail?.summary?.headline ??
                "分析完成后，这里会给出最终合并建议和主要风险原因。"}
            </p>

            {recommendationReasons.length > 0 ? (
              <ol className="recommendation-list">
                {recommendationReasons.map((reason, index) => (
                  <li key={`${index}-${reason}`}>{reason}</li>
                ))}
              </ol>
            ) : null}
          </section>
        </main>

        <aside className="drawer" data-open={isDrawerOpen ? "true" : "false"}>
          {activeEntry ? (
            <>
              <div className="drawer__header">
                <div>
                  <p className="section-label">Diff Viewer</p>
                  <h3>{activeEntry.filePath}</h3>
                  <p className="drawer__meta">
                    +{activeEntry.pullRequestFile.additions} / -
                    {activeEntry.pullRequestFile.deletions}
                  </p>
                </div>

                <div className="drawer__actions">
                  <button
                    type="button"
                    className="ghost-icon-button"
                    onClick={() => handleMoveComment(-1)}
                    disabled={activeEntry.comments.length <= 1}
                  >
                    上一条
                  </button>
                  <button
                    type="button"
                    className="ghost-icon-button"
                    onClick={() => handleMoveComment(1)}
                    disabled={activeEntry.comments.length <= 1}
                  >
                    下一条
                  </button>
                  <button
                    type="button"
                    className="ghost-icon-button"
                    onClick={() => setIsDrawerOpen(false)}
                  >
                    关闭
                  </button>
                </div>
              </div>

              <div className="drawer__content">
                {activeEntry.diff ? (
                  activeEntry.diff.hunks.map((hunk) => (
                    <section key={hunk.hunkId} className="diff-hunk">
                      <div className="diff-hunk__header">{hunk.header}</div>
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
                                  lineElementMapRef.current.delete(line.ref);
                                }
                              }}
                              className="diff-row"
                              data-line-type={line.lineType}
                              data-active={isSelectedLine}
                            >
                              <span className="diff-row__number">
                                {line.oldLineNumber ?? ""}
                              </span>
                              <span className="diff-row__number">
                                {line.newLineNumber ?? ""}
                              </span>
                              <code className="diff-row__content">
                                {formatDiffPrefix(line)}
                                {line.content}
                              </code>
                            </div>

                            {lineComments.map((comment) => (
                              <button
                                key={buildCommentRenderKey(
                                  comment,
                                  `inline-${line.ref}`,
                                )}
                                type="button"
                                className="inline-comment-card"
                                data-selected={comment.id === activeComment?.id}
                                onClick={() =>
                                  setActiveCommentId(comment.id ?? "")
                                }
                              >
                                <div className="inline-comment-card__badges">
                                  <span className="counter-pill">
                                    {comment.source.toUpperCase()}
                                  </span>
                                  <span
                                    className={`severity-badge ${mapSeverityTone(
                                      comment.severity,
                                    )}`}
                                  >
                                    {comment.severity}
                                  </span>
                                </div>
                                <h4>{comment.title}</h4>
                                <p>{comment.message}</p>
                                {comment.suggestion ? (
                                  <p className="inline-comment-card__suggestion">
                                    建议：{comment.suggestion}
                                  </p>
                                ) : null}
                                {comment.evidenceRefs.length > 0 ? (
                                  <div className="evidence-chain">
                                    <span>Evidence</span>
                                    <ul>
                                      {comment.evidenceRefs.map(
                                        (evidence, index) => (
                                          <li key={`${index}-${evidence}`}>
                                            {evidence}
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                  </div>
                                ) : null}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </section>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>当前文件还在分析，首轮结果入库后才会展示 diff。</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="drawer__empty">
              <p>从左侧文件列表选择一个文件后，这里会展开 Diff Viewer。</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="composer-bar">
        <form className="composer-form" onSubmit={handleAnalyze}>
          <label className="composer-field">
            <span>GitHub PR URL</span>
            <input
              value={pullRequestUrl}
              onChange={(event) => setPullRequestUrl(event.target.value)}
              placeholder="https://github.com/owner/repo/pull/123"
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={isAnalyzing}
          >
            {isAnalyzing ? "分析中..." : "开始审查"}
          </button>
        </form>

        <div className="composer-status">
          {analysisStage ? <span>{analysisStage}</span> : null}
          {errorMessage ? (
            <span className="error-text">{errorMessage}</span>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

function MetaItem(input: { label: string; value: string }) {
  return (
    <div className="meta-item">
      <span>{input.label}</span>
      <strong>{input.value}</strong>
    </div>
  );
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
      return "待开始";
    case "running":
      return "分析中";
    case "done":
      return "已完成";
    case "failed":
      return "失败";
    case "canceled":
      return "已取消";
    default:
      return "未开始";
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
