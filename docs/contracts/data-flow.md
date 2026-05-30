# 数据流与状态机

## 1. 主数据流

```mermaid
flowchart TD
    A["接入 GitHub 仓库"] --> B["Repository Scan"]
    B --> C["结构化索引 + 语义语料"]
    C --> D["输入 PR 链接"]
    D --> E["拉取 PR 与 patch"]
    E --> F["首轮规则审查 + 首轮 AI 审查"]
    F --> G["ReviewTriageDecision"]
    G --> H{"是否需要更多上下文"}
    H -- 否 --> I["生成候选评论"]
    H -- 是 --> J["ContextRequest"]
    J --> K["结构化检索 / 语义检索"]
    K --> L["Second-pass Review"]
    L --> I
    I --> M["Comment Admission Gate"]
    M --> N["Quality Scoring"]
    N --> O["ReviewAggregateResult"]
```

## 2. 数据流输入输出

### 阶段 1：仓库接入

输入：

- `RepositoryConnectRequest`

输出：

- `RepositoryConnectResponse`
- `ApiErrorResponse`

### 阶段 2：仓库扫描

输入：

- `RepositoryScanTriggerRequest`

输出：

- `RepositoryScanTriggerResponse`
- `RepositoryScan`
- `RepositoryFile[]`
- `Symbol[]`
- `SymbolEdge[]`
- `SemanticDocument[]`
- `RepositoryScanEvent`

### 阶段 3：PR 拉取

输入：

- `CreateReviewJobRequest`

输出：

- `PullRequest`
- `DiffParseResult[]`
- `ReviewJob`

### 阶段 4：首轮审查

输入：

- `PullRequestFile`
- `DiffParseResult`
- 结构化索引片段
- 规则扫描结果

输出：

- `ReviewTriageDecision`

### 阶段 5：二轮上下文检索

输入：

- `ContextRequest`
- `ContextBudget`

输出：

- `ContextFetchResult`

### 阶段 6：评论质量门禁

输入：

- `ReviewCommentCandidate`

输出：

- `CommentAdmissionDecision`
- `QualityScoreBreakdown`

### 阶段 7：最终聚合

输入：

- `ReviewJob`
- `FileReview[]`
- `ReviewComment[]`

输出：

- `ReviewAggregateResult`

## 3. Triage 状态机

```mermaid
stateDiagram-v2
    [*] --> FirstPass
    FirstPass --> FinalReview: final_review
    FirstPass --> NoIssue: no_issue
    FirstPass --> InsufficientEvidence: insufficient_evidence
    FirstPass --> NeedMoreContext: need_more_context
    NeedMoreContext --> FetchContext
    FetchContext --> SecondPass
    SecondPass --> AdmissionGate
    AdmissionGate --> FinalOutput
    FinalReview --> FinalOutput
    NoIssue --> FinalOutput
    InsufficientEvidence --> FinalOutput
```

## 4. 实时事件流

### 仓库扫描

- `repository_scan_started`
- `repository_scan_completed`
- `repository_scan_failed`

### PR 审查

- `review_job_started`
- `review_job_progress`
- `file_review_started`
- `file_review_completed`
- `review_job_completed`
- `review_job_failed`

## 5. 上下文检索边界

结构化检索优先：

- symbol 定义
- callers
- callees
- 测试
- schema / migration
- config / feature flag

语义检索补充：

- README
- docs
- module summary
- architecture notes

约束：

- 二轮检索必须受 `ContextBudget` 控制
- 不允许无限制自由工具调用
