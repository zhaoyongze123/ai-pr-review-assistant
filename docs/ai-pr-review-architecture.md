# AI PR Review 助手详细开发方案

## 1. 文档目标

本文档用于指导 `AI PR Review 助手` 的本地开发与实现，重点围绕“数据如何流转”来定义系统架构、模块边界、数据库结构、前后端职责、接口契约与本地运行方式。

约束范围：

- 仅覆盖本地开发与联调方案
- 部署方式限定为 `Docker Compose`
- 不展开线上部署、Kubernetes、灰度发布、多地域容灾
- 默认目标平台为 GitHub Pull Request 审查场景

---

## 2. 设计目标

### 2.1 核心目标

1. 自动获取 GitHub PR 元信息、改动文件与 patch diff。
2. 对 PR 中的每个文件执行“规则审查 + AI 审查”双通路分析。
3. 以文件为粒度流式返回审查结果，支持前端实时增量展示。
4. 将 AI 输出转为结构化评论，并与 diff 精准联动。
5. 支持缓存复用、历史检索增强、可选 GitHub Review 回写。

### 2.2 非目标

- 不做完整代码托管平台，只聚焦 PR Review。
- 不做全仓库静态扫描平台。
- 不做多人协作权限系统一期实现。
- 不做线上多租户隔离与计费系统。

### 2.3 架构原则

- 数据流优先：所有模块以输入/输出契约解耦。
- 文件粒度并发：每个文件或切片作为独立分析单元。
- 结构化优先：LLM 输出必须以 JSON Schema 收敛。
- 可回放：关键请求、响应、状态变化可审计。
- 可缓存：相同 PR + 相同 commit SHA 结果可复用。

---

## 3. 总体架构

## 3.1 分层视图

- 接入层：GitHub API、前端 UI、WebSocket 客户端
- 应用层：PR Fetcher、Orchestrator、Prompt Builder、Response Parser、GitHub Writer
- 分析层：Rule Engine、LLM Gateway
- 数据层：PostgreSQL、pgvector、Redis、MinIO
- 可观测层：OpenTelemetry、日志、任务状态事件

## 3.2 Mermaid 架构图

```mermaid
flowchart LR
    User["用户 / 前端 React"] -->|REST| Api["Backend API / NestJS"]
    User -->|WebSocket| Ws["Socket Gateway"]

    Api --> Orchestrator["Orchestrator"]
    Api --> GithubWriter["GitHub Review Writer"]

    Orchestrator --> Fetcher["PR Fetcher"]
    Fetcher --> GitHub["GitHub GraphQL + REST API"]

    Orchestrator --> DiffParser["Diff Parser + Line Mapper"]
    Orchestrator --> Queue["BullMQ Queue"]
    Queue --> Worker["Review Worker"]

    Worker --> RuleEngine["Rule Engine<br/>Semgrep / ESLint API"]
    Worker --> PromptBuilder["Prompt Builder"]
    PromptBuilder --> LLMGateway["LLM Gateway"]
    LLMGateway --> ProviderA["OpenAI"]
    LLMGateway --> ProviderB["Anthropic"]
    LLMGateway --> ProviderC["Azure OpenAI"]

    Worker --> ResponseParser["Response Parser"]
    RuleEngine --> Merger["Result Merger"]
    ResponseParser --> Merger["Result Merger"]

    Merger --> Postgres["PostgreSQL"]
    Merger --> Vector["pgvector"]
    LLMGateway --> MinIO["MinIO"]
    Orchestrator --> Redis["Redis"]

    Postgres --> Api
    Api --> Ws
    Ws --> User

    Api --> OTel["OpenTelemetry"]
    Worker --> OTel
```

## 3.3 核心模块职责

| 模块 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| PR Fetcher | 拉取 PR 元信息、文件列表、patch | repo、PR number | PR 基础数据、文件 patch |
| Diff Parser | 解析 patch，构建 hunk 与行号映射 | patch 文本 | `DiffHunk[]`、行号映射 |
| Orchestrator | 切分任务、入队、广播进度、聚合状态 | PR 数据、patch、配置 | `review_jobs`、队列任务 |
| Rule Engine | 规则扫描 | 文件内容、diff、规则配置 | `RuleViolation[]` |
| Prompt Builder | 构建多语言 Prompt | 语言、diff、上下文、历史样本 | 结构化模型请求 |
| LLM Gateway | 多 provider 调度、超时回退、SSE 处理 | Prompt 请求 | 原始响应、结构化输出 |
| Response Parser | JSON 校验、行号反解、结果标准化 | LLM 输出、行号映射 | `AiReviewComment[]` |
| Result Merger | 合并规则与 AI 结果并写库 | Rule + AI 结果 | 文件级、评论级持久化 |
| GitHub Writer | 把评论回写 GitHub | 审查评论 | GitHub Review Comments |

---

## 4. 数据流设计

## 4.1 主流程

