# AI PR Review 助手模块化开发计划

## 1. 文档目标

本文档用于指导本项目按模块推进开发，不按前后端拆，也不按人员分工拆。

核心目标：

1. 把整体系统拆成边界清晰的功能模块。
2. 每个模块都给出具体开发步骤，而不是只写高层目标。
3. 每个模块都定义可验证的验收标准。
4. 明确哪些模块需要接 `LangSmith`，以及接入目的是什么。

本文档与以下真源配合使用：

- [架构设计文档](./ai-pr-review-architecture.md)
- [契约总览](./contracts/contracts-overview.md)
- [数据流说明](./contracts/data-flow.md)
- [数据库结构说明](./contracts/database-schema.md)
- [共享契约代码](../packages/shared-types/src/index.ts)
- [数据库初始化 SQL](../infra/postgres/init.sql)
- [Mock Fixtures](../fixtures)

## 2. 状态同步规则

本文件不是一次性规划文档，而是持续维护的开发状态文档。

要求：

1. 模块开始开发时，更新模块状态为“开发中”或等价描述。
2. 模块完成验收时，更新模块状态为“已完成”或等价描述。
3. 如果模块范围、依赖、验收标准发生变化，必须同步更新本文件。
4. 如果某个模块只有部分落地，必须明确写“当前完成到哪一步”，不能继续保留模糊描述。

每次模块完成后，至少同步这几类信息：

- 当前状态
- 实际完成范围
- 与原计划的差异
- 验收结果
- 下一依赖模块是否可启动

## 3. 开发顺序总览

本项目建议按以下顺序推进：

1. 模块 M0：契约与持久化真源
2. 模块 M1：仓库接入与 GitHub 认证
3. 模块 M2：仓库扫描任务编排
4. 模块 M3：结构化索引构建
5. 模块 M4：语义语料构建与检索
6. 模块 M5：PR 拉取与 Diff Core
7. 模块 M6：规则引擎接入
8. 模块 M7：首轮审查与 Triage
9. 模块 M8：上下文检索与二轮审查
10. 模块 M9：评论准入、质量评分与结果聚合
11. 模块 M10：API 查询面与 Web 工作台
12. 模块 M11：GitHub 回写
13. 模块 M12：Observability、LangSmith 与评估回归

原则：

- 上游真源稳定后，再做下游消费。
- 每个模块一个分支，一个 PR，一个主题。
- 优先交付“可运行骨架 + 可验证样例”，不要一上来做全功能闭环。

## 4. 模块摘要表

| 模块 | 名称                    | 主要产出                               | 依赖           | LangSmith                          |
| ---- | ----------------------- | -------------------------------------- | -------------- | ---------------------------------- |
| M0   | 契约与持久化真源        | schema、DDL、fixtures                  | 无             | 不接                               |
| M1   | 仓库接入与 GitHub 认证  | repository connect API                 | M0             | 不接                               |
| M2   | 仓库扫描任务编排        | scan job、队列、状态流                 | M0, M1         | 不接                               |
| M3   | 结构化索引构建          | files、symbols、edges                  | M0, M2         | 不接，保持本地真源                 |
| M4   | 语义语料构建与检索      | semantic documents、retrieval API      | M0, M2         | 已完成，当前不接                   |
| M5   | PR 拉取与 Diff Core     | pull request、diff parse、line refs    | M0, M1         | 不接                               |
| M6   | 规则引擎接入            | semgrep/eslint 结果标准化              | M0, M5         | 可选记录，不强制                   |
| M7   | 首轮审查与 Triage       | first-pass review、triage decision     | M0, M5, M6     | 需要 trace                         |
| M8   | 上下文检索与二轮审查    | context fetch、second-pass review      | M0, M3, M4, M7 | 已完成真实验收                     |
| M9   | 评论准入与结果聚合      | comments、summary、merge suggestion    | M0, M7, M8     | 已完成真实验收                     |
| M10  | API 查询面与 Web 工作台 | review job query、diff viewer、联动 UI | M0, M5, M9     | 不直接依赖                         |
| M11  | GitHub 回写             | inline review comments 回写            | M0, M9         | 可记录结果，不做主依赖             |
| M12  | Observability 与评估    | tracing、dataset、evaluation           | M7, M8, M9     | 部分完成，待补 dataset/统一 tracer |

## 5. 模块详细计划

## M0. 契约与持久化真源

