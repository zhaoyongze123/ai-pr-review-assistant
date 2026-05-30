# AI PR Review 助手执行清单

## 1. 使用方式

本文档是 [模块化开发计划](./development-plan.md) 的执行版清单。

使用规则：

- 一个模块对应一个分支
- 一个分支只完成一个模块
- 一个模块内部再拆成多个 issue 级任务
- 子任务全部完成并验收通过后，才允许提 PR

建议执行顺序：

1. 先看模块目标
2. 再逐条勾选 issue 级任务
3. 每完成一条都补最小验证
4. 模块完成后统一跑完整检查
5. 模块完成后同步更新 `development-plan.md` 中对应模块状态

## 2. 模块执行清单总览

| 模块                                    | 状态                                  | 前置依赖       | 建议优先级 |
| --------------------------------------- | ------------------------------------- | -------------- | ---------- |
| M0 契约与持久化真源                     | 已完成基础版，持续维护                | 无             | 已完成     |
| M1 仓库接入与 GitHub 认证               | 已完成                                | M0             | 已完成     |
| M2 仓库扫描任务编排                     | 已完成                                | M0, M1         | 已完成     |
| M3 结构化索引构建                       | 已完成                                | M0, M2         | 已完成     |
| M4 语义语料构建与检索                   | 已完成                                | M0, M2         | 已完成     |
| M5 PR 拉取与 Diff Core                  | 已完成                                | M0, M1         | P0         |
| M6 规则引擎接入                         | 已完成                                | M0, M5         | P1         |
| M7 首轮审查与 Triage                    | 已完成                                | M0, M5, M6     | P1         |
| M8 上下文检索与二轮审查                 | 已完成                                | M0, M3, M4, M7 | 已完成     |
| M9 评论准入、质量评分与聚合             | 已完成                                | M0, M7, M8     | 已完成     |
| M10 API 查询面与 Web 工作台             | 待开发                                | M0, M5, M9     | P2         |
| M11 GitHub 回写                         | 待开发                                | M0, M9         | P2         |
| M12 Observability、LangSmith 与评估回归 | 部分完成，已验收到 gate/summary trace | M7, M8, M9     | P2         |

## 3. 状态维护规则

本文件必须和真实开发状态同步。

要求：

- 开始做某个模块时，先把该模块状态改成 `开发中`
- 一个 issue 完成后立即勾选，不要攒到最后统一补
- 模块 PR 提交前，至少完成一次全量自查
- 模块 PR 合并后，把模块状态改成 `已完成`
- 如果只完成一部分，必须在模块下补“剩余项”说明

禁止：

- 代码已经写完，但 checklist 仍全部未勾选
- PR 已合并，但模块状态仍写 `待开发`
- 口头说“这个先跳过”，但文档没有反映

## 4. 模块清单

## M0. 契约与持久化真源

### 当前判断

基础版已完成，当前进入持续维护阶段。

### 持续维护项

- 后续新增模块字段时，回到 M0 复核 `shared-types`
- 后续新增表、索引或字段时，回到 M0 复核 `init.sql`
- 后续新增高频场景时，回到 M0 补充 `fixtures`
- 后续改动契约后，保持 fixture schema 校验脚本可运行

### 交付件

- `packages/shared-types`
- `infra/postgres/init.sql`
- `fixtures/*`
- `docs/contracts/*`

### 模块完成定义

- 所有新增跨模块对象先有 schema 再有实现
- fixtures 能通过 schema parse
- 文档与 SQL 同步
- `development-plan.md` 和本清单状态同步

## M1. 仓库接入与 GitHub 认证

### 当前判断

实现、fixture 和真实 smoke 已完成，当前状态为待提交 PR。

### Issue 清单