1. 前端触发“分析 PR”。
2. 后端创建 `review_job` 记录。
3. PR Fetcher 调 GitHub GraphQL 获取 PR 基础信息和文件列表。
4. PR Fetcher 调 GitHub REST 获取各文件 patch。
5. Diff Parser 将 patch 解析为结构化 hunk，并建立“diff 行标识 -> 新文件真实行号”映射。
6. Orchestrator 按文件语言分组，按 token 阈值决定是否切片。
7. 每个文件/切片作为独立任务写入 BullMQ。
8. Worker 并发执行 Rule Engine 和 LLM 分析。
9. Response Parser 校验 LLM 输出 JSON，完成行号映射。
10. Result Merger 合并规则结果与 AI 结果，写入 PostgreSQL。
11. Orchestrator 广播 `file_review_complete` 事件。
12. 前端增量更新文件列表与 Diff Viewer。
13. 所有任务完成后更新 `review_jobs.status = done`。

## 4.2 Mermaid 流程图

```mermaid
flowchart TD
    A["前端触发分析"] --> B["创建 review_job"]
    B --> C["获取 PR 元信息和文件列表"]
    C --> D["获取每个文件 patch"]
    D --> E["解析 patch 和行号映射"]
    E --> F{"文件是否超出 token 阈值"}
    F -- 否 --> G["按文件入队"]
    F -- 是 --> H["按 hunk 或窗口切片入队"]
    G --> I["Worker 执行规则审查与 AI 审查"]
    H --> I
    I --> J["结构化解析 AI 输出"]
    J --> K["合并规则结果与 AI 结果"]
    K --> L["写入 PostgreSQL / pgvector / MinIO"]
    L --> M["广播文件完成事件"]
    M --> N{"是否全部完成"}
    N -- 否 --> I
    N -- 是 --> O["更新 job 状态为 done"]
```

## 4.3 Mermaid 时序图

```mermaid
sequenceDiagram
    participant UI as 前端 UI
    participant API as NestJS API
    participant ORC as Orchestrator
    participant GH as GitHub API
    participant Q as BullMQ
    participant WK as Review Worker
    participant LLM as LLM Gateway
    participant DB as PostgreSQL
    participant WS as WebSocket

    UI->>API: POST /api/review-jobs
    API->>DB: 创建 review_job
    API->>ORC: 启动分析
    ORC->>GH: 拉取 PR 元信息 + 文件列表
    ORC->>GH: 拉取 patch
    ORC->>Q: 为每个文件/切片入队

    loop 每个文件任务
        Q->>WK: 分发任务
        par 规则审查
            WK->>WK: 执行 Semgrep / ESLint
        and AI 审查
            WK->>LLM: 发送结构化 Prompt
            LLM-->>WK: SSE/JSON 响应
        end
        WK->>DB: 写 file_reviews + review_comments
        WK->>WS: 推送 file_review_complete
        WS-->>UI: 增量更新结果
    end

    ORC->>DB: 更新 review_job done
    ORC->>WS: 推送 review_job_done
    WS-->>UI: 刷新整体状态
```

---

## 5. 技术栈

## 5.1 后端

| 组件 | 技术选型 | 说明 |
| --- | --- | --- |
| API 框架 | NestJS | 结构清晰，适合模块化和队列/网关整合 |
| 语言 | TypeScript | 与前端共享类型定义，降低契约漂移 |
| 队列 | BullMQ | 基于 Redis，支持并发、重试、延迟任务 |
| 数据库 | PostgreSQL 16 | 主数据存储 |
| 向量检索 | pgvector | 历史审查相似问题检索 |
| 对象存储 | MinIO | 存原始 LLM 响应、patch 快照 |
| 规则引擎 | Python Sidecar + semgrep / ESLint | 规则执行与 Node 主进程解耦 |
| 可观测性 | OpenTelemetry | Trace、metrics、日志关联 |

## 5.2 前端

| 组件 | 技术选型 | 说明 |
| --- | --- | --- |
| 框架 | React + TypeScript | 便于组件化与状态管理 |
| 状态管理 | Zustand | 轻量，适合局部增量更新 |
| 服务端状态 | TanStack Query | 管理 PR 元信息、任务状态缓存 |
| Diff 展示 | diff2html | 避免自研 diff 渲染 |
| 实时通道 | socket.io-client | 便于对接 Socket.IO 网关 |
| 样式 | Tailwind CSS | 快速构建后台类界面 |

## 5.3 本地开发基础设施

| 组件 | 用途 |
| --- | --- |
| Docker Compose | 本地编排 PostgreSQL、Redis、MinIO、Python Sidecar |
| pnpm | Node Monorepo 包管理 |
| turbo 或 nx | 可选，用于管理多包构建 |

---

## 6. 建议目录结构