### 目标

先冻结跨模块边界，让后续开发都对着同一套对象工作。

### 当前状态

已完成基础骨架：

- `packages/shared-types`
- `docs/contracts/*`
- `infra/postgres/init.sql`
- `fixtures/*`

当前判断：

- M0 基础版已完成
- 后续进入持续维护阶段
- 新模块如果引入新契约、新表结构或新高频样例，应回到 M0 同步更新

### 代码落点

- `packages/shared-types`
- `infra/postgres/init.sql`
- `docs/contracts`
- `fixtures`

### 具体开发步骤

1. 审查并补齐所有核心领域对象。
2. 确认 API 请求 / 响应、Worker 输入 / 输出、事件对象都进入 shared-types。
3. 将数据库表与领域对象一一映射，补足缺失字段。
4. 为每个高频对象至少补一个 fixture。
5. 写一套 fixture schema 校验脚本，确保 mock 不是假数据。

### 验收标准

- `shared-types` 覆盖 repository、scan、semantic map、PR、review、events。
- `init.sql` 覆盖仓库层和 PR 审查层核心表。
- fixtures 全部可被对应 schema 成功 parse。
- `npm run check` 通过。

### LangSmith

- 不接。
- 原因：这一层是系统真源，不是观测层。

## M1. 仓库接入与 GitHub 认证

### 当前状态

已完成，当前处于持续维护阶段。

### 目标

输入一个 GitHub 仓库，系统能保存仓库记录，并具备后续扫描所需的访问能力。

### 代码落点

- `apps/api`
- 后续建议新增 `packages/github-client`
- `.env.example`

### 具体开发步骤

1. 新增 `POST /api/repositories/connect`。
2. 接收 `owner/repo` 与可选安装信息。
3. 使用 GitHub API 校验仓库存在性和访问权限。
4. 获取默认分支、clone URL、基础元信息。
5. 保存 `repositories` 记录。
6. 返回 `RepositoryConnectResponse`。
7. 用 fixture 补一个 connect success 和 connect failure 场景。

### 验收标准

- 能接入一个可访问仓库并成功写库。
- 对不存在仓库、无权限仓库能返回明确错误。
- API 返回 shape 与 `RepositoryConnectResponseSchema` 一致。

### 当前落地结果

- 已新增 `POST /api/repositories/connect`。
- 已补 GitHub client、Postgres store 和 connect service。
- 已补 connect success / failure fixtures。
- 已增加控制器级验证脚本和真实 smoke 脚本。
- 已完成真实 GitHub 仓库接入、错误仓库返回和 `repositories` 落库验证。

### LangSmith

- 不接。
- 原因：这一步是普通 GitHub 业务接入，不涉及 LLM 审查质量。

## M2. 仓库扫描任务编排

### 目标

接入仓库后，能够触发一次完整扫描任务，并把状态流转起来。

### 代码落点

- `apps/api`
- `apps/worker`
- `Redis / BullMQ`

### 具体开发步骤

1. 新增 `POST /api/repositories/:id/scan`。
2. 生成 `repository_scans` 记录，状态初始化为 `pending`。
3. 将扫描任务投递到 Worker 队列。
4. Worker 消费任务后更新状态为 `running`。
5. 扫描完成后写入 `done`，失败则写 `failed`。
6. 推送 `repository_scan_started / completed / failed` 事件。
7. 增加 scan job 的重试和幂等约束。

### 验收标准

- 触发 API 后能看到 scan 记录落库。
- Worker 能真实消费任务并更新状态。
- 前端或调试端能收到扫描完成事件。
- 重复点击扫描时不会产生不可控重复任务。

### LangSmith

- 不接。
- 原因：这里还是任务编排，不是 LLM 价值链。

## M3. 结构化索引构建

### 目标

构建“代码真相层”，为后续 triage 和上下文检索提供可靠结构化证据。

### 当前状态

已完成：

- 新建 `packages/repo-intelligence`
- 接入 TS/JS 结构化索引提取
- 接入语言 / 框架识别
- 写入 `repository_files`、`symbols`、`symbol_edges`
- 补齐数据库表注释和列注释，方便查库和 Navicat 浏览

当前真实验证结果：

- 已在真实仓库 `zhaoyongze123/ai-pr-review-assistant` 跑通扫描
- 最新一次扫描落库：
  - `76` 个 `repository_files`
  - `348` 个 `symbols`
  - `139` 条 `symbol_edges`

