# 契约总览

## 1. 目的

这组文档是 `AI PR Review 助手` 的 contract-first 真源，目标是让两个人可以在不联调整个系统的前提下并行开发。

规则只有一条：

- 任何跨模块传递的 JSON，必须先在 `packages/shared-types` 定义。

这意味着：

- API 不能手写临时 response shape
- Worker 不能自己发明字段
- 前端不能手抄 mock 数据结构
- fixtures 必须通过 shared schema 校验

## 2. 真源分工

### `packages/shared-types`

运行时真源：

- Zod Schema
- TypeScript types
- 请求 / 响应对象
- Worker 内部传输对象
- 实时事件对象

### `docs/contracts/`

协作真源：

- 数据流图
- 状态机
- 字段说明
- 版本约定
- 典型 JSON 示例

### `infra/postgres/init.sql`

持久化真源：

- 表
- 索引
- 约束
- JSONB 字段策略

### `fixtures/`

Mock 真源：

- 仓库扫描结果
- PR 数据
- triage 结果
- context fetch 结果
- review comment 结果

## 3. 当前冻结的核心对象

### 仓库接入与语义地图

- `Repository`
- `RepositoryConnectRequest`
- `RepositoryConnectResponse`
- `ApiErrorResponse`
- `RepositoryScan`
- `RepositoryFile`
- `Symbol`
- `SymbolEdge`
- `SemanticDocument`
- `RepositorySemanticMap`

### PR 审查主链路

- `PullRequest`
- `ReviewJob`
- `FileReview`
- `ReviewComment`
- `ReviewAggregateResult`

### Review 质量门禁

- `ReviewTriageDecision`
- `ContextRequest`
- `ContextFetchResult`
- `CommentAdmissionDecision`
- `QualityScoreBreakdown`

### 实时事件

- `RepositoryScanCompletedEvent`
- `ReviewJobProgressEvent`
- `FileReviewCompletedEvent`

## 4. 版本约定

当前契约版本：`v1`

约定：

- 新增可选字段：允许
- 新增必填字段：禁止，除非升级契约版本
- 修改枚举值：禁止，除非升级契约版本
- 修改字段语义：禁止，除非升级契约版本

## 5. 两人并行开发边界

推荐拆分：

### 开发方向 A：Repository Intelligence

- 仓库接入
- 仓库扫描
- Symbol / Edge / Semantic Document 写入
- 语义地图查询接口

### 开发方向 B：Review Pipeline

- PR 拉取
- Diff 解析
- Triage
- Context Fetch
- Second-pass
- Admission Gate
- Quality Score
- Review 结果聚合

共享边界：

- `packages/shared-types`
- `infra/postgres/init.sql`
- `fixtures/`

## 6. 联调原则

联调只联边界，不联整个系统。

顺序：

1. schema 校验
2. fixture 校验
3. API 边界联调
4. Worker 边界联调
5. 外部依赖替换