```text
ai-pr-review-assistant/
├── apps/
│   ├── api/                    # NestJS API
│   ├── worker/                 # BullMQ Worker
│   └── web/                    # React 前端
├── packages/
│   ├── shared-types/           # 前后端共享类型与 Schema
│   ├── diff-core/              # patch 解析、行号映射
│   ├── prompt-builder/         # Prompt 模板与上下文拼装
│   ├── llm-contracts/          # LLM 输出 Schema
│   └── config/                 # 环境变量、默认配置
├── services/
│   └── rule-engine/            # Python semgrep / eslint sidecar
├── docs/
│   └── ai-pr-review-architecture.md
├── infra/
│   ├── docker-compose.yml
│   ├── postgres/
│   │   └── init.sql
│   └── minio/
├── prompts/
│   ├── common/
│   ├── ts/
│   ├── py/
│   └── go/
└── .env.example
```

---

## 7. 数据模型设计

## 7.1 核心表

系统核心以五张业务表为主，再补充若干支撑表。

### 7.1.1 `pull_requests`

记录 PR 元信息，是所有分析任务的上游实体。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid pk | 主键 |
| provider | varchar(32) | 平台，当前固定 `github` |
| owner | varchar(255) | 仓库 owner |
| repo | varchar(255) | 仓库名 |
| pr_number | int | PR 编号 |
| title | text | 标题 |
| author_login | varchar(255) | 作者 |
| base_branch | varchar(255) | 基线分支 |
| head_branch | varchar(255) | 变更分支 |
| base_sha | varchar(64) | base commit SHA |
| head_sha | varchar(64) | head commit SHA |
| changed_files | int | 文件数 |
| additions | int | 新增行数 |
| deletions | int | 删除行数 |
| state | varchar(32) | open / closed / merged |
| raw_payload | jsonb | 原始 PR 元信息快照 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

唯一约束建议：

- `(provider, owner, repo, pr_number)`

### 7.1.2 `review_jobs`

代表一次完整的 PR 分析任务。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid pk | 主键 |
| pull_request_id | uuid fk | 关联 PR |
| trigger_source | varchar(32) | manual / webhook / retry |
| status | varchar(32) | pending / running / done / failed / canceled |
| total_files | int | 总文件数 |
| finished_files | int | 已完成文件数 |
| total_slices | int | 总切片数 |
| finished_slices | int | 已完成切片数 |
| cache_hit_files | int | 命中缓存文件数 |
| llm_provider | varchar(64) | 主 provider |
| llm_model | varchar(128) | 主模型 |
| total_input_tokens | int | 输入 token |
| total_output_tokens | int | 输出 token |
| total_cost_usd | numeric(12,6) | 总成本 |
| duration_ms | int | 总耗时 |
| error_message | text | 失败摘要 |
| started_at | timestamptz | 开始时间 |
| finished_at | timestamptz | 完成时间 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### 7.1.3 `file_reviews`

每个文件对应一条聚合审查结果。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid pk | 主键 |
| review_job_id | uuid fk | 所属任务 |
| pull_request_id | uuid fk | 所属 PR |
| file_path | text | 文件路径 |
| language | varchar(64) | 识别语言 |
| file_status | varchar(32) | added / modified / removed / renamed |
| patch_sha256 | varchar(64) | patch 指纹 |
| is_cached | boolean | 是否缓存命中 |
| slice_count | int | 切片数量 |
| ai_comment_count | int | AI 评论数 |
| rule_comment_count | int | 规则评论数 |
| highest_severity | varchar(16) | HIGH / MEDIUM / LOW / INFO / NONE |
| risk_score | int | 0-100 |
| summary | text | 文件级总结 |
| duration_ms | int | 文件分析耗时 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

唯一约束建议：

- `(review_job_id, file_path)`

### 7.1.4 `review_comments`

记录每条具体问题。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid pk | 主键 |
| review_job_id | uuid fk | 所属任务 |
| file_review_id | uuid fk | 所属文件审查 |
| source | varchar(16) | ai / rule / human |
| category | varchar(64) | security / bug / perf / style / maintainability |
| severity | varchar(16) | HIGH / MEDIUM / LOW / INFO |
| title | varchar(255) | 问题标题 |
| message | text | 详细描述 |
| suggestion | text | 修复建议 |
| file_path | text | 文件路径，便于直接查询 |
| diff_line_ref | varchar(64) | 例如 `L101+` |
| line_start | int | 新文件起始行 |
| line_end | int | 新文件结束行 |
| old_line_start | int | 旧文件起始行，可为空 |
| old_line_end | int | 旧文件结束行，可为空 |
| fingerprint | varchar(64) | 去重指纹 |
| is_resolved | boolean | 是否已解决 |
| metadata | jsonb | 规则 ID、模型名等附加信息 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

### 7.1.5 `rule_configs`