- [x] 在 `shared-types` 审查并确认 connect 请求 / 响应契约足够
- [x] 在 `.env.example` 补充 GitHub 接入必要环境变量说明
- [x] 新建 GitHub client 封装层，统一封装认证和基础请求
- [x] 在 `apps/api` 新增 `POST /api/repositories/connect`
- [x] 实现仓库存在性校验
- [x] 实现权限校验
- [x] 拉取默认分支和 clone URL
- [x] 写入 `repositories` 表
- [x] 返回 `RepositoryConnectResponse`
- [x] 补一个 connect 成功 fixture
- [x] 补一个 connect 失败 fixture
- [x] 增加 API 层成功 / 失败请求验证

### 最小验证

- [x] 可接入一个真实可访问仓库
- [x] 错误仓库返回明确错误
- [x] `npm run check` 通过

### 模块完成定义

- connect API 可用
- repository 落库
- 契约、fixture、验证齐全
- 计划文档状态已同步

### LangSmith

- [x] 不接

## M2. 仓库扫描任务编排

### Issue 清单

- [ ] 审查 `RepositoryScanRequest` 和相关事件契约
- [ ] 在 `apps/api` 新增 `POST /api/repositories/:id/scan`
- [ ] 创建 `repository_scans` 记录
- [ ] 在 Worker 中新增 scan job consumer
- [ ] 接入 BullMQ queue 定义
- [ ] 实现状态流转：`pending -> running -> done/failed`
- [ ] 实现幂等控制，避免重复扫描并发失控
- [ ] 推送 `repository_scan_started`
- [ ] 推送 `repository_scan_completed`
- [ ] 推送 `repository_scan_failed`
- [ ] 增加失败重试策略
- [ ] 增加 scan 结果查询接口或调试入口

### 最小验证

- [ ] API 触发后 scan 记录写库
- [ ] Worker 可消费任务
- [ ] 状态从 `pending` 走到 `done`
- [ ] 重复触发不会打爆队列

### 模块完成定义

- 扫描任务编排真实可跑
- 状态事件完整
- 幂等与重试可验证
- 计划文档状态已同步

### LangSmith

- [ ] 不接

## M3. 结构化索引构建

### Issue 清单

- [x] 新建 `packages/repo-intelligence`
- [x] 设计 repo-intelligence 对外接口
- [x] 接入语言 / 框架识别
- [x] 接入 TS/JS AST 提取器
- [x] 提取 `RepositoryFile`
- [x] 提取 `Symbol`
- [x] 提取 `SymbolEdge`
- [x] 提取 file summary
- [x] 提取 module summary
- [x] 提取 risk tags
- [x] 写入 `repository_files`
- [x] 写入 `symbols`
- [x] 写入 `symbol_edges`
- [x] 增加 query 能力：
  - [x] 按 symbol 查定义
  - [x] 按 symbol 查 callers
  - [x] 按 symbol 查 callees
- [x] 补 TS/JS fixture 或最小 demo 仓库样例

### 最小验证

- [x] 能在真实 TS 仓库中查到至少一个 symbol 定义
- [x] 能查到至少一条 caller 边
- [x] 至少一个高风险文件命中 risk tag

### 模块完成定义

- TS/JS 结构化索引可用
- 查询接口可支持后续 triage/context fetch
- 计划文档状态已同步

### LangSmith

- [x] 不接

## M4. 语义语料构建与检索

### 当前判断

已完成，当前剩余项仅为后续增强，不影响模块闭环。

### Issue 清单

- [x] 新建 `packages/retrieval-core`
- [x] 明确文档扫描范围
- [x] 设计 chunk 规则
- [x] 增加 heading / module / tags metadata
- [x] 接入 embedding 生成逻辑
- [x] 写入 `semantic_documents`
- [x] 实现按 repo/module/documentType 过滤
- [x] 实现按 query 召回
- [x] 增加与结构化索引的边界注释和测试
- [x] 补 retrieval fixture

### 最小验证