与原计划差异：

- 当前先完成 TS/JS 主链路
- 非 TS/JS 的 `tree-sitter` 兜底尚未接入
- 查询能力先落在 Worker store 层，HTTP 查询面放到后续模块再暴露

### 代码落点

- 建议新增 `packages/repo-intelligence`
- `apps/worker`

### 具体开发步骤

1. 识别仓库语言和框架。
2. 对 TS/JS 使用 `ts-morph` 或 TypeScript Compiler API 提取：
   - files
   - symbols
   - imports
   - call edges
3. 对非 TS/JS 先用 `tree-sitter` 做基础 symbol 提取兜底。
4. 生成文件职责摘要和模块归属。
5. 提取风险标签：
   - auth
   - payment
   - permission
   - transaction
   - database
   - cache
   - retry
   - feature flag
6. 写入：
   - `repository_files`
   - `symbols`
   - `symbol_edges`

### 验收标准

- 能查到某个 symbol 定义位置。
- 能查到某个 symbol 的 callers / callees。
- 文件有基础 summary，关键模块有 risk tags。
- TS/JS 仓库输出质量明显优于兜底模式。

### 当前验收结论

- 已满足：
  - 能查到 symbol 定义位置
  - 能查到至少一条 caller / callee 边
  - 文件已生成基础 summary 和 risk tags
- 待后续增强：
  - 非 TS/JS 兜底提取
  - 对外查询接口

### LangSmith

- 不接。
- 原因：这里的真源必须留在本地数据库，不进入外部 observability 主链。

## M4. 语义语料构建与检索

### 目标

构建辅助语义层，只服务文档背景和模块职责检索，不碰代码事实主判断。

### 当前状态

已完成：

- 新建 `packages/retrieval-core`
- 扫描 README / docs / ADR 等 Markdown 语料
- 生成 heading / module / tags metadata
- 生成本地 embedding 并写入 `semantic_documents`
- 新增最小语义检索接口 `POST /api/repositories/:id/retrieval/search`
- 已补真实 smoke，验证扫描后可召回文档块

当前真实验证结果：

- 已在真实仓库 `zhaoyongze123/ai-pr-review-assistant` 写入 `semantic_documents`
- 扫描完成后可通过 API 检索出与 query 相关的 README / docs chunk
- 结果可按 limit 返回并带 score

当前验收结论：

- 已满足：
  - 文档扫描、chunk、metadata、embedding、落库已可运行
  - 语义检索已可按 query / module / documentType 检索
  - 检索结果以 README / docs 为主，不依赖源码正文
- 后续增强：
  - 可替换为外部 embedding provider
  - 可继续优化召回排序策略

与原计划差异：

- 当前 embedding 采用本地哈希向量实现，先保证检索主链路可跑
- repo / module / documentType 精细过滤已在契约中保留，当前先完成最小查询面
- 暂未接入外部 embedding provider，也未接 LangSmith

### 代码落点

- 建议新增 `packages/retrieval-core`
- `apps/worker`
- `PostgreSQL + pgvector`

### 具体开发步骤

1. 扫描：
   - README
   - docs
   - ADR
   - API docs
   - 配置说明
   - 模块摘要
2. 设计 chunk 规则：
   - 保持段落完整
   - 保留 heading 元数据
   - 单 chunk 不过长
3. 生成 embedding。
4. 写入 `semantic_documents`。
5. 提供 retrieval 接口：
   - 可按 repo / module / documentType 过滤
   - 可按 query 做语义召回
6. 明确和结构化检索的边界，禁止直接从 semantic layer 推出代码事实。

### 验收标准

- 能根据 “refresh token lifecycle” 召回对应文档 chunk。
- 可过滤出某个模块或某类文档。
- 语义检索结果主要是 README/docs/module summary，而不是源码正文。

### LangSmith

- 当前阶段可不接。
- 只有当后续开始调 retrieval query 效果时，才考虑记录召回摘要到 trace metadata。

## M5. PR 拉取与 Diff Core

### 目标

给定 PR 编号，系统能拿到完整 PR 变更，并构建稳定的 `diffLineRef`。

### 当前状态

已完成：