组织级规则配置。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid pk | 主键 |
| scope_type | varchar(32) | global / org / repo |
| scope_key | varchar(255) | 作用域标识 |
| name | varchar(255) | 规则名称 |
| engine | varchar(32) | semgrep / eslint |
| priority | int | 优先级 |
| enabled | boolean | 是否启用 |
| yaml_content | text | YAML 定义 |
| version | int | 版本 |
| created_at | timestamptz | 创建时间 |
| updated_at | timestamptz | 更新时间 |

## 7.2 支撑表建议

为提高可追踪性，建议增加以下表：

- `review_job_slices`：记录每个文件切片任务
- `llm_requests`：记录模型请求元数据与成本
- `github_writebacks`：记录评论回写 GitHub 的结果
- `code_embeddings`：存历史 `(代码片段, comment)` 向量

## 7.3 PostgreSQL DDL 草案

```sql
create extension if not exists "uuid-ossp";
create extension if not exists vector;

create table pull_requests (
  id uuid primary key default uuid_generate_v4(),
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
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, owner, repo, pr_number)
);

create table review_jobs (
  id uuid primary key default uuid_generate_v4(),
  pull_request_id uuid not null references pull_requests(id) on delete cascade,
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

create table file_reviews (
  id uuid primary key default uuid_generate_v4(),
  review_job_id uuid not null references review_jobs(id) on delete cascade,
  pull_request_id uuid not null references pull_requests(id) on delete cascade,
  file_path text not null,
  language varchar(64),
  file_status varchar(32) not null,
  patch_sha256 varchar(64) not null,
  is_cached boolean not null default false,
  slice_count int not null default 1,
  ai_comment_count int not null default 0,
  rule_comment_count int not null default 0,
  highest_severity varchar(16) not null default 'NONE',
  risk_score int not null default 0,
  summary text,
  duration_ms int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_job_id, file_path)
);

create table review_comments (
  id uuid primary key default uuid_generate_v4(),
  review_job_id uuid not null references review_jobs(id) on delete cascade,
  file_review_id uuid not null references file_reviews(id) on delete cascade,
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
  is_resolved boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table rule_configs (
  id uuid primary key default uuid_generate_v4(),
  scope_type varchar(32) not null,
  scope_key varchar(255) not null,
  name varchar(255) not null,
  engine varchar(32) not null,
  priority int not null default 100,
  enabled boolean not null default true,
  yaml_content text not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table code_embeddings (
  id uuid primary key default uuid_generate_v4(),
  file_path text not null,
  language varchar(64),
  code_snippet text not null,
  comment_summary text not null,
  source_comment_id uuid references review_comments(id) on delete set null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index idx_pull_requests_lookup on pull_requests(provider, owner, repo, pr_number);
create index idx_review_jobs_pr on review_jobs(pull_request_id, created_at desc);
create index idx_file_reviews_job on file_reviews(review_job_id);
create index idx_review_comments_file_review on review_comments(file_review_id);
create index idx_review_comments_path_line on review_comments(file_path, line_start);
create index idx_code_embeddings_vector on code_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);
```

---

## 8. Diff 与行号映射设计

## 8.1 为什么这是系统关键点

PR Review 的真实交付不是“模型说了什么”，而是“模型说的问题能否准确挂到对应代码行”。如果行号错位，前端定位、GitHub 回写、用户信任都会直接失效。

## 8.2 结构化 DiffHunk

建议将每个 patch 解析为如下结构：

```ts
type DiffLineKind = "context" | "add" | "del";

interface DiffLine {
  kind: DiffLineKind;
  rawText: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  diffLineRef: string | null; // 例如 L101+ / L87- / C120
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}
```

## 8.3 推荐的行引用格式

Prompt 中不要只给裸行号，应该给稳定引用标识：

- 新增行：`L101+`
- 删除行：`L87-`
- 上下文行：`C120`

示例：

```diff
@@ -98,6 +101,8 @@
 C100 const result = await service.run();
 L101+ if (!token) {
 L102+   return true;
 C103 }
```

这样模型返回的不是“不稳定的第 3 行”，而是稳定的 `L101+`。

## 8.4 映射策略

1. patch 解析阶段生成 `diffLineRef -> newLineNumber/oldLineNumber` 字典。
2. Prompt 要求模型只输出 `diff_line_ref`，禁止输出自然语言“上面那行”。
3. Parser 将 `diff_line_ref` 反解为真实文件行号。
4. 如果模型输出多个行标识，按最小/最大行号还原范围。
5. 若反解失败，该评论标记为 `unmapped`，不直接回写 GitHub。

---

## 9. 后端设计

## 9.1 模块划分

建议 NestJS 模块如下：

```text
apps/api/src/modules/
├── pull-requests/
├── review-jobs/
├── file-reviews/
├── review-comments/
├── github/
├── diff/
├── rules/
├── llm/
├── websocket/
└── observability/
```

## 9.2 PR Fetcher 设计

### 输入

- `owner`
- `repo`
- `prNumber`
- GitHub token

### 输出

