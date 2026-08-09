# 开发者指南（AGENTS）

> 原项目名 **AutoTask**，GitHub 仓库名 **TalkTask**，现产品名 **「拾级（Gradus）」**。
> 本文件供人类开发者与 AI Agent 接手本项目时快速建立上下文。产品定位、运行方式见 [README.md](./README.md)，功能细节见 [PRD.md](./PRD.md)。

---

## 1. 项目概览

一款面向自主学习者的 AI 学习任务规划器：用户输入一个模糊目标 → AI 拆解为带排期、资源、甘特图的可执行子任务，并自动核查修订、全局接续排期。已从 Eazo 平台解耦，可独立部署到任意支持 Next.js 的托管平台。

技术栈与运行命令见 README.md，此处不再重复。

---

## 2. 平台解耦（重要，先读这一节）

代码源自 Eazo 平台模板，但现已自托管。三处兼容层保留了原模板的导入形态，但底层实现是自托管的：

- **`src/lib/eazo-shim.ts`** — 替换 `@eazo/sdk/react`：
  - `EazoProvider`：纯 passthrough（直接返回 children）。
  - `auth`：单例，固定一个 demo 用户，`login()` / `logout()` 均为 no-op。
  - `memory`：`reportAction()` 为 no-op（平台长期记忆在站外不可用）。
  - `useEazo(selector)`：zustand 风格选择器 hook。
  - **没有真实登录**：每个访客都是同一个 demo 用户。
- **`src/lib/auth/index.ts`** — 替换 `@eazo/sdk/server` 的 `requireAuth`：解析单一 demo 用户并**懒写入本地 DB**（保证 `tasks.userId → users.id` 外键始终有对应行）。所有受保护路由第一行调用 `await requireAuth(request)`。
- **`src/lib/eazo-ai-billing.ts`** — `appAi.chat()` 客户端，两种模式：
  - `byok`（`EAZO_AI_PROVIDER_MODE=byok`，自托管默认）：直连 `AI_PROVIDER_BASE_URL` 的 OpenAI 兼容 `/v1/chat/completions`。
  - `eazo`（平台）：走 Eazo Creator Proxy（`EAZO_APP_AI_API_BASE`）。自托管不需要。

> 关键事实：`package.json` 中**已无 `@eazo/sdk` 依赖**。UI / 路由里 import 的 `EazoProvider`、`useEazo`、`requireAuth`、`appAi` 全部来自上述自托管 shim，不依赖任何平台 SDK。其余平台能力（notifications.push、object storage）在自托管模式下未实现，相关代码多为 no-op 或占位。

---

## 3. 目录结构

```
src/
  app/
    layout.tsx                      根布局：I18nProvider > EazoProvider(shim) > UserSyncEffect > Toaster
    page.tsx                        首页入口 → <HomePage />
    task/[id]/page.tsx              任务详情页（甘特图）
    history/page.tsx                历史任务页
    api/
      tasks/route.ts                GET 列表 / POST 创建
      tasks/[id]/route.ts           GET / PATCH(status) / DELETE(级联)
      tasks/[id]/analyze/route.ts   POST 4+ 段 AI 流水线（缓冲 JSON，非 SSE）
      tasks/[id]/subtasks/[subtaskId]/route.ts  PATCH 切换完成状态
      subtasks/route.ts             GET 全量子任务 JOIN 大任务
      user/profile/route.ts         GET 用户 upsert
      user/stats/route.ts           GET 统计
      mcp/route.ts                  GET/POST/DELETE MCP Streamable HTTP
      notifications/cron/daily-digest/route.ts   Vercel Cron 每日提醒
      notifications/test/route.ts    测试推送
  components/
    home/        home-page / new-task-input / subtask-row / subtask-detail-modal / congrats-modal / right-panel
    task/        gantt-chart / task-detail-page-v2
    history/     history-page
    user-profile/ user-badge / user-sync-effect
    i18n/        i18n-provider / language-switcher / locale-sync-effect
    ui/          shadcn/ui 基础组件
  lib/
    ai/prompts.ts        INTENT / RESOURCE_INTENT / PLAN / VALIDATE 提示词
    api/                 request / tasks / user-profile / app-ai-request / index
    auth/index.ts        requireAuth → demo 用户（自托管）
    db/                  schema(tasks,subtasks,users) / queries / client / migrate / migrations/
    eazo-ai-billing.ts   appAi 客户端（byok / creator proxy）
    eazo-shim.ts         EazoProvider / auth / memory / useEazo 兼容层
    fetchers/            article / arxiv / bilibili / course / pdf / workspace / fallback
    i18n/                locale / preference / server-locale / server-preference
    mcp/server.ts        MCP 工具定义
    resource-validator.ts  三维可信度校验
    scheduler.ts         全局排期算法（Bloom 渐进 + 每日槽位）
    tavily.ts            resolveResources（两阶段资源检索）
    url-fetcher.ts       URL 内容抓取与格式化
  utils/utils.ts         cn() Tailwind 类名合并
```

---

## 4. 常用命令