- 新增 `packages/diff-core`，可把 GitHub file patch 解析为 `DiffHunk[]`。
- `DiffParseResult` 已补 `lineRefMap`，支持 `diffLineRef -> old/new line -> hunkId` 映射。
- `GitHubClientService` 已支持拉取 PR 元信息与 PR files patch。
- `pull_requests` 已接入 `PullRequestStoreService` 落库，并保留文件快照供后续审查复用。
- 已补 patch 为空文件的兜底逻辑、diff fixture 和验证脚本。
- 已通过真实 smoke：可对真实 GitHub PR 完成 `PR 拉取 -> diff 解析 -> pull_requests 落库`。

### 代码落点

- 建议新增 `packages/diff-core`
- `apps/worker`
- `apps/api`

### 具体开发步骤

1. 使用 GitHub GraphQL 获取 PR 元信息。
2. 使用 GitHub REST 获取文件 patch。
3. 保存 `pull_requests` 记录。
4. 解析 patch 为 `DiffHunk[]`。
5. 为每一行建立稳定引用：
   - `L101+`
   - `L88-`
6. 建立映射：
   - `diffLineRef -> oldLine`
   - `diffLineRef -> newLine`
   - `diffLineRef -> hunkId`
7. 输出 `DiffParseResult`。

### 验收标准

- 已能通过 GitHub REST 对真实 PR 拉到文件列表与 patch。
- `DiffParseResult` 能解析出 hunk、行引用和 `lineRefMap`。
- 后续评论可以稳定锚定到具体 diff 行，不靠裸行号。

### 当前落地结果

- `apps/api/src/modules/repositories/github-client.service.ts` 已完成真实 PR 元信息与文件 patch 拉取。
- `apps/api/src/modules/reviews/pull-request-store.service.ts` 已完成 `pull_requests` 表 upsert。
- `apps/api/src/modules/reviews/first-pass-review.integration.ts` 已对真实 PR 验证 `pull_requests` 落库。

### LangSmith

- 不接。
- 原因：Diff Core 是基础设施，不是模型效果观察点。

## M6. 规则引擎接入

### 目标

让规则扫描成为审查链路的稳定输入，不让 AI 单独承担所有问题发现。

### 当前状态

已完成：

- `services/rule-engine` 新增 `/scan`，包装 semgrep 与 eslint 执行入口。
- 规则执行支持超时和失败兜底，单个引擎失败时返回 failures，不阻断整体响应。
- `packages/review-core` 新增 `normalizeRuleViolations`，把 semgrep/eslint 原始结果标准化为 `RuleViolation`。
- Worker 首轮审查输入已接收 `RuleViolation[]`。
- 已支持 repo/module 级规则配置入口：`semgrepConfigs`、`moduleRuleConfigs`。
- 已支持 `files` 模式扫描，便于无仓库 clone 的独立验证。
- 已通过真实 smoke：本地 sidecar 可命中自定义 `moduleRuleConfigs` 规则。

### 代码落点

- `services/rule-engine`
- `apps/worker`

### 具体开发步骤

1. 包装 `semgrep` 执行器。
2. 对 TS/JS 仓库补一个 `eslint` 执行入口。
3. 将原始规则结果标准化为 `RuleViolation`。
4. 支持按仓库或模块加载规则配置。
5. 把规则结果并入首轮审查输入。

### 验收标准

- sidecar 能在 semgrep/eslint 可用时执行真实扫描。
- 规则结果能转成统一 `RuleViolationSchema`。
- Review Pipeline 可以消费规则结果，不再只依赖 LLM。

### 当前落地结果

- `services/rule-engine/app.py` 已支持 `RULE_ENGINE_PORT`、venv 下 semgrep 查找、规则 ID 归一化与 `--no-rewrite-rule-ids`。
- `apps/api/src/modules/reviews/rule-engine.integration.ts` 已验证 `moduleRuleConfigs` 可以真实命中规则。

### LangSmith

- 可选记录。
- 建议只记录规则命中摘要数量和 rule ids，不记录整份规则输出正文。

## M7. 首轮审查与 Triage

### 目标

建立首轮 AI 审查链路，并且首轮输出必须先进入 `ReviewTriageDecision`，不能直接产最终评论。

### 当前状态

已完成：