- PR 基础信息
- 变更文件列表
- 每个文件 patch
- 可选文件 blob 内容

### 获取策略

1. GraphQL v4 获取 PR 基础元信息、作者、base/head、文件列表概览。
2. REST API 获取每个文件 `patch`。
3. 对二进制文件、超大文件、无 patch 文件做降级处理：
   - 标记 `unsupported`
   - 仅写元信息，不进 LLM 分析

## 9.3 Orchestrator 设计

### 核心职责

- 创建 `review_job`
- 预估 token
- 文件切片
- 任务入队
- 并发控制
- 重试策略
- 进度广播
- 汇总结束状态

### 切片策略建议

优先级如下：

1. 小文件：整文件分析
2. 中等文件：按 hunk 分片
3. 超大文件：按 hunk + 邻域上下文窗口切片

建议阈值：

- `estimated_tokens <= 6_000`：整文件
- `6_000 < estimated_tokens <= 20_000`：按 hunk
- `> 20_000`：按 hunk + 关键上下文抽样

### 并发建议

- 单个 PR 同时最多分析 8 个文件
- 单个 Worker 最大并发 4
- 单文件失败重试 3 次
- LLM 超时默认 45 秒

## 9.4 Rule Engine 设计

支持两种来源：

- `semgrep`：安全、通用、跨语言
- `eslint`：JS/TS 生态深度规则

统一输出：

```ts
interface RuleViolation {
  source: "rule";
  engine: "semgrep" | "eslint";
  ruleId: string;
  filePath: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: string;
  title: string;
  message: string;
  suggestion?: string;
  lineStart?: number;
  lineEnd?: number;
  metadata?: Record<string, unknown>;
}
```

## 9.5 LLM Gateway 设计

### 目标

- 屏蔽多 provider 差异
- 支持超时回退
- 统一 token/cost 统计
- 保留原始响应

### 统一请求结构

```ts
interface LlmReviewRequest {
  providerPriority: ("openai" | "anthropic" | "azure")[];
  model: string;
  temperature: number;
  timeoutMs: number;
  systemPrompt: string;
  userPrompt: string;
  responseSchema: object;
  metadata: {
    reviewJobId: string;
    filePath: string;
    sliceId?: string;
  };
}
```

### 回退策略

1. 按优先级尝试主 provider
2. 超时、429、5xx 时自动切备用 provider
3. 记录 `fallback_count` 和最终 provider

## 9.6 Response Parser 设计

职责：

- JSON Schema 校验
- 结构标准化
- `diff_line_ref` 反解
- 去重与合并
- 无效评论过滤

去重建议：

- `fingerprint = sha256(file_path + diff_line_ref + category + normalized_title)`

---

## 10. LLM Prompt 与 Structured Output 契约

## 10.1 Prompt 设计原则

- 只让模型审查“变更部分”，不要泛化到整个仓库
- 强制基于 diff 给出证据
- 强制输出结构化 JSON
- 控制评论数量，避免噪声
- 优先高价值问题：正确性、安全、性能、并发、可维护性

## 10.2 System Prompt 要点

建议包含：

- 你的身份是资深代码审查工程师
- 仅根据本次 diff 和提供上下文判断
- 只输出真实问题，不要为评论而评论
- 优先发现 bug、安全、性能、并发、错误处理缺陷
- 风格类问题仅在明显影响可维护性时输出
- 每条评论必须引用 `diff_line_ref`
- 必须返回 JSON，符合给定 schema

## 10.3 Structured Output JSON Schema

```json
{
  "type": "object",
  "required": ["summary", "comments"],
  "properties": {
    "summary": {
      "type": "string",
      "description": "该文件或切片的简短审查总结"
    },
    "comments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "diff_line_ref",
          "severity",
          "category",
          "title",
          "message"
        ],
        "properties": {
          "diff_line_ref": {
            "type": "string",
            "description": "必须使用类似 L101+ 的稳定行引用"
          },
          "line_refs": {
            "type": "array",
            "items": { "type": "string" }
          },
          "severity": {
            "type": "string",
            "enum": ["HIGH", "MEDIUM", "LOW", "INFO"]
          },
          "category": {
            "type": "string",
            "enum": ["security", "bug", "performance", "concurrency", "style", "maintainability", "testing"]
          },
          "title": {
            "type": "string"
          },
          "message": {
            "type": "string"
          },
          "suggestion": {
            "type": "string"
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          }
        }
      }
    }
  }
}
```

## 10.4 LLM 结果标准化类型

```ts
interface AiReviewComment {
  source: "ai";
  diffLineRef: string;
  lineRefs?: string[];
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  category: "security" | "bug" | "performance" | "concurrency" | "style" | "maintainability" | "testing";
  title: string;
  message: string;
  suggestion?: string;
  confidence?: number;
}
```

---

## 11. 缓存与检索增强设计

## 11.1 缓存策略

缓存键建议：

