# AI PR Review 助手仓库级开发规范

本文档定义本仓库内 Codex 与开发者的协作规范。  
目标不是写一份泛用 AI 助手说明，而是约束这个项目在当前阶段怎样开发，避免架构漂移、契约失控和联调整体爆炸。

如果后续本仓库的代码、目录或架构发生明显变化，应同步更新本文件。

## 1. 项目目标

本项目要构建的是一个 `Repository Intelligence + Dynamic Context Retrieval + Quality Gates` 驱动的 AI PR Review 系统。

系统核心不是“把 diff 扔给大模型”，而是：

1. 接入任意 GitHub 仓库。
2. 自动构建轻量仓库语义地图。
3. 对 PR 做首轮审查。
4. 根据 `TriageDecision` 判断是否需要更多上下文。
5. 按需检索定义、调用链、测试、schema、配置和设计文档。
6. 做二轮审查。
7. 通过 `Comment Admission Gate` 和 `Quality Scoring` 压制低信号评论。
8. 输出结构化 PR Summary、Inline Comments 和合并建议。

## 2. 架构总览

本仓库当前按两条主线建模：

- `Repository Intelligence`
- `Review Pipeline`

### 目录职责

- `apps/api`
  - NestJS API 与 WebSocket 入口
  - 负责 HTTP 契约、任务触发、状态查询、前端读模型
- `apps/worker`
  - BullMQ Worker 与异步审查编排
  - 负责仓库扫描任务、PR 审查任务、上下文检索编排
- `apps/web`
  - React 工作台
  - 负责仓库接入页、PR 审查页、Diff Viewer、评论联动
- `packages/shared-types`
  - 全仓库唯一跨模块 JSON 契约真源
  - 负责 Zod schema、TypeScript types、事件契约、API 契约
- `packages/review-core`
  - 纯逻辑层
  - 负责 triage、context plan、admission gate、quality scoring
- `services/rule-engine`
  - Python sidecar
  - 负责 Semgrep / ESLint 等规则执行包装
- `docs/contracts`
  - 面向人类的契约说明
  - 负责数据流、状态机、表结构说明
- `fixtures`
  - Mock 真源
  - 负责仓库扫描、PR、triage、context fetch、review 结果样例
- `infra/postgres/init.sql`
  - 数据库真源
  - 负责表、索引、约束、JSONB 策略

## 3. 核心工程原则

### 3.1 Contract First

任何跨模块传递的 JSON，都必须先进入 `packages/shared-types`。

禁止：

- API 单独定义一份 response shape
- Worker 单独定义一份内部对象
- 前端手抄接口字段
- fixtures 自己发明字段名

允许：

- 在 `shared-types` 增加可选字段
- 通过 `metadata` / `jsonb` 扩展边缘信息

不允许：

- 无版本说明地修改已有字段语义
- 随意替换枚举值
- 新增必填字段但不同步所有调用方

### 3.2 Mock First

在主流程未完全接通前，所有模块都应优先对接 `fixtures/` 开发。

要求：

- 新增关键契约时，应至少补一个 fixture
- 修改契约时，应同步修正对应 fixture
- 前端、API、Worker 联调时优先使用共享 fixture，而不是各自伪造样例

### 3.3 Evidence First

系统输出必须以证据为中心。

PR 评论默认应具备：

- `diffLineRef`
- `evidenceRefs`
- 明确故障条件
- 明确影响方式
- 明确建议动作

禁止输出泛泛而谈的评论，例如：

- 可以考虑优化
- 建议增强可读性
- 潜在风险
- 最好补一下日志

### 3.4 Layered Knowledge

这个项目必须严格区分两类知识：

- 结构化代码事实
  - symbol、caller、callee、test、schema、config
  - 来自结构化索引
- 语义背景信息
  - README、docs、ADR、module summary
  - 来自 semantic documents / vector retrieval

禁止把整仓源码全文直接当 RAG 主知识库。

### 3.5 Pure Core, Side Effects Outside

`packages/review-core` 中只允许纯逻辑，不允许：