- 新增 `packages/prompt-builder`，按 diff 行锚点渲染首轮 triage prompt。
- 新增 `packages/llm-gateway`，对接 OpenAI 兼容 `/v1/chat/completions` 并解析结构化 `ReviewTriageDecision`。
- `apps/api/src/modules/reviews/first-pass-review.service.ts` 已完成首轮编排：
  - GitHub PR 拉取
  - `pull_requests` upsert
  - `review_jobs` 创建/完成/失败流转
  - 仓库临时 clone
  - rule-engine 扫描
  - prompt-builder 组 prompt
  - llm-gateway 调用真实模型
  - `file_reviews` 落库
  - `llm_call_logs` 落库
- 首轮输入包含 diff、PR file 和规则结果。
- 高风险规则命中会输出 `need_more_context` 并保留 provisional findings。
- 无规则证据时优先输出 `insufficient_evidence` 或 `no_issue`，不硬造最终评论。
- `rule-engine` 已切换为本地 Python 进程开发模式，不再通过 Docker Compose 构建代码服务。
- 已通过真实 smoke：本地 `rule-engine` + `POST /api/review-tools/first-pass` + 真实 `gpt-5.4` 可完成文件级 triage，并验证 `pull_requests`、`review_jobs`、`file_reviews`、`llm_call_logs` 四张表落库。

当前说明：

- LangSmith 已完成真实平台验收，当前可在 LangSmith 中看到：
  - `review-job` 根 trace
  - `rule-engine-scan` tool trace
  - `review-file` chain trace
  - `first-pass-review` llm trace
- 首轮链路里的 `context-fetch-plan` trace 已具备独立验证脚本，但由于真实 PR 本轮没有触发 `need_more_context` 落库分支，所以主链路里尚未形成稳定的 `context-fetch-plan` 真实样本；这一点继续放在 M8 / M12 补齐。

### 代码落点

- `packages/review-core`
- `apps/worker`
- 后续建议新增 `packages/prompt-builder`
- 后续建议新增 `packages/llm-gateway`

### 具体开发步骤

1. 设计首轮 prompt：
   - 输入 diff
   - 输入局部上下文
   - 输入结构化索引摘要
   - 输入规则结果
2. 用结构化输出约束模型返回 `ReviewTriageDecision`。
3. 实现：
   - `final_review`
   - `need_more_context`
   - `no_issue`
   - `insufficient_evidence`
4. 把首轮结果写入 `file_reviews.triage_decision`。
5. 保留首轮 provisional findings，供后续 admission gate 使用。

### 验收标准

- 对 fixture PR 能返回结构化 `ReviewTriageDecision`。
- 对“高风险但证据不足”的场景能稳定输出 `need_more_context`。
- 不会在证据不足时强行给出大量最终评论。

### 当前落地结果

- `apps/api/src/modules/reviews/first-pass-review.integration.ts` 已完成真实链路 smoke，并校验数据库落库结果。
- 已补充 `first-pass-review.need-more-context.json`、`first-pass-review.no-issue.json`、`first-pass-review.insufficient-evidence.json`。
- `LangsmithTraceService` 已落入主链路，trace 失败不会阻断审查任务。
- 已新增 `apps/api/src/modules/reviews/langsmith-trace.integration.ts`，可独立验证完整父子 trace 树。
- 已用真实 LangSmith key 验证成功：
  - 手工树 smoke 可查到 `review-job -> rule-engine-scan -> review-file -> first-pass-review / context-fetch-plan`
  - 真实 first-pass smoke 可查到 `review-job -> rule-engine-scan -> review-file -> first-pass-review`
- 为降低误报和脏 trace，`packages/llm-gateway` 已补空 `contextRequest.reason` 自动回填逻辑；修复后真实 smoke 中成功 `first-pass-review` run 从 `2` 提升到 `14`。

### LangSmith

- 已接入非阻断 trace hook。

接入点：

- first-pass review
- triage decision

记录内容：

- `review_job_id`
- `file_path`
- `provider`
- `model`
- `prompt_version`
- `triage_decision`
- token / latency / cost

目的：

- 看首轮模型到底在哪类改动上开始偏航
- 后续做 triage prompt 回归

本阶段说明：

- 本模块已完成首轮链路 tracing 的真实平台验收。
- dataset、评估脚本、脱敏策略和更深的二轮审查 trace 仍放在 M12。

## M8. 上下文检索与二轮审查

### 目标

让系统在需要时主动补上下文，而不是盲目扩 prompt 或直接猜测。

### 当前状态

已完成：