```text
provider:owner:repo:pr_number:head_sha:file_path:patch_sha256:rule_config_version:model
```

命中条件：

- `head_sha` 未变化
- 文件 `patch_sha256` 未变化
- 规则配置版本未变化
- 模型版本未变化

命中后行为：

- 直接复用 `file_reviews` 与 `review_comments`
- 标记 `is_cached = true`
- 不重复调用 LLM

## 11.2 pgvector 增强

存储对象：

- 代码片段
- 历史问题摘要
- 历史建议

检索时机：

- 文件进入 LLM 分析前

检索结果：

- Top 3 相似历史问题

注入方式：

- 作为 few-shot 附加上下文
- 明确标记“仅作历史参考，不要机械复制”

---

## 12. API 契约设计

下述接口默认前缀为 `/api`。

## 12.1 创建审查任务

### 请求

`POST /api/review-jobs`

```json
{
  "provider": "github",
  "owner": "octocat",
  "repo": "hello-world",
  "prNumber": 42,
  "options": {
    "forceRefresh": false,
    "enableGitHubWriteback": false,
    "providerPriority": ["openai", "anthropic"],
    "model": "gpt-4.1"
  }
}
```

### 响应

```json
{
  "jobId": "c2d23d7e-6f01-4a9f-b57d-5e820f8f93d0",
  "status": "pending"
}
```

## 12.2 查询任务详情

### 请求

`GET /api/review-jobs/:jobId`

### 响应

```json
{
  "id": "c2d23d7e-6f01-4a9f-b57d-5e820f8f93d0",
  "status": "running",
  "totalFiles": 12,
  "finishedFiles": 7,
  "totalSlices": 18,
  "finishedSlices": 11,
  "totalCostUsd": 0.42,
  "durationMs": 15432
}
```

## 12.3 查询 PR 审查结果

### 请求

`GET /api/review-jobs/:jobId/results`

### 响应

```json
{
  "prMeta": {
    "owner": "octocat",
    "repo": "hello-world",
    "prNumber": 42,
    "title": "fix: handle token refresh race",
    "baseBranch": "main",
    "headBranch": "fix/token-race"
  },
  "files": [
    {
      "fileReviewId": "1bdf6d34-f7f1-4bc8-b0cc-cff2ca9b4963",
      "filePath": "src/auth/token.ts",
      "language": "ts",
      "highestSeverity": "HIGH",
      "riskScore": 82,
      "summary": "存在 token 缺失分支直接返回成功的问题。",
      "aiCommentCount": 1,
      "ruleCommentCount": 1,
      "comments": [
        {
          "id": "0a4c7414-2fd9-4d34-a027-29a0b4f51d60",
          "source": "ai",
          "category": "bug",
          "severity": "HIGH",
          "title": "缺少 token 时错误返回成功",
          "message": "该分支在 token 为空时直接返回 true，会掩盖真实认证失败。",
          "suggestion": "改为返回失败结果或抛出明确异常。",
          "diffLineRef": "L101+",
          "lineStart": 101,
          "lineEnd": 102
        }
      ]
    }
  ]
}
```

## 12.4 获取文件 diff 详情

### 请求

`GET /api/file-reviews/:fileReviewId/diff`

### 响应

```json
{
  "filePath": "src/auth/token.ts",
  "patch": "@@ -98,6 +101,8 @@\n C100 const result = await service.run();\n L101+ if (!token) {\n L102+   return true;\n C103 }\n",
  "hunks": [
    {
      "header": "@@ -98,6 +101,8 @@",
      "oldStart": 98,
      "newStart": 101,
      "lines": [
        {
          "kind": "add",
          "rawText": "if (!token) {",
          "diffLineRef": "L101+",
          "newLineNumber": 101,
          "oldLineNumber": null
        }
      ]
    }
  ]
}
```

## 12.5 回写 GitHub 评论

### 请求

`POST /api/review-jobs/:jobId/publish`

```json
{
  "commentIds": [
    "0a4c7414-2fd9-4d34-a027-29a0b4f51d60"
  ]
}
```

### 响应

```json
{
  "publishedCount": 1,
  "failedCount": 0
}
```

---

## 13. WebSocket 契约

命名建议使用 Socket.IO 事件。

## 13.1 连接方式

- namespace: `/review-jobs`
- room: `job:{jobId}`

## 13.2 事件定义

### `review_job_started`

```json
{
  "jobId": "c2d23d7e-6f01-4a9f-b57d-5e820f8f93d0",
  "status": "running",
  "totalFiles": 12,
  "totalSlices": 18
}
```

### `file_review_complete`

```json
{
  "jobId": "c2d23d7e-6f01-4a9f-b57d-5e820f8f93d0",
  "fileReview": {
    "id": "1bdf6d34-f7f1-4bc8-b0cc-cff2ca9b4963",
    "filePath": "src/auth/token.ts",
    "highestSeverity": "HIGH",
    "riskScore": 82,
    "summary": "存在 token 缺失分支直接返回成功的问题。",
    "comments": []
  },
  "progress": {
    "finishedFiles": 7,
    "totalFiles": 12
  }
}
```

