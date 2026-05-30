create extension if not exists "uuid-ossp";
create extension if not exists vector;

-- 仓库接入主表。所有扫描和 PR Review 都挂在 repository 之下。
create table if not exists repositories (
  id uuid primary key default uuid_generate_v4(),
  provider varchar(32) not null default 'github',
  owner varchar(255) not null,
  repo varchar(255) not null,
  default_branch varchar(255) not null,
  clone_url text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, owner, repo)
);

comment on table repositories is '仓库接入主表，记录已接入代码仓库的提供方、仓库坐标、默认分支与克隆地址，是扫描和 PR 审查的根实体。';
comment on column repositories.id is '仓库主键 UUID。';
comment on column repositories.provider is '代码托管平台提供方，当前主要为 GitHub。';
comment on column repositories.owner is '仓库所属组织或用户名。';
comment on column repositories.repo is '仓库名称。';
comment on column repositories.default_branch is '仓库默认分支名称。';
comment on column repositories.clone_url is '仓库克隆地址，供扫描任务拉取代码使用。';
comment on column repositories.is_active is '仓库是否启用，停用后不再触发新的扫描和审查。';
comment on column repositories.created_at is '仓库接入记录创建时间。';
comment on column repositories.updated_at is '仓库接入记录最后更新时间。';

-- 仓库扫描任务。记录每次构建语义地图的批次信息。
create table if not exists repository_scans (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid not null references repositories(id) on delete cascade,
  scan_type varchar(32) not null,
  target_sha varchar(64) not null,
  status varchar(32) not null default 'pending',
  language_summary jsonb not null default '[]'::jsonb,
  framework_summary jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table repository_scans is '仓库扫描任务表，记录每次仓库结构扫描或语义地图构建的批次、目标提交、状态和统计摘要。';
comment on column repository_scans.id is '扫描任务主键 UUID。';
comment on column repository_scans.repository_id is '所属仓库 ID，关联 repositories。';
comment on column repository_scans.scan_type is '扫描类型，例如全量扫描或增量扫描。';
comment on column repository_scans.target_sha is '本次扫描针对的提交 SHA。';
comment on column repository_scans.status is '扫描任务状态，例如 pending、running、done、failed。';
comment on column repository_scans.language_summary is '语言统计摘要，记录本次扫描识别出的语言分布。';
comment on column repository_scans.framework_summary is '框架统计摘要，记录本次扫描识别出的框架或技术栈。';
comment on column repository_scans.started_at is '扫描任务开始执行时间。';
comment on column repository_scans.finished_at is '扫描任务完成或失败时间。';
comment on column repository_scans.created_at is '扫描任务记录创建时间。';
comment on column repository_scans.updated_at is '扫描任务记录最后更新时间。';

create index if not exists idx_repository_scans_repository_id
  on repository_scans(repository_id);

-- 文件级语义索引。这里存文件职责、模块归属和风险标签，给结构化检索使用。
create table if not exists repository_files (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid not null references repositories(id) on delete cascade,
  scan_id uuid not null references repository_scans(id) on delete cascade,
  file_path text not null,
  language varchar(64),
  kind varchar(32) not null,
  module_name varchar(255),
  summary text,
  risk_tags jsonb not null default '[]'::jsonb,
  checksum varchar(64),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scan_id, file_path)
);

comment on table repository_files is '仓库文件索引表，保存扫描后每个文件的语言、类型、模块归属、职责摘要和风险标签，供结构化检索使用。';
comment on column repository_files.id is '文件索引记录主键 UUID。';
comment on column repository_files.repository_id is '所属仓库 ID，关联 repositories。';
comment on column repository_files.scan_id is '来源扫描任务 ID，关联 repository_scans。';
comment on column repository_files.file_path is '文件在仓库中的相对路径。';
comment on column repository_files.language is '文件识别出的主要编程语言。';
comment on column repository_files.kind is '文件类型，例如 source、test、config、doc。';
comment on column repository_files.module_name is '文件归属的模块名或业务域名。';
comment on column repository_files.summary is '文件职责摘要，供检索和提示词拼装使用。';
comment on column repository_files.risk_tags is '文件风险标签列表，例如 auth、payment、database。';
comment on column repository_files.checksum is '文件内容摘要值，用于判断文件是否变化。';
comment on column repository_files.metadata is '补充元数据，例如解析器输出或扩展属性。';
comment on column repository_files.created_at is '文件索引记录创建时间。';
comment on column repository_files.updated_at is '文件索引记录最后更新时间。';