- HTTP 调用
- 数据库访问
- 文件系统 IO
- Redis / BullMQ 依赖
- GitHub API 调用

副作用统一放在：

- `apps/api`
- `apps/worker`
- `services/rule-engine`

## 4. 代码开发规范

### 4.1 命名与语言

- 变量名、函数名、类名使用英文
- 注释使用中文
- 文档使用中文
- Commit message 和 PR 描述使用中文

### 4.2 注释要求

本仓库要求“清晰易懂注释”，但禁止废话式注释。

应该写的注释：

- 解释这一段契约负责什么
- 解释这一段状态机为什么存在
- 解释为什么要这样限制预算或流程
- 解释一个不明显的业务约束

不要写的注释：

- 给一眼就能看懂的赋值加注释
- 重复代码字面意思
- 用注释掩盖坏命名

### 4.3 计划文档同步要求

本仓库要求开发状态与计划文档保持同步，禁止“代码完成了，计划文档还停留在待开发”。

任何模块开发完成、范围调整、验收结果变化后，必须同步更新：

- `AGENTS.md`
  - 如果开发规范、提交流程、模块边界发生变化
- `docs/development-plan.md`
  - 更新模块状态、当前阶段判断、验收结论、依赖变化
- `docs/development-checklist.md`
  - 勾选已完成项，补充未完成项，更新模块状态

最低要求：

- 提 PR 前，相关模块在 `development-checklist.md` 中的任务状态必须更新
- 模块完成后，`development-plan.md` 中对应模块不能继续保留“待开发”旧状态
- 如果实际实现偏离原计划，必须把偏离点写进计划文档，而不是只改代码

### 4.4 TypeScript 规范

- 保持 `strict` 模式
- 运行时边界对象必须用 Zod 校验
- 禁止在跨模块对象上使用裸 `any`
- 尽量优先复用 `shared-types` 中已有 schema

新增对象的顺序必须是：

1. 先加 schema
2. 再导出 type
3. 再落使用代码
4. 再补 fixture

### 4.5 API 规范

`apps/api` 中：

- Controller 只做请求解析、schema 校验、错误转换
- 业务逻辑不要堆在 Controller
- Service 尽量薄，负责编排核心逻辑或调用应用层
- 对外响应 shape 必须来自 `shared-types`

### 4.6 Worker 规范

`apps/worker` 中：

- Worker 负责队列消费、重试、并发、状态更新
- 审查逻辑优先调用 `review-core`
- 如果一个逻辑可纯化，就不要直接写死在 Worker 里

### 4.7 SQL 与持久化规范

数据库结构以 `infra/postgres/init.sql` 为真源。

修改数据库时必须同步：

- `infra/postgres/init.sql`
- `docs/contracts/database-schema.md`
- 如影响领域对象，更新 `packages/shared-types`

禁止只改文档表格不改 SQL，或只改 SQL 不改文档。

## 5. Git 与 GitHub 提交规范

### 5.1 分支规范

禁止直接在 `main` 开发。

本仓库采用“一个模块一个分支”的开发方式：

1. 从最新 `main` 拉出一个新分支。
2. 这个分支只做一个模块或一个明确主题。
3. 模块全部完成后再 `push` 并提 PR。
4. PR 合并后删除该分支。
5. 下一个模块重新从最新 `main` 新建新分支继续开发。

禁止：

- 一个分支里同时做多个模块
- 一个分支长期累积多个不相关改动
- 合并后继续复用旧分支写下一个模块

分支命名使用中文描述，格式：

- `feature/中文模块说明`
- `fix/中文问题说明`
- `docs/中文文档说明`
- `refactor/中文重构说明`

示例：

- `feature/补齐仓库扫描与审查共享契约`
- `feature/新增仓库语义地图查询接口`
- `fix/修正review-tools控制器注入绑定问题`
- `docs/重写项目架构与contract-first文档`

### 5.2 Commit 规范

Commit message 使用中文，格式：

`type: 动词开头的简短说明`

推荐 type：

- `feat`
- `fix`
- `refactor`
- `docs`
- `test`
- `chore`

示例：

