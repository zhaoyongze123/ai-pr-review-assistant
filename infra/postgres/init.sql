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
  diff_line_ref varchar(64),
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