- [x] 可召回 README/docs 中与 auth 或 payment 相关的文档块
- [x] 结果可以按模块过滤
- [x] 不把源码正文作为主要召回内容

### 模块完成定义

- semantic layer 可供 second-pass 补背景
- 与结构化索引边界清晰
- 计划文档状态已同步

### LangSmith

- [ ] 当前阶段不接主链
- [ ] 如调 retrieval 效果，可选记录召回摘要 metadata

## M5. PR 拉取与 Diff Core

### 当前判断

已完成：已提供 GitHub PR 元信息和文件 patch 拉取封装、`packages/diff-core` patch 解析、稳定 `diffLineRef` 和 `lineRefMap`，并完成 `pull_requests` 落库与真实 smoke 验证。

### Issue 清单

- [x] 新建 `packages/diff-core`
- [x] 设计 `DiffParseResult` 使用边界
- [x] 封装 GitHub REST PR 元信息拉取
- [x] 封装 GitHub REST 文件 patch 拉取
- [x] 写入 `pull_requests`
- [x] 解析 patch 为 `DiffHunk[]`
- [x] 生成 `diffLineRef`
- [x] 建 old/new 行号映射
- [x] 建 hunk 映射
- [x] 增加 patch 为空文件的兜底逻辑
- [x] 补 PR fixture 和 diff fixture

### 最小验证

- [x] 对真实 PR 能拉到文件和 patch
- [x] 解析结果中存在稳定 `diffLineRef`
- [x] comment 可依据 `diffLineRef` 定位

### 模块完成定义

- PR fetch 与 diff parse 可供 first-pass review 直接消费
- `pull_requests` 已落库并可复用
- 计划文档状态已同步

### LangSmith

- [x] 不接

## M6. 规则引擎接入

### 当前判断

已完成：已提供 Python sidecar `/scan` 入口、semgrep/eslint 输出标准化逻辑、TS 侧 `RuleViolation` 标准化函数，并把规则结果纳入首轮 review pipeline 输入；repo/module 级规则配置与真实规则命中 smoke 已补齐。

### Issue 清单

- [x] 审查 `RuleViolation` 契约
- [x] 在 `services/rule-engine` 包装 semgrep 执行入口
- [x] 对 TS/JS 增加 eslint 执行入口
- [x] 实现规则输出标准化
- [x] 增加规则执行超时控制
- [x] 增加规则执行失败兜底
- [x] 支持 repo/module 级规则配置入口
- [x] 将规则结果并入 review pipeline 输入
- [x] 补 rule result fixture

### 最小验证

- [x] 真实代码可跑出至少一条规则结果
- [x] 结果可 parse 为 `RuleViolationSchema`
- [x] 规则失败不会阻断整个 review job

### 模块完成定义

- rule engine 成为稳定上游输入
- 计划文档状态已同步

### LangSmith

- [x] 可选记录 rule hit 摘要
- [x] 不记录完整规则正文

## M7. 首轮审查与 Triage

### 当前判断

已完成：已建立首轮审查输入对象、结构化 `ReviewTriageDecision` 输出、`packages/prompt-builder`、`packages/llm-gateway`、数据库落库和主链路联调。
本轮已完成真实模块对接联调：本地 `rule-engine` 进程、`/api/review-tools/first-pass` 编排入口、真实 `gpt-5.4` 调用和数据库落库 smoke 已打通。

### Issue 清单

- [x] 审查首轮 prompt 输入对象
- [x] 新建 `packages/prompt-builder`
- [x] 新建 `packages/llm-gateway`
- [x] 实现 first-pass prompt 模板
- [x] 约束模型输出 `ReviewTriageDecision`
- [x] 在 Worker 中接入 first-pass review
- [x] 在 Worker 中接入 triage evaluation
- [x] 将 triage 结果写入 `file_reviews`
- [x] 保留 provisional findings
- [x] 补高风险 / 无问题 / 证据不足 3 类 fixture

### 最小验证