- `feat: 补齐仓库扫描与审查共享契约`
- `fix: 修正 review-tools 控制器注入绑定问题`
- `docs: 重写项目架构与 contract-first 文档`

要求：

- 一个 commit 尽量只表达一个意图
- 不要把功能、重构、格式化和文档混成一坨
- 如果只是格式化，不要伪装成功能提交

### 5.3 PR 规范

每个 PR 只对应一个分支、一个模块、一个主题。

推荐 PR 范围：

- 契约层
- Repository Intelligence
- Review Pipeline
- API 接线
- Web 工作台
- Rule Engine

PR 标题使用中文描述，建议沿用 commit 风格，例如：

- `feat: 补齐 contract-first 真源层`
- `feat: 新增仓库扫描语义地图骨架`
- `fix: 修正 review-tools 请求校验与注入问题`

PR 描述至少包含：

- 背景
- 本次改动
- 是否影响契约
- 是否影响数据库
- 测试与验证结果
- 已知限制或未完成项

### 5.4 何时必须拆 PR

以下情况必须拆开：

- 改 schema 又顺手做 UI 重构
- 改数据库又顺手改大段 review-core 逻辑
- 改 Repository Intelligence 又顺手改 Web 页面

正确方式是先收口上游真源，再在后续 PR 消费这些真源。

## 6. 测试与验证规范

### 6.1 最低验证要求

任何改动提交前至少执行：

```bash
npm run check
```

### 6.2 契约层改动额外要求

如果改动涉及以下任一内容：

- `packages/shared-types`
- `fixtures`
- `infra/postgres/init.sql`
- `docs/contracts`

则必须额外说明：

- 改了哪些领域对象
- 是否破坏兼容
- fixtures 是否同步更新
- 数据库是否同步更新

### 6.3 Review Core 改动要求

如果改动 `packages/review-core`，必须至少验证：

- triage 示例
- context fetch 示例
- admission 示例
- quality score 示例

### 6.4 API 改动要求

如果改动 API 边界，至少验证：

- 成功请求
- 非法请求
- 返回 shape 是否符合 shared schema

## 7. Review 质量规范

这个仓库的核心质量要求不是“多查几个文件”，而是“少说废话”。

默认准入规则：

- 没有 `diffLineRef`，不准发
- 没有 `evidenceRefs`，不准发
- 说不清故障条件，不准发
- 说不清影响，不准发
- 只有风格意见且没有明确价值，默认压制

系统必须保留这些概念的一致性：

- `ReviewTriageDecision`
- `ContextRequest`
- `ContextBudget`
- `ContextFetchResult`
- `CommentAdmissionDecision`
- `QualityScoreBreakdown`

禁止绕过这套链路直接在下游拼评论。

## 8. 禁止事项

禁止：

- 在 `shared-types` 外复制一份契约
- 在没有 schema 的情况下新增跨模块 JSON
- 把数据库表结构当第一真源
- 把整仓源码直接喂给向量检索当主知识库
- 在 `review-core` 引入 IO
- 在一个 PR 里同时重构架构和交付多个功能域
- 用大量低价值注释掩盖设计不清晰

## 9. 推荐工作流

处理一个新需求时，推荐顺序：

1. 先判断影响的是哪一层
   - 契约层
   - Intelligence 层
   - Review Pipeline 层
   - API / Web 展示层
2. 如果影响跨模块数据，先改 `shared-types`
3. 如有需要，同步改 `init.sql`
4. 同步补 `fixtures`
5. 再改 API / Worker / Web 消费逻辑
6. 运行 `npm run check`
7. 同步更新 `docs/development-plan.md` 和 `docs/development-checklist.md`
8. 在 PR 里说明契约影响、计划状态和验证结果

## 10. 当前阶段的优先级

当前阶段优先级从高到低：

1. Contract-first 真源稳定
2. Repository Intelligence 骨架落地
3. Review Pipeline 主链路落地
4. 前端工作台联动
5. GitHub 评论回写
6. 高级缓存与历史模式增强

如果某个实现看起来“很聪明”，但会破坏契约稳定性、Mock 独立开发能力或模块边界，应优先拒绝。