create index if not exists idx_repository_files_repository_id
  on repository_files(repository_id);

create index if not exists idx_repository_files_module_name
  on repository_files(module_name);

-- Symbol 真源表。这里存结构化代码事实，不依赖向量检索猜测。
create table if not exists symbols (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid not null references repositories(id) on delete cascade,
  scan_id uuid not null references repository_scans(id) on delete cascade,
  file_path text not null,
  symbol_name text not null,
  qualified_name text not null,
  kind varchar(32) not null,
  start_line int not null,
  end_line int not null,
  signature text,
  module_name varchar(255),
  risk_tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scan_id, qualified_name)
);

comment on table symbols is '代码符号表，保存函数、类、接口等结构化代码实体及其定位信息，是调用链和符号检索的事实来源。';
comment on column symbols.id is '代码符号记录主键 UUID。';
comment on column symbols.repository_id is '所属仓库 ID，关联 repositories。';
comment on column symbols.scan_id is '来源扫描任务 ID，关联 repository_scans。';
comment on column symbols.file_path is '符号所在文件路径。';
comment on column symbols.symbol_name is '符号短名称，例如函数名或类名。';
comment on column symbols.qualified_name is '符号限定名，用于跨文件唯一标识实体。';
comment on column symbols.kind is '符号类型，例如 function、class、interface。';
comment on column symbols.start_line is '符号定义起始行号。';
comment on column symbols.end_line is '符号定义结束行号。';
comment on column symbols.signature is '符号签名文本，例如函数参数和返回值声明。';
comment on column symbols.module_name is '符号所属模块名或业务域名。';
comment on column symbols.risk_tags is '符号风险标签列表，标注高风险能力。';
comment on column symbols.metadata is '符号扩展元数据，例如可见性、装饰器、所属类型。';
comment on column symbols.created_at is '代码符号记录创建时间。';
comment on column symbols.updated_at is '代码符号记录最后更新时间。';

create index if not exists idx_symbols_repository_id
  on symbols(repository_id);

create index if not exists idx_symbols_file_path
  on symbols(file_path);

create index if not exists idx_symbols_module_name
  on symbols(module_name);