- [x] 真实或 fixture PR 可返回结构化 triage 决策
- [x] 高风险但证据不足场景返回 `need_more_context`
- [x] 无问题场景不会硬造评论
- [x] 真实 GitHub PR 可完成 `PR 拉取 -> diff 解析 -> semgrep -> triage -> file_reviews/llm_call_logs 落库` 联调 smoke

### 模块完成定义

- 首轮 review 能稳定区分 final/no_issue/need_more_context/insufficient_evidence
- 计划文档状态已同步

### LangSmith

- [x] 为 first-pass review 增加 trace
- [x] 为 triage decision 增加 trace
- [x] trace metadata 带 `review_job_id`、`file_path`、`prompt_version`
- [x] 使用真实 LangSmith key 做外部平台验收

## M8. 上下文检索与二轮审查

### Issue 清单

- [x] 审查 `ContextRequest` 和 `ContextBudget`
- [x] 在共享主链路中接入 `createContextFetchPlan`
- [x] 实现 definitions 检索
- [x] 实现 callers 检索
- [x] 实现 callees 检索
- [x] 实现 tests 检索
- [x] 实现 schema/config 检索
- [x] 必要时接入 semantic retrieval
- [x] 组装 second-pass context package
- [x] 设计 second-pass prompt
- [x] 返回 second-pass candidate comments
- [x] 写入 `context_fetch_logs`
- [x] 增加 budget exceeded 场景 fixture

### 最小验证

- [x] 二轮检索不会超预算失控
- [x] 能补到真实 caller/test 证据
- [x] second-pass 比 first-pass 更具体

### 模块完成定义

- 动态补上下文链路可用
- 二轮审查可产生更高价值候选评论
- 计划文档状态已同步

### LangSmith

- [x] trace context request
- [x] trace context fetch summary
- [x] trace second-pass review

### 验收说明

- [x] 真实 first-pass smoke 已验收 `completed` 状态的 `context_fetch_logs`
- [x] 真实 first-pass smoke 已验收 `file_reviews.context_round > 0`
- [x] LangSmith smoke 已验收 `second-pass-review` trace 节点

## M9. 评论准入、质量评分与结果聚合

### Issue 清单

- [x] 审查 `CommentAdmissionDecision` 与 `QualityScoreBreakdown`
- [x] 完善 admission rules
- [x] 完善低信号短语惩罚
- [x] 增加 duplicate fingerprint 去重
- [x] 聚合 file review summary
- [x] 聚合 PR summary
- [x] 生成 merge recommendation
- [x] 写入 `review_comments`
- [x] 生成 `ReviewAggregateResult`
- [x] 补 accepted / suppressed / duplicate 3 类 fixture

### 最小验证

- [x] 低信号评论被压制
- [x] 高价值评论带锚点和证据链
- [x] aggregate result 可直接提供给 API

### 模块完成定义

- 最终评论质量链闭环完成
- 计划文档状态已同步

### LangSmith

- [x] trace admission gate
- [x] trace quality scoring
- [x] trace final aggregate summary
- [ ] 为后续 evaluation 预留 dataset 输出

### 验收说明

- [x] `npm run validate:review-aggregation --workspace=@ai-pr-review/api`
- [x] 真实 `first-pass-review` smoke 已验收 `review_comments` 落库与 `aggregateResult`
- [x] 真实 LangSmith smoke 已验收 `quality-scoring` / `comment-admission` / `final-aggregate-summary`

## M10. API 查询面与 Web 工作台

### Issue 清单

- [ ] 新增 review job 查询接口
- [ ] 新增 file reviews 查询接口
- [ ] 新增 review comments 查询接口
- [ ] 新增 semantic map 查询接口
- [ ] 接入 WebSocket 事件
- [ ] 前端新增仓库接入页
- [ ] 前端新增 PR 审查页
- [ ] 前端实现文件列表
- [ ] 前端实现 Diff Viewer
- [ ] 前端实现评论面板
- [ ] 前端实现评论与 diff 联动
- [ ] 前端实现 evidence chain 展示