- `createContextFetchPlan` 已支持按预算裁剪，而不是超预算整轮失败
- `ContextFetcherService.execute` 已能基于结构化索引和语义检索返回真实 artifact
- `second-pass prompt`、`LLM gateway`、`context_fetch_logs` 已接入主审查链路
- 真实 smoke 已验收 `completed` 状态的 `context fetch`
- LangSmith smoke 已验收 `second-pass-review` trace

### 代码落点

- `packages/review-core`
- `apps/worker`
- `packages/repo-intelligence`
- `packages/retrieval-core`

### 具体开发步骤

1. 根据 `ReviewTriageDecision` 判断是否进入二轮。
2. 将 `ContextRequest` 转为可执行计划。
3. 从结构化索引层拉：
   - definitions
   - callers
   - callees
   - tests
   - schema
   - config
4. 必要时再从 semantic layer 拉文档背景。
5. 组装 second-pass context package。
6. 调用 second-pass prompt。
7. 返回新的候选评论集合。
8. 把 context fetch 结果写入 `context_fetch_logs`。

### 验收标准

- 二轮检索受 `ContextBudget` 约束。
- 请求 callers 时，优先从结构化索引得到真实代码线索。
- second-pass 输出质量优于只看 diff 的结果。
- 不出现无限检索或上下文爆炸。

### LangSmith

- 需要接。

接入点：

- context request
- context fetch summary
- second-pass review

记录内容：

- `context_request`
- 计划调用的工具名
- 实际拿到的 artifact 摘要
- second-pass prompt version
- second-pass decision 或 candidates

目的：

- 看二轮检索是否真的提升质量
- 分析哪些上下文最有效，哪些只是噪音

## M9. 评论准入、质量评分与结果聚合

### 目标

把“有价值评论”和“低信号废话”系统性分开，并形成最终 review 结果。

### 当前状态

已完成：

- `evaluateCommentAdmission` 已接入更严格的准入阈值和低信号压制
- `scoreCommentCandidate` 已补强噪音惩罚与总分计算
- 已落地 duplicate fingerprint 去重、`review_comments` 落库与 `ReviewAggregateResult`
- 真实 smoke 已验证 `aggregateResult` 和 `review_comments` 同步输出
- LangSmith smoke 已验证 `quality-scoring`、`comment-admission`、`final-aggregate-summary`

### 代码落点

- `packages/review-core`
- `apps/worker`

### 具体开发步骤

1. 对 second-pass 或 final-review 产生的候选评论逐条打分。
2. 执行 admission gate：
   - 无 diffLineRef 不准入
   - 无 evidenceRefs 不准入
   - 无故障条件或影响说明不准入
3. 去重：
   - 同一问题不同措辞不重复发
4. 聚合文件级结果：
   - `FileReview`
   - `ReviewComment[]`
5. 聚合 PR 级结果：
   - headline
   - risk summary
   - merge recommendation

### 验收标准

- 低信号评论被稳定压制。
- 高风险评论带证据链和明确动作建议。
- `ReviewAggregateResult` 可以直接给前端展示。

### LangSmith

- 需要接。

接入点：

- admission gate
- quality scoring
- final aggregate summary

记录内容：

- comment count before gate
- comment count after gate
- quality scores
- merge recommendation

目的：

- 找出最常见的噪音来源
- 回归 admission gate 的阈值和规则是否合适

## M10. API 查询面与 Web 工作台

### 目标

把前面沉淀的 review 结果稳定展示出来，而不是让前端直接拼接中间对象。

### 代码落点

- `apps/api`
- `apps/web`

### 当前状态

已完成真实验收：

- `packages/shared-types` 已补齐正式读模型契约：
  - `ReviewJobDetailResponse`
  - `ReviewJobFilesResponse`
  - `ReviewJobCommentsResponse`
  - `ReviewJobFileView`
- `apps/api` 已新增正式查询接口：
  - `POST /api/review-jobs`
  - `GET /api/review-jobs/:id`
  - `GET /api/review-jobs/:id/files`
  - `GET /api/review-jobs/:id/comments`
  - `GET /api/repositories/:repositoryId/semantic-map`
- `apps/api` 已新增 `ReviewEventsGateway` 与 `ReviewEventsService`，支持：
  - `review_job_progress`
  - `file_review_completed`