-- Symbol 之间的关系边。后续调用链、导入链、测试关联都从这里查。
create table if not exists symbol_edges (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid not null references repositories(id) on delete cascade,
  scan_id uuid not null references repository_scans(id) on delete cascade,
  from_qualified_name text not null,
  to_qualified_name text not null,
  edge_type varchar(32) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table symbol_edges is '符号关系表，保存调用、导入、依赖、测试关联等符号之间的边关系，用于影响面分析和上下文扩展。';
comment on column symbol_edges.id is '符号关系记录主键 UUID。';
comment on column symbol_edges.repository_id is '所属仓库 ID，关联 repositories。';
comment on column symbol_edges.scan_id is '来源扫描任务 ID，关联 repository_scans。';
comment on column symbol_edges.from_qualified_name is '关系起点符号的限定名。';
comment on column symbol_edges.to_qualified_name is '关系终点符号的限定名。';
comment on column symbol_edges.edge_type is '关系类型，例如 calls、imports、tests。';
comment on column symbol_edges.metadata is '关系补充元数据，例如调用位置或解析置信度。';
comment on column symbol_edges.created_at is '符号关系记录创建时间。';

create index if not exists idx_symbol_edges_scan_id
  on symbol_edges(scan_id);

create index if not exists idx_symbol_edges_from_qn
  on symbol_edges(from_qualified_name);

create index if not exists idx_symbol_edges_to_qn
  on symbol_edges(to_qualified_name);

-- 文档和摘要语料。这里只存适合语义检索的内容，不存整仓源码全文。
create table if not exists semantic_documents (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid not null references repositories(id) on delete cascade,
  scan_id uuid not null references repository_scans(id) on delete cascade,
  source_path text not null,
  document_type varchar(32) not null,
  chunk_index int not null,
  title varchar(255),
  module_name varchar(255),
  content text not null,
  tags jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (scan_id, source_path, chunk_index)
);

comment on table semantic_documents is '语义文档分片表，保存 README、设计文档、模块摘要等适合向量检索的文本内容及其 embedding。';
comment on column semantic_documents.id is '语义文档分片主键 UUID。';
comment on column semantic_documents.repository_id is '所属仓库 ID，关联 repositories。';
comment on column semantic_documents.scan_id is '来源扫描任务 ID，关联 repository_scans。';
comment on column semantic_documents.source_path is '文档来源路径，例如 README 或 docs 文件路径。';
comment on column semantic_documents.document_type is '文档类型，例如 readme、adr、module_summary。';
comment on column semantic_documents.chunk_index is '同一文档拆分后的分片序号。';
comment on column semantic_documents.title is '文档或分片标题。';
comment on column semantic_documents.module_name is '文档所属模块名或业务域名。';
comment on column semantic_documents.content is '用于语义检索的文档正文分片内容。';
comment on column semantic_documents.tags is '文档标签列表，辅助过滤和检索。';
comment on column semantic_documents.metadata is '文档扩展元数据，例如标题层级、来源规则。';
comment on column semantic_documents.embedding is '文档向量 embedding，用于相似度检索。';
comment on column semantic_documents.created_at is '语义文档分片创建时间。';

create index if not exists idx_semantic_documents_repository_id
  on semantic_documents(repository_id);

create index if not exists idx_semantic_documents_doc_type
  on semantic_documents(document_type);

-- PR 元信息。这里保留 GitHub 真源快照，避免后续反复回源。
create table if not exists pull_requests (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid references repositories(id) on delete set null,
  provider varchar(32) not null default 'github',
  owner varchar(255) not null,
  repo varchar(255) not null,
  pr_number int not null,
  title text not null,
  author_login varchar(255),
  base_branch varchar(255) not null,
  head_branch varchar(255) not null,
  base_sha varchar(64) not null,
  head_sha varchar(64) not null,
  changed_files int not null default 0,
  additions int not null default 0,
  deletions int not null default 0,
  state varchar(32) not null default 'open',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, owner, repo, pr_number)
);

comment on table pull_requests is 'PR 快照表，保存 GitHub Pull Request 的元信息、分支与提交范围、改动统计及原始响应数据。';
comment on column pull_requests.id is 'PR 快照记录主键 UUID。';
comment on column pull_requests.repository_id is '关联仓库 ID，允许为空以兼容未绑定仓库的 PR。';
comment on column pull_requests.provider is '代码托管平台提供方，当前主要为 GitHub。';
comment on column pull_requests.owner is 'PR 所属仓库 owner。';
comment on column pull_requests.repo is 'PR 所属仓库名称。';
comment on column pull_requests.pr_number is 'Pull Request 编号。';
comment on column pull_requests.title is 'Pull Request 标题。';
comment on column pull_requests.author_login is 'PR 作者登录名。';
comment on column pull_requests.base_branch is 'PR 目标分支名称。';
comment on column pull_requests.head_branch is 'PR 来源分支名称。';
comment on column pull_requests.base_sha is 'PR 基线提交 SHA。';
comment on column pull_requests.head_sha is 'PR 头部提交 SHA。';
comment on column pull_requests.changed_files is 'PR 变更文件数量。';
comment on column pull_requests.additions is 'PR 新增代码行数。';
comment on column pull_requests.deletions is 'PR 删除代码行数。';
comment on column pull_requests.state is 'PR 当前状态，例如 open、closed、merged。';
comment on column pull_requests.raw_payload is 'GitHub 原始响应快照，便于后续补充字段。';
comment on column pull_requests.created_at is 'PR 快照记录创建时间。';
comment on column pull_requests.updated_at is 'PR 快照记录最后更新时间。';