### 最小验证

- [ ] 可从 UI 提交仓库和 PR
- [ ] review 进度可实时更新
- [ ] 评论点击能定位到 diff 行

### 模块完成定义

- API 读模型和 Web 工作台可以真实消费 review 结果
- 计划文档状态已同步

### LangSmith

- [ ] 不直接接入业务展示

## M11. GitHub 回写

### Issue 清单

- [ ] 设计 writeback 请求契约
- [ ] 新增 `POST /api/review-jobs/:id/writeback`
- [ ] 实现 comment 到 GitHub API 的映射
- [ ] 处理 line / side / filePath 兼容
- [ ] 记录 writeback 结果
- [ ] 增加重复提交保护
- [ ] 补 writeback success / failure fixture

### 最小验证

- [ ] 至少一条评论可回写到真实 PR
- [ ] 失败原因可追踪
- [ ] 不会重复刷评论

### 模块完成定义

- 高质量评论可以按需写回 GitHub
- 计划文档状态已同步

### LangSmith

- [ ] 可选记录 writeback 成功/失败摘要

## M12. Observability、LangSmith 与评估回归

### 当前判断

当前为部分完成：

- 首轮链路已接入并验收 `review-job -> rule-engine-scan -> review-file -> first-pass-review`
- 已验收 `review-job -> review-file -> context-fetch-plan -> context-fetch-summary -> second-pass-review`
- 已验收 `review-job -> review-file -> quality-scoring -> comment-admission`
- 已验收 `review-job -> final-aggregate-summary`
- dataset、评估脚本和 Worker 侧统一 tracer 抽象仍未完成

### Issue 清单

- [ ] 新建 `packages/observability`
- [ ] 设计 tracer 接口
- [ ] 实现 `NoopTracer`
- [ ] 实现 `LangSmithTracer`
- [ ] 在 Worker 中接 first-pass trace
- [ ] 在 Worker 中接 triage trace
- [ ] 在 Worker 中接 context fetch trace
- [ ] 在 Worker 中接 second-pass trace
- [ ] 在 Worker 中接 admission trace
- [ ] 在 Worker 中接 quality trace
- [x] 增加 LangSmith 环境变量
- [ ] 增加脱敏策略
- [ ] 增加 triage dataset
- [ ] 增加 admission dataset
- [ ] 增加评估脚本
- [ ] 增加 prompt 版本对比说明

### 最小验证

- [x] 关闭 LangSmith 时系统照常运行
- [x] 打开 LangSmith 时可看到 file-review 级 trace
- [x] trace 中能区分 first-pass / context fetch / second-pass / gate / score
- [ ] 至少一套 dataset 和一套回归评估可运行

### 模块完成定义

- LangSmith 成为可选观测与评估层
- 不污染业务真源和核心纯逻辑
- 计划文档状态已同步

## 5. 执行检查模板

每个模块提 PR 前，至少自查：

- [ ] 契约是否变更
- [ ] SQL 是否变更
- [ ] fixtures 是否变更
- [ ] 文档是否变更
- [ ] LangSmith 接入是否需要变更
- [ ] `development-plan.md` 状态是否更新
- [ ] `development-checklist.md` 勾选是否更新
- [ ] `npm run check` 是否通过
- [ ] 最小运行验证是否完成
- [ ] PR 标题是否为中文描述

## 6. 当前最建议立即执行的模块

按当前仓库状态，建议直接从以下模块开始：

1. M1 仓库接入与 GitHub 认证
2. M2 仓库扫描任务编排
3. M3 结构化索引构建
4. M5 PR 拉取与 Diff Core

这四个模块完成后，项目才会从“契约和评审骨架”进入“可接真实仓库、可拉真实 PR”的阶段。