### `file_review_failed`

```json
{
  "jobId": "c2d23d7e-6f01-4a9f-b57d-5e820f8f93d0",
  "filePath": "src/legacy/big-file.ts",
  "errorMessage": "LLM timeout after 45000ms"
}
```

### `review_job_done`

```json
{
  "jobId": "c2d23d7e-6f01-4a9f-b57d-5e820f8f93d0",
  "status": "done",
  "finishedFiles": 12,
  "totalFiles": 12,
  "totalCostUsd": 0.42,
  "durationMs": 22893
}
```

---

## 14. 队列契约设计

## 14.1 BullMQ Job Payload

```ts
interface ReviewSliceJobPayload {
  reviewJobId: string;
  pullRequestId: string;
  filePath: string;
  language: string;
  patch: string;
  patchSha256: string;
  sliceId: string;
  sliceIndex: number;
  totalSlicesForFile: number;
  diffHunks: DiffHunk[];
  fileContext?: string;
  ruleConfigVersion: number;
  llm: {
    providerPriority: ("openai" | "anthropic" | "azure")[];
    model: string;
    timeoutMs: number;
  };
}
```

## 14.2 BullMQ 配置建议

```ts
{
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 3000
  },
  removeOnComplete: 1000,
  removeOnFail: 1000
}
```

---

## 15. 前端设计

## 15.1 页面结构

建议一期包含三个主区域：

1. 顶部任务状态区
2. 左侧文件审查列表
3. 右侧 Diff Viewer + 评论联动区

## 15.2 Zustand Store 设计

```ts
interface ReviewStore {
  prMeta: {
    owner: string;
    repo: string;
    prNumber: number;
    title: string;
    baseBranch: string;
    headBranch: string;
  } | null;
  fileReviews: FileReviewViewModel[];
  activeFilePath: string | null;
  activeCommentId: string | null;
  streamingStatus: {
    jobId: string | null;
    status: "idle" | "running" | "done" | "failed";
    totalFiles: number;
    finishedFiles: number;
  };
  setActiveFilePath: (filePath: string) => void;
  setActiveCommentId: (commentId: string | null) => void;
  patchFileReview: (fileReview: FileReviewViewModel) => void;
}
```

## 15.3 前端交互流程

### 文件点击联动

1. 点击左侧文件条目
2. 设置 `activeFilePath`
3. 加载该文件 diff
4. Diff Viewer 渲染
5. 默认滚到该文件第一条评论

### 评论点击联动

1. 点击评论卡片
2. 设置 `activeCommentId`
3. 根据 `lineStart` 定位到 diff 行 DOM
4. `scrollIntoView`
5. 高亮对应行和评论卡片

### 反向联动

1. 在 Diff Viewer 中点击某条浮层评论
2. 反向更新左侧选中项
3. 左侧列表滚动到对应文件或评论

## 15.4 Diff Viewer 实现建议

### 选型

使用 `diff2html` 渲染，不自行实现 diff 布局。

### 增强要求

- 渲染后给每行追加 `data-line` 与 `data-diff-line-ref`
- 建立 `commentId -> DOM node` 索引
- 高亮样式独立于 diff2html 默认主题

### DOM 定位示例

```ts
const target = document.querySelector(`[data-line="101"]`);
target?.scrollIntoView({ block: "center", behavior: "smooth" });
```

## 15.5 流式进度 UI

建议交互：

- 顶部展示整体进度条：`finishedFiles / totalFiles`
- 文件列表中未完成项显示骨架占位
- 文件完成时逐个替换为真实审查结果
- 单文件失败时展示失败状态和重试按钮

---

## 16. GitHub 回写设计

## 16.1 写回模式

一期建议只支持“用户手动确认后回写”，不默认自动推送评论。

## 16.2 写回前置校验

- 必须具备 `line_start`
- 必须具备 `file_path`
- 评论未被标记为 `unmapped`
- PR head SHA 未变化

## 16.3 回写 API 选择

使用 GitHub Pull Request Review Comments API。

需要映射：

- `path`
- `line`
- `side`
- `body`

如果评论范围跨多行，考虑使用 `start_line` 和 `line`。

---

## 17. 本地 Docker Compose 方案

## 17.1 服务清单

本地只需要编排基础依赖，不需要容器化前后端开发服务器也能工作。

建议服务：

- `postgres`
- `redis`
- `minio`
- `rule-engine`

前端与 NestJS 可在宿主机本地启动，便于热更新。

## 17.2 端口规划

| 服务 | 端口 |
| --- | --- |
| PostgreSQL | 5432 |
| Redis | 6379 |
| MinIO API | 9000 |
| MinIO Console | 9001 |
| Rule Engine | 8001 |