create index if not exists idx_pull_requests_repository_id
  on pull_requests(repository_id);

-- 一次完整 review run 的聚合状态。前端进度和成本统计都读这里。
create table if not exists review_jobs (
  id uuid primary key default uuid_generate_v4(),
  repository_id uuid references repositories(id) on delete set null,
  pull_request_id uuid references pull_requests(id) on delete cascade,
  trigger_source varchar(32) not null default 'manual',
  status varchar(32) not null default 'pending',
  total_files int not null default 0,
  finished_files int not null default 0,
  total_slices int not null default 0,
  finished_slices int not null default 0,
  cache_hit_files int not null default 0,
  llm_provider varchar(64),
  llm_model varchar(128),
  total_input_tokens int not null default 0,
  total_output_tokens int not null default 0,
  total_cost_usd numeric(12, 6) not null default 0,
  duration_ms int,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table review_jobs is '审查任务主表，表示一次完整的 PR Review 运行，汇总状态、进度、模型、Token 消耗、成本和耗时。';
comment on column review_jobs.id is '审查任务主键 UUID。';
comment on column review_jobs.repository_id is '关联仓库 ID。';
comment on column review_jobs.pull_request_id is '关联的 PR 记录 ID。';
comment on column review_jobs.trigger_source is '任务触发来源，例如 manual、webhook、retry。';
comment on column review_jobs.status is '审查任务整体状态，例如 pending、running、done、failed。';
comment on column review_jobs.total_files is '本次审查需要处理的总文件数。';
comment on column review_jobs.finished_files is '本次审查已经完成的文件数。';
comment on column review_jobs.total_slices is '本次审查切分出的总片段数。';
comment on column review_jobs.finished_slices is '已经完成分析的片段数。';
comment on column review_jobs.cache_hit_files is '命中缓存而跳过重新分析的文件数。';
comment on column review_jobs.llm_provider is '本次任务使用的大模型提供方。';
comment on column review_jobs.llm_model is '本次任务使用的大模型名称。';
comment on column review_jobs.total_input_tokens is '本次任务累计输入 Token 数。';
comment on column review_jobs.total_output_tokens is '本次任务累计输出 Token 数。';
comment on column review_jobs.total_cost_usd is '本次任务累计模型调用成本，单位美元。';
comment on column review_jobs.duration_ms is '本次任务总耗时，单位毫秒。';
comment on column review_jobs.error_message is '任务失败时记录的错误信息。';
comment on column review_jobs.started_at is '审查任务开始执行时间。';
comment on column review_jobs.finished_at is '审查任务结束时间。';
comment on column review_jobs.created_at is '审查任务记录创建时间。';
comment on column review_jobs.updated_at is '审查任务记录最后更新时间。';

create index if not exists idx_review_jobs_pull_request_id
  on review_jobs(pull_request_id);

-- 文件级 review 聚合结果。前端文件列表和二轮审查状态主要依赖这张表。
create table if not exists file_reviews (
  id uuid primary key default uuid_generate_v4(),
  review_job_id uuid not null references review_jobs(id) on delete cascade,
  pull_request_id uuid references pull_requests(id) on delete cascade,
  file_path text not null,
  language varchar(64),
  file_status varchar(32) not null,
  patch_sha256 varchar(64),
  is_cached boolean not null default false,
  slice_count int not null default 1,
  ai_comment_count int not null default 0,
  rule_comment_count int not null default 0,
  highest_severity varchar(16) not null default 'NONE',
  risk_score int not null default 0,
  summary text,
  duration_ms int,
  triage_decision varchar(32),
  context_round int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_job_id, file_path)
);