- `apps/web` 已切到正式 query API 读模型，不再依赖临时 `review-tools/first-pass` 接口展示主页面。
- Web 工作台已完成：
  - PR 概览
  - AI Summary
  - Risk Panel
  - File Reviews
  - Final Recommendation
  - Diff Viewer 抽屉
  - evidence chain 展示
  - 点击文件 / 点击评论联动
  - pending 骨架态
- 联调阶段额外补齐：
  - `WebSocket + 5s polling fallback` 双轨更新
  - 公开仓库 clone 失败自动回退到公开 URL
  - review job 失败信息中的 GitHub token 脱敏，避免泄露到数据库、LangSmith 和前端

### 具体开发步骤

1. 新增 review job 查询接口：
   - `GET /api/review-jobs/:id`
   - `GET /api/review-jobs/:id/files`
   - `GET /api/review-jobs/:id/comments`
2. 推送 WebSocket 事件：
   - `review_job_progress`
   - `file_review_completed`
3. 前端实现页面：
   - 仓库接入页
   - PR 提交与审查页
   - Diff Viewer
   - 评论面板
4. 建立联动：
   - 点评论滚动到 diff 行
   - 点文件切换 active diff
   - 显示 evidence chain

### 验收标准

- 用户可提交仓库和 PR。
- 前端能实时看到 review 进度。
- 评论与 diff 行定位联动稳定。
- 页面展示对象全部来自正式 query API，不靠临时拼装。

### 实际验收

- 已通过：
  - `npm run check --workspace=@ai-pr-review/api`
  - `npm run check --workspace=@ai-pr-review/web`
- 真实 query API 验收已通过：
  - `GET /api/review-jobs/:id`
  - `GET /api/review-jobs/:id/files`
  - `GET /api/review-jobs/:id/comments`
- 真实 semantic map 验收已通过：
  - `GET /api/repositories/f540c902-3bc5-4d4a-8ce6-6ff9f0ed04a9/semantic-map`
  - 当前真实返回包含 `620` 个 symbols、`260` 条 edges
- 真实浏览器 smoke 已通过：
  - `http://localhost:3000/` 可正常加载，无新的应用级 console error
  - 真实任务 `8523d43b-41f7-4a1e-987f-ed727c401153` 已从 `0/18` 推进到 `6/18`
  - 历史真实完成任务 `e4fde163-b9e0-4102-8237-05b7a37f6dd3`、`1cd2ec57-b106-4135-881f-9c5232290329` 已完成 `18/18`
  - 已验证点击高风险评论后，Diff Viewer 会切换到 `packages/review-core/src/review-aggregation.ts`

### 与原计划差异

- 实时更新没有只依赖 WebSocket，而是采用 `WebSocket + 5s polling fallback`，降低本地开发环境下连接抖动对 UI 的影响。
- 在 UI 联调阶段发现真实 clone 失败会把带凭证 URL 暴露给前端，因此额外补了 clone fallback 与错误脱敏；这是 M10 联调质量保障的一部分，不改变主契约。

### LangSmith

- 不直接依赖。
- 前端不应从 LangSmith 拉数据作为业务展示源。

## M11. GitHub 回写

### 目标

把最终通过准入的评论，按需回写为 GitHub PR review comments。

### 代码落点

- `apps/api`
- `apps/worker`
- 建议新增 `packages/github-writer`

### 具体开发步骤

1. 新增回写 API：
   - `POST /api/review-jobs/:id/writeback`
2. 将 `ReviewComment` 转换为 GitHub review comment 请求。
3. 映射：
   - filePath
   - line / side
   - body
4. 记录回写结果与失败原因。
5. 避免重复回写同一 comment。

### 验收标准

- 能把至少一条高质量评论成功写回 GitHub PR。
- 写回失败时能追踪原因。
- 不会因重复点击导致重复评论刷屏。

### LangSmith

- 可选记录。
- 仅建议记录：
  - writeback count
  - success/failure summary
- 不把 GitHub 回写本身做成主 tracing 依赖。

## M12. Observability、LangSmith 与评估回归

### 目标

把 LangSmith 接成“可选观测与评估层”，而不是系统主依赖。

### 设计原则

- `PostgreSQL` 仍是业务真源。
- `shared-types` 仍是契约真源。
- `LangSmith` 只负责：
  - trace
  - dataset
  - evaluation
  - prompt 对比

### 代码落点

- 建议新增 `packages/observability`
- `apps/worker`
- `apps/api` 仅薄接

### 具体开发步骤