## 17.3 `docker-compose.yml` 示例

```yaml
version: "3.9"

services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: ai-pr-review-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ai_pr_review
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./infra/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro

  redis:
    image: redis:7-alpine
    container_name: ai-pr-review-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    container_name: ai-pr-review-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

  rule-engine:
    build:
      context: ./services/rule-engine
    container_name: ai-pr-review-rule-engine
    restart: unless-stopped
    ports:
      - "8001:8001"
    volumes:
      - ./services/rule-engine:/app

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

## 17.4 本地启动顺序

1. `docker compose -f infra/docker-compose.yml up -d`
2. 初始化 `.env`
3. 启动 `apps/api`
4. 启动 `apps/worker`
5. 启动 `apps/web`

---

## 18. 环境变量建议

```bash
# API
PORT=3001
NODE_ENV=development

# GitHub
GITHUB_TOKEN=

# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_pr_review

# Redis
REDIS_URL=redis://localhost:6379

# MinIO
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=llm-raw-responses
S3_FORCE_PATH_STYLE=true

# Rule Engine
RULE_ENGINE_BASE_URL=http://localhost:8001

# LLM
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
AZURE_OPENAI_API_KEY=
DEFAULT_LLM_PROVIDER=openai
DEFAULT_LLM_MODEL=gpt-4.1

# WebSocket
WS_NAMESPACE=/review-jobs
```

---

## 19. 失败场景与降级策略

| 场景 | 风险 | 降级方案 |
| --- | --- | --- |
| GitHub patch 缺失 | 无法做精确行映射 | 文件标记 unsupported，仅展示元信息 |
| LLM 超时 | 单文件分析失败 | 自动重试 3 次，最终标记失败 |
| Rule Engine 不可用 | 缺少静态规则结果 | 仅跑 AI 分析，并记录 degraded 标记 |
| 行号反解失败 | 评论无法挂载到代码 | 标记 `unmapped`，不支持回写 |
| 大文件 token 超限 | 成本高或模型拒绝 | 按 hunk 切片并截断上下文 |
| 模型输出不符合 JSON Schema | 无法结构化入库 | 触发一次修复性重试，仍失败则标记解析失败 |

---

## 20. 开发里程碑建议

## 20.1 M1：骨架期

交付：

- Monorepo 初始化
- NestJS / React / Worker 项目骨架
- PostgreSQL / Redis / MinIO 本地环境
- 核心表建表

## 20.2 M2：PR 拉取与 diff 解析

交付：

- GitHub PR 拉取
- patch 获取
- `DiffHunk` 解析
- 行号映射

## 20.3 M3：分析链路打通

交付：

- BullMQ 队列
- Rule Engine 接入
- LLM Gateway 接入
- 结构化解析入库

## 20.4 M4：前端联动

交付：

- 文件列表
- Diff Viewer
- 评论联动
- WebSocket 实时更新

## 20.5 M5：增强能力

交付：

- 缓存命中
- pgvector 检索增强
- GitHub 评论回写
- OpenTelemetry 链路追踪

---

## 21. 一期建议的最小闭环

如果要尽快做出可用版本，一期最小闭环建议只做以下能力：

1. 输入 GitHub PR 链接或 `owner/repo/prNumber`
2. 拉取 PR 和 patch
3. 整文件或按 hunk 做 AI Review
4. 结构化输出评论
5. 前端按文件展示审查结果
6. 点击评论可跳转到 diff 对应行
7. 本地 `Docker Compose` 拉起依赖

一期可以暂缓的内容：

- pgvector 历史增强
- GitHub 评论回写
- 多 provider 自动回退
- 复杂规则平台化管理

---

## 22. 关键风险与实现建议

## 22.1 高风险点

### 行号映射

这是第一优先级风险，必须先做稳定 `diff_line_ref`，再接 LLM。

### 大文件与成本控制

如果不做切片和缓存，LLM 成本会快速失控。

### 模型输出稳定性

如果不用 structured output，后处理会非常脆弱。

## 22.2 建议的实现顺序

建议按以下顺序开发，而不是并行铺开：

1. 数据库表结构
2. GitHub 拉取与 patch 解析
3. 行号映射
4. 结构化 LLM 输出
5. 文件级结果入库
6. 前端 Diff Viewer 联动
7. WebSocket 增量刷新
8. 规则引擎与缓存增强

---

## 23. 结论

这个方案的核心不是“接一个大模型”，而是建立一条可追踪、可映射、可增量反馈的数据流：

- GitHub PR -> 结构化 Diff
- 结构化 Diff -> 并发分析任务
- 分析任务 -> 结构化评论
- 结构化评论 -> 行号映射
- 行号映射 -> 前端联动与 GitHub 回写

只要把 `diff_line_ref`、任务编排、结构化输出这三件事先做稳，这个 AI PR Review 助手就能具备真正可用的产品雏形。