comment on table file_reviews is '文件审查结果表，保存单个文件在某次审查任务中的状态、风险分、评论数量、摘要和上下文轮次。';
comment on column file_reviews.id is '文件审查记录主键 UUID。';
comment on column file_reviews.review_job_id is '所属审查任务 ID，关联 review_jobs。';
comment on column file_reviews.pull_request_id is '所属 PR 记录 ID，便于按 PR 查询文件结果。';
comment on column file_reviews.file_path is 'PR 中被审查文件的相对路径。';
comment on column file_reviews.language is '文件识别出的主要编程语言。';
comment on column file_reviews.file_status is '文件审查状态，例如 pending、running、done、failed。';
comment on column file_reviews.patch_sha256 is '当前文件 diff patch 的摘要值，用于缓存和去重。';
comment on column file_reviews.is_cached is '是否直接复用了历史缓存结果。';
comment on column file_reviews.slice_count is '该文件被拆分成的审查片段数量。';
comment on column file_reviews.ai_comment_count is 'AI 产出的评论数量。';
comment on column file_reviews.rule_comment_count is '规则引擎产出的评论数量。';
comment on column file_reviews.highest_severity is '该文件命中的最高严重级别。';
comment on column file_reviews.risk_score is '该文件综合风险分。';
comment on column file_reviews.summary is '该文件审查摘要。';
comment on column file_reviews.duration_ms is '该文件完成审查的耗时，单位毫秒。';
comment on column file_reviews.triage_decision is '首轮审查后的分流决策，例如 direct、need_more_context。';
comment on column file_reviews.context_round is '该文件已进行的上下文补充轮次。';
comment on column file_reviews.created_at is '文件审查记录创建时间。';
comment on column file_reviews.updated_at is '文件审查记录最后更新时间。';

create index if not exists idx_file_reviews_review_job_id
  on file_reviews(review_job_id);