```bash
bun install
bun dev
bun run build
bun start
bun run lint
bun run db:generate      # 生成迁移
bun run db:migrate       # 执行迁移
bun run db:push          # 直接同步 schema
bun run db:studio        # Drizzle Studio
```

> ⚠️ `bun run cleanup:demo` 在 package.json 中仍有声明，但目标 `scripts/cleanup-demo.ts` 已被删除，**不可用**。

---

## 5. 环境变量

见 [.env.example](./.env.example)，自托管必填：`DATABASE_URL`、`EAZO_AI_PROVIDER_MODE=byok`、`AI_PROVIDER_BASE_URL`、`AI_PROVIDER_API_KEY`、`AI_PROVIDER_MODEL`。可选：`TAVILY_API_KEY`、demo 用户三件套、`NEXT_PUBLIC_APP_TITLE/DESCRIPTION`、`CRON_SECRET`。

---

## 6. 关键文件地图（按功能索引）

| 功能 | 主要文件 |
|---|---|
| 认证 / 用户 | `src/lib/auth/index.ts`、`src/lib/eazo-shim.ts`、`src/components/user-profile/*`、`src/app/api/user/profile/route.ts`、`src/app/api/user/stats/route.ts` |
| AI 流水线 | `src/app/api/tasks/[id]/analyze/route.ts`、`src/lib/ai/prompts.ts`、`src/lib/eazo-ai-billing.ts` |
| 资源检索 | `src/lib/tavily.ts`（resolveResources）、`src/lib/resource-validator.ts`、`src/lib/url-fetcher.ts`、`src/lib/fetchers/*` |
| 排期 | `src/lib/scheduler.ts`（`computeNewTaskStartDate` / `findNextAvailableDay` / `validateBloomSequence` / `suggestReviewNodes` / `registerDailySlot`） |
| 数据库 | `src/lib/db/schema/*`、`src/lib/db/queries/*`、`src/lib/db/client.ts`、`src/lib/db/migrate.ts`、`src/lib/db/migrations/` |
| MCP | `src/lib/mcp/server.ts`、`src/app/api/mcp/route.ts` |
| 国际化 | `src/components/i18n/*`、`src/lib/i18n/*` |
| 前端仪表板 | `src/components/home/*`、`src/components/task/*`、`src/components/history/*` |

---

## 7. API 路由

| 方法 | 路径 | 说明 | 鉴权 |
|---|---|---|---|
| `POST` | `/api/tasks` | 创建大任务 | demo 用户 |
| `GET` | `/api/tasks` | 任务列表（含进度计数） | demo 用户 |
| `GET` | `/api/tasks?withSubtasks=1` | 列表 + 子任务（面板水化） | demo 用户 |
| `GET` | `/api/tasks/:id` | 单任务 + 子任务 | demo 用户 |
| `PATCH` | `/api/tasks/:id` | 更新 status | demo 用户 |
| `DELETE` | `/api/tasks/:id` | 删除（级联子任务） | demo 用户 |
| `POST` | `/api/tasks/:id/analyze` | 4+ 段 AI 流水线（缓冲 JSON） | demo 用户 |
| `PATCH` | `/api/tasks/:id/subtasks/:sid` | 切换子任务完成状态 | demo 用户 |
| `GET` | `/api/subtasks` | 全量子任务 JOIN 大任务 | demo 用户 |
| `GET` | `/api/user/profile` | 获取 / 创建用户 | demo 用户 |
| `GET` | `/api/user/stats` | 统计 | demo 用户 |
| `GET/POST/DELETE` | `/api/mcp` | MCP Streamable HTTP | demo 用户 |
| `GET` | `/api/notifications/cron/daily-digest` | 每日推送（Cron） | `Bearer ${CRON_SECRET}` |
| `GET` | `/api/notifications/test` | 测试推送 | demo 用户 |

> 鉴权字段均为「demo 用户」：自托管下 `requireAuth` 不校验身份，只保证有一个用户行。

---

## 8. AI 规划流水线详解

入口：`src/app/api/tasks/[id]/analyze/route.ts`。**缓冲（非流式）**，`export const maxDuration = 300`（Vercel Fluid compute 上限，避免中途超时丢失前面各阶段结果）。所有 AI 调用经 `appAi.chat({ stream: false })`（`byok` 模式）。

| 阶段 | 提示词 | 主要输出 |
|---|---|---|
| Stage 0 · URL 抓取 | — | 若用户输入含 URL，先 `fetchUrlContent` 抓取真实页面内容注入 Prompt（失败降级为空，不阻断） |
| Stage 1 · 意图 | `INTENT_PROMPT` | task_name / topic_category / urgency / importance / prior_knowledge_level / bloom_target_level / estimated_total_hours / search_keywords / subject_domain |
| Stage 2 · 资源（两阶段） | `RESOURCE_INTENT_PROMPT` | ① AI 只产 `search_intents`（不产 URL）；② `resolveResources()` 调 Tavily 取真实 URL，再做三维校验 |
| Stage 3 · 计划 | `PLAN_PROMPT` | 4~8 子任务：title / description / duration_days / start_day / priority / bloom_level / deep_work_hours / learning_method / resource_indices |
| Stage 4 · 核查 | `VALIDATE_PROMPT` | pass / score / suggestions；外加本地 `validateBloomSequence` 检查 |
| Stage 5 · 修订（条件） | `PLAN_PROMPT` + 修订意见 | 当 `pass=false` 或 Bloom 层级跳跃时重排 |