1. 抽象 tracer 接口：
   - `NoopTracer`
   - `LangSmithTracer`
2. 在 Worker 中包 trace：
   - first-pass review
   - triage
   - context fetch
   - second-pass review
   - admission gate
   - quality scoring
3. 增加环境变量：
   - `LANGSMITH_API_KEY`
   - `LANGSMITH_TRACING`
   - `LANGSMITH_PROJECT`
4. 加 trace metadata 规范：
   - `review_job_id`
   - `file_path`
   - `repo`
   - `pr_number`
   - `prompt_version`
   - `triage_decision`
5. 做脱敏策略：
   - 默认不上传完整私有源码
   - 默认不上传完整 patch
   - 只上传摘要、hash、截断上下文和必要 metadata
6. 基于 fixtures 和真实 bad cases 建 dataset：
   - triage dataset
   - context retrieval dataset
   - admission / quality dataset
7. 建评估脚本，支持回归比较 prompt 版本。

### 当前状态

已部分完成：

- `apps/api/src/modules/reviews/langsmith-trace.service.ts` 已落地非阻断 `RunTree` 封装。
- `packages/llm-gateway/src/index.ts` 已切换到 `traceable(fetch)`，不依赖 OpenAI SDK wrapper。
- 已新增 `apps/api/src/modules/reviews/langsmith-trace.integration.ts` 作为真实 LangSmith 树状 smoke。
- 已完成真实验收：
  - 手工树 trace 可见 `review-job -> rule-engine-scan -> review-file -> first-pass-review -> context-fetch-plan -> context-fetch-summary -> second-pass-review`
  - 真实 first-pass smoke 可见 `completed` 状态的 `context fetch` 落库

仍未完成：

- dataset、评估脚本、脱敏策略还没落地
- `packages/observability` 这一层抽象还没独立拆出

### 验收标准

- 关闭 LangSmith 时，系统仍能完整运行。
- 打开 LangSmith 时，能看到 file-review 粒度的 trace。
- trace 能清楚区分：
  - first-pass
  - triage
  - context fetch
  - second-pass
  - admission
  - quality
- 至少沉淀一套 triage dataset 和一套 admission dataset。
- 私有仓库敏感信息默认不全量外发。

## 6. 模块状态维护要求

每个模块都应维护显式状态，推荐使用：

- `待开发`
- `开发中`
- `已完成`
- `阻塞中`
- `暂缓`

更新规则：

- 开分支开始做该模块时，改为 `开发中`
- PR 合并且验收完成后，改为 `已完成`
- 外部依赖未就绪无法推进时，改为 `阻塞中`
- 明确决定后移时，改为 `暂缓`

如果模块完成度不足 100%，应在模块正文中写清楚“已完成部分 / 未完成部分”。

## 7. 模块完成定义

一个模块只有在同时满足以下条件时，才算真正完成：

1. 功能代码落地
2. 契约同步完成
3. fixture 同步完成
4. 文档同步完成
5. 最低验证完成
6. 可以单独提一个 PR 合并
7. `development-plan.md` 与 `development-checklist.md` 状态已同步

如果只是“代码写了”，但契约、fixture、文档和验收没有同步，不算完成。

## 8. 每个模块 PR 必填项

每个模块提 PR 时，描述里至少写清楚：

- 本模块目标
- 本次具体实现了哪些步骤
- 是否改了 `shared-types`
- 是否改了 `init.sql`
- 是否补了 fixtures
- 是否需要 LangSmith 埋点
- 是否同步更新 `development-plan.md`
- 是否同步更新 `development-checklist.md`
- 验收结果
- 未覆盖风险

## 9. 当前建议的最近 4 个模块

按当前仓库状态，最适合先做的是：

1. M1 仓库接入与 GitHub 认证
2. M2 仓库扫描任务编排
3. M3 结构化索引构建
4. M5 PR 拉取与 Diff Core

原因：

- M0 已经有真源层骨架
- 没有仓库接入和扫描，后面的 Review Pipeline 只能继续假跑
- 没有 Diff Core，后面的评论锚点无法稳定

## 10. 最终原则

这个项目最重要的不是“模块数量多”，而是：

- 上游真源稳定
- 模块边界清晰
- 每一步可验证
- LangSmith 只做观测和评估，不做业务主依赖

如果一个模块实现让这四点变差，应当回退设计，而不是强行推进。
