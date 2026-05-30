# 数据库结构说明

## 1. 设计原则

- `shared-types` 是领域契约真源
- `init.sql` 是持久化真源
- 表结构为领域对象服务，不反向绑架领域契约

## 2. 表分层

### 仓库 Intelligence 层

- `repositories`
- `repository_scans`
- `repository_files`
- `symbols`
- `symbol_edges`
- `semantic_documents`

### PR Review Runtime 层

- `pull_requests`
- `review_jobs`
- `file_reviews`
- `review_comments`
- `llm_call_logs`
- `context_fetch_logs`

## 3. 关键字段说明

### `repository_files.risk_tags`

用途：

- 标记高风险模块
- 支撑 triage 和上下文优先级

建议值：

- `auth`
- `payment`
- `permission`
- `transaction`
- `database`
- `cache`
- `retry`
- `feature_flag`

### `file_reviews.triage_decision`

用途：

- 记录文件级首轮判断
- 区分直接出结论还是走二轮检索

### `review_comments.evidence_refs`

用途：

- 记录评论证据链
- 前端可以展开“为什么会判这个问题”

### `review_comments.admission_reasons`

用途：

- 记录评论为何被准入或压制
- 后续可做质量分析

## 4. JSONB 字段策略

允许用 JSONB 的地方：

- `raw_payload`
- `metadata`
- `risk_tags`
- `language_summary`
- `framework_summary`
- `evidence_refs`
- `admission_reasons`

不要把核心查询条件全塞 JSONB。

这些字段必须保留结构化列：

- `provider`
- `owner`
- `repo`
- `pr_number`
- `file_path`
- `qualified_name`
- `edge_type`
- `severity`
- `triage_decision`

## 5. 一期索引重点

优先保证这些查询快：

- 按仓库查最新扫描
- 按文件路径查 symbol
- 按 qualified name 查 callers / callees
- 按 review job 查 file reviews
- 按 file review 查 comments

## 6. 后续演进

后面如果出现以下需求，再扩表：

- review 结果版本化
- 多模型对比结果
- 仓库级规则配置
- GitHub writeback 追踪