落库与排期：更新任务标题/原始输入 → `computeNewTaskStartDate`（全局接续、窗口式）→ 按 Bloom 层级渐进排序 → 逐子任务 `findNextAvailableDay`（每日槽位 + 主题限流 + 领域亲和度）→ 写入 `subtasks`（含 bloomLevel、deepWorkHours）→ `suggestReviewNodes`（间隔复习节点）→ 更新 `total_days` 与 status=`done`。

返回（一次性 JSON）：`{ ok, result: { subtasks, totalDays, taskName, rawInput, startDate, topicCategory, priorLevel, bloomTarget, reviewNodes, verifiedCount, reachableCount } }`。

---

## 9. 全局排期算法

见 `src/lib/scheduler.ts`：

- **接续排期**：`computeNewTaskStartDate(otherTasks, today)` = 所有未完成任务最末结束日 + 1；若间隙 > 7 天则回退到今天。
- **Bloom 渐进排序**：子任务按 `bloom_level` 升序（同层按 `priority`）。
- **每日交错槽位**：`registerDailySlot` / `findNextAvailableDay` 按每日容量 + 主题 + Bloom + 领域亲和度约束分配日期，避免同主题扎堆、保证认知负荷均衡。
- **复习节点**：`suggestReviewNodes` 基于间隔重复（Spaced Repetition）生成复习提醒点。

---

## 10. 资源检索（两阶段，防编造）

- AI（`RESOURCE_INTENT_PROMPT`）**只生成搜索意图**，被硬性约束不得产出 URL。
- 代码 `resolveResources(intentList, topicCategory)` 调 **Tavily** 从**白名单域名**检索真实链接；有 `TAVILY_API_KEY` → 标记 `verified`，无 → `search_only`（用户点击时跳转搜索引擎自选）。
- `validateResources()` 做三维可信度校验（URL 存活 / 域名权威分 / 新鲜度），并行 ≤ 3s，不阻断主流程。

---

## 11. 认证模型（自托管）

无登录态。客户端 `eazo-shim.ts` 与服务端 `auth/index.ts` 都解析同一个 demo 用户（由 `NEXT_PUBLIC_DEMO_USER_*` 配置）。服务端 `requireAuth` 首次调用时会把该用户 upsert 进 `users` 表（每冷启动一次）。多用户隔离在自托管下不成立——所有访客共享一份数据。

---

## 12. MCP 服务

`src/lib/mcp/server.ts` 用 `@modelcontextprotocol/sdk` 的 Web Standard Streamable HTTP Transport 定义任务 CRUD 工具；`src/app/api/mcp/route.ts` 处理 GET/POST/DELETE。**无状态模式**（每请求独立），便于 serverless。同样经 `requireAuth` 鉴权（即 demo 用户隔离）。

---

## 13. 编码规范

- **单文件单组件**：每个文件只导出一个组件，出现第二个组件立即拆分。
- **文件行数上限**：页面组件软 30 / 硬 50；功能组件软 150 / 硬 250；工具/helper 软 80 / 硬 150；API 路由 handler 软 60 / 硬 100。
- **命名**：文件 `kebab-case.tsx`；导出 `PascalCase` 具名导出；功能目录用 barrel `index.tsx`；API helper 放 `src/lib/api/<resource>.ts` 用 `camelCase`。
- **状态与数据**：不在 `page.tsx` 里取数，交给组件；所有 fetch 逻辑集中在 `src/lib/api/`；用 `@/` 路径别名；UI 原语来自 `@/components/ui/`。
- **AI 调用位置**：AI 只能在 `src/app/api/` 路由 handler 内调用，绝不在客户端组件 import `appAi`。

---

## 14. 项目规则 / 发布前检查

- 优先用 Bun 跑安装与脚本。
- 不要深入 `@eazo/sdk` 内部（自托管下根本不存在该依赖）。
- AI 只在服务端 `src/app/api/` 调用。
- 发布前：`bun run lint` && `bun run build` 必须通过。

---

## 15. 已知遗留 / 待清理

- `src/app/layout.tsx` 的 metadata 仍引用 `eazo.ai` 的 favicon 与 `openGraph.siteName: "Eazo"`，品牌未完全切换为「拾级」。
- `bun run cleanup:demo` 指向已删除的 `scripts/cleanup-demo.ts`，不可用。
- PRD.md 与旧 AGENTS 描述「SSE 流式分析」，但当前后端为**缓冲 JSON**（见第 8 节）；前端分析面板以 JSON 结果驱动。
- 界面文案目前为中文硬编码，i18n 仅保留脚手架（`en-US` / `zh-CN`），未全面接入 `t()`。

---

## 16. 目标

先跑起来、保持灵活，只在有具体产品需求时才引入复杂度。