-- 最终评论表。这里保留锚点、证据链、质量分和准入理由，方便审计和回写。
create table if not exists review_comments (
  id uuid primary key default uuid_generate_v4(),
  review_job_id uuid not null references review_jobs(id) on delete cascade,
  file_review_id uuid references file_reviews(id) on delete cascade,
  source varchar(16) not null,
  category varchar(64) not null,
  severity varchar(16) not null,
  title varchar(255) not null,
  message text not null,
  suggestion text,
  file_path text not null,
  diff_line_ref text,
  line_start int,
  line_end int,
  old_line_start int,
  old_line_end int,
  fingerprint varchar(64),
  evidence_refs jsonb not null default '[]'::jsonb,
  quality_score numeric(5, 2),
  admission_reasons jsonb not null default '[]'::jsonb,
  is_resolved boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table review_comments is '审查评论表，保存最终产出的规则评论和 AI 评论，包括锚点行号、证据链、质量分与准入理由。';
comment on column review_comments.id is '审查评论主键 UUID。';
comment on column review_comments.review_job_id is '所属审查任务 ID，关联 review_jobs。';
comment on column review_comments.file_review_id is '所属文件审查记录 ID，关联 file_reviews。';
comment on column review_comments.source is '评论来源，例如 ai 或 rule。';
comment on column review_comments.category is '评论分类，例如 security、perf、correctness。';
comment on column review_comments.severity is '评论严重级别，例如 HIGH、MEDIUM、LOW。';
comment on column review_comments.title is '评论标题，供列表和 GitHub Review 展示。';
comment on column review_comments.message is '评论主体内容，说明问题本身。';
comment on column review_comments.suggestion is '可选修复建议或替代实现。';
comment on column review_comments.file_path is '评论指向的文件路径。';
comment on column review_comments.diff_line_ref is '评论在 diff 视图中的稳定锚点标识。';
comment on column review_comments.line_start is '新文件视角的起始行号。';
comment on column review_comments.line_end is '新文件视角的结束行号。';
comment on column review_comments.old_line_start is '旧文件视角的起始行号。';
comment on column review_comments.old_line_end is '旧文件视角的结束行号。';
comment on column review_comments.fingerprint is '评论指纹，用于去重、聚合和解决状态追踪。';
comment on column review_comments.evidence_refs is '评论证据引用列表，指向 diff、符号、上下文或规则命中。';
comment on column review_comments.quality_score is '评论质量评分，用于压制低信号输出。';
comment on column review_comments.admission_reasons is '评论通过准入门禁的原因列表。';
comment on column review_comments.is_resolved is '该评论是否已经被标记为已处理。';
comment on column review_comments.metadata is '评论扩展元数据，例如模型版本、聚合标签。';
comment on column review_comments.created_at is '审查评论创建时间。';
comment on column review_comments.updated_at is '审查评论最后更新时间。';

create index if not exists idx_review_comments_review_job_id
  on review_comments(review_job_id);

create index if not exists idx_review_comments_file_path
  on review_comments(file_path);

create index if not exists idx_review_comments_fingerprint
  on review_comments(fingerprint);

-- LLM 和上下文检索日志独立存档，方便追查“为什么模型会这么判”。
create table if not exists llm_call_logs (
  id uuid primary key default uuid_generate_v4(),
  review_job_id uuid references review_jobs(id) on delete cascade,
  file_review_id uuid references file_reviews(id) on delete cascade,
  provider varchar(64) not null,
  model varchar(128) not null,
  prompt_kind varchar(64) not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  latency_ms int,
  request_metadata jsonb not null default '{}'::jsonb,
  response_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table llm_call_logs is '大模型调用日志表，记录每次提示词调用的模型、Token、成本、耗时以及请求响应元数据，便于排障和审计。';
comment on column llm_call_logs.id is '大模型调用日志主键 UUID。';
comment on column llm_call_logs.review_job_id is '关联的审查任务 ID。';
comment on column llm_call_logs.file_review_id is '关联的文件审查记录 ID。';
comment on column llm_call_logs.provider is '大模型提供方名称。';
comment on column llm_call_logs.model is '大模型具体型号。';
comment on column llm_call_logs.prompt_kind is '提示词类型，例如 triage、review、context_followup。';
comment on column llm_call_logs.input_tokens is '本次调用输入 Token 数。';
comment on column llm_call_logs.output_tokens is '本次调用输出 Token 数。';
comment on column llm_call_logs.cost_usd is '本次调用成本，单位美元。';
comment on column llm_call_logs.latency_ms is '本次调用耗时，单位毫秒。';
comment on column llm_call_logs.request_metadata is '请求侧元数据，例如 prompt hash、路由策略、重试信息。';
comment on column llm_call_logs.response_metadata is '响应侧元数据，例如 finish reason、provider response id。';
comment on column llm_call_logs.created_at is '大模型调用日志创建时间。';

create table if not exists context_fetch_logs (
  id uuid primary key default uuid_generate_v4(),
  review_job_id uuid references review_jobs(id) on delete cascade,
  file_review_id uuid references file_reviews(id) on delete cascade,
  request_payload jsonb not null,
  result_payload jsonb not null,
  planned_tool_calls int not null default 0,
  used_round int not null default 0,
  created_at timestamptz not null default now()
);

comment on table context_fetch_logs is '上下文检索日志表，记录二轮审查期间的上下文请求、检索结果、计划调用数和实际轮次，用于解释审查依据。';
comment on column context_fetch_logs.id is '上下文检索日志主键 UUID。';
comment on column context_fetch_logs.review_job_id is '关联的审查任务 ID。';
comment on column context_fetch_logs.file_review_id is '关联的文件审查记录 ID。';
comment on column context_fetch_logs.request_payload is '上下文请求载荷，记录 triage 触发后的检索需求。';
comment on column context_fetch_logs.result_payload is '上下文检索结果载荷，记录实际返回的代码和文档上下文。';
comment on column context_fetch_logs.planned_tool_calls is '本轮计划执行的检索工具调用数量。';
comment on column context_fetch_logs.used_round is '该条日志所属的上下文补充轮次。';
comment on column context_fetch_logs.created_at is '上下文检索日志创建时间。';
