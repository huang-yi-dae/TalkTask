# 拾级（Gradus）

> 原项目名 **AutoTask**，GitHub 仓库名 **TalkTask**。一款面向自主学习者的 AI 驱动「学习任务规划与排期」系统。
> 在线演示：<https://talk-task.vercel.app/>

---

## 这是什么

拾级是一款「订单式」学习任务管理工具：你只需输入一个模糊的学习目标（如「学 Python」「备考高考数学」），AI 会自动完成 **意图解析 → 资源检索 → 计划拆解 → 可行性核查**，把目标拆成 4~8 个带工期、优先级、推荐资源和甘特图的可执行子任务，并按全局接续排期写入日历。你只管执行和打卡。

> **已从 Eazo 平台解耦，可独立部署。** 代码中仍保留 `EazoProvider` / `requireAuth` / `appAi` 等导入形态，但底层已替换为自托管兼容层（详见 [AGENTS.md](./AGENTS.md) 的「平台解耦」一节），无需任何平台账号即可运行。

## 核心能力

- **一句话生成计划**：输入目标，AI 自动生成正式任务名 + 4~8 个子任务。
- **真实资源检索（两阶段）**：AI 只产出搜索意图，代码用 Tavily 从白名单域名检索真实可访问的 URL，并用三维可信度校验（URL 存活 / 域名权威 / 新鲜度）过滤，杜绝 LLM 编造 404 链接。
- **认知科学排期**：基于 Bloom 认知分类法 + 认知负荷理论渐进排序；全局接续排期避免任务堆叠；每日槽位交错学习（同主题限流、领域亲和度）。
- **可行性核查 + 自动修订**：校验不达标或 Bloom 层级跳跃时，自动触发一次修订重排。
- **仪表板 + 甘特图**：双列仪表板（左侧时间线列表 / 右侧分析面板），任务详情页带可折叠甘特图。
- **打卡与庆祝**：子任务勾选完成、全部完成弹出庆祝页；历史任务持久化。
- **每日推送**：Vercel Cron 每日发送学习提醒。
- **MCP 接口**：`/api/mcp` 暴露标准 MCP Streamable HTTP，任何 AI Agent 可直接 CRUD 你的任务数据。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Next.js 16（App Router）+ React 19 + TypeScript |
| 样式 | Tailwind CSS v4 + shadcn/ui（base-nova 风格）+ lucide-react + framer-motion + sonner |
| 包管理 | Bun |
| 数据库 | PostgreSQL + Drizzle ORM（`postgres.js`） |
| AI | 自托管 `appAi` 客户端（`src/lib/eazo-ai-billing.ts`），支持 `byok`（OpenAI 兼容）或 Eazo Creator Proxy |
| 资源检索 | Tavily + 多源 fetcher（arXiv / Bilibili / 课程 / 文章 / PDF / workspace）+ 可信度校验 |
| 协议 | `@modelcontextprotocol/sdk`（MCP 服务） |
| 国际化 | i18next + react-i18next（`en-US` / `zh-CN` 脚手架；界面文案目前以中文为主） |

## 快速开始

### 前置条件

- Bun 1.3+（推荐）或 Node 18+
- 一个 PostgreSQL 数据库（Neon / Supabase 免费档均可）
- 一个 OpenAI 兼容的模型服务（DeepSeek / Moonshot / OpenAI / 本地 vLLM 等）
- （可选）Tavily API Key，用于真实资源检索

### 安装

```bash
git clone https://github.com/huang-yi-dae/TalkTask.git
cd TalkTask
bun install
```

若依赖安装卡在 `sharp`，加环境变量重试：

```bash
SHARP_IGNORE_GLOBAL_LIBVIPS=1 bun install
```

### 配置环境变量

```bash
cp .env.example .env
```

按 [.env.example](./.env.example) 填值。关键变量：

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL 连接串（推荐用 Neon 的 `-pooler` 串避免连接数打满） |
| `EAZO_AI_PROVIDER_MODE` | ✅ | 设为 `byok` 走自有密钥 |
| `AI_PROVIDER_BASE_URL` | ✅ | 写到 `/v1` 这一层，如 `https://api.deepseek.com/v1` |
| `AI_PROVIDER_API_KEY` | ✅ | 模型服务 API Key |
| `AI_PROVIDER_MODEL` | ✅ | 模型名，如 `deepseek-chat` |
| `TAVILY_API_KEY` | ❌ | 缺省时资源检索降级为「仅搜索」模式（点击资源跳搜索引擎） |
| `NEXT_PUBLIC_DEMO_USER_ID` / `NAME` / `EMAIL` | ❌ | 自托管无登录态，固定演示用户 |
| `NEXT_PUBLIC_APP_TITLE` / `NEXT_PUBLIC_APP_DESCRIPTION` | ❌ | 站点标题 / 描述 |
| `CRON_SECRET` | ❌ | Vercel Cron 回调的 Bearer 鉴权密钥 |

> 注意：自托管模式下没有真实登录态，所有访客都以同一个「demo 用户」身份读写数据。

### 初始化数据库

```bash
bun run db:push      # 或 bun run db:migrate
```

### 本地运行

```bash
bun dev
```

打开 <http://localhost:3000>。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `bun dev` | 本地开发服务器 |
| `bun run build` | 生产构建 |
| `bun start` | 启动生产服务 |
| `bun run lint` | ESLint 检查 |
| `bun run db:generate` | 生成 Drizzle 迁移文件 |
| `bun run db:migrate` | 执行迁移 |
| `bun run db:push` | 直接把 schema 同步到数据库 |
| `bun run db:studio` | 打开 Drizzle Studio |

> ⚠️ 模板遗留的 `bun run cleanup:demo` 在当前仓库已无对应脚本（目标 `scripts/cleanup-demo.ts` 不存在），请勿使用。

## AI 任务规划流程

`POST /api/tasks/:id/analyze` 在后端 **串行执行 4+ 次 LLM 调用**，缓冲后一次性返回 JSON 结果（**非 SSE 流式**；`maxDuration=300s` 以适配 Vercel Fluid compute 上限）：

1. **意图解析（Intent）**：提取任务名、主题、紧急/重要度、先验水平、Bloom 目标层级、预计总时长、搜索关键词。
2. **资源检索（两阶段）**：① AI 只生成搜索意图（不产 URL）；② 代码调用 Tavily 从白名单域名取真实 URL，再做三维可信度校验。
3. **计划生成（Plan）**：生成 4~8 个子任务，含工期、Bloom 层级、深度工作时间、学习方法、资源引用。
4. **核查 + 修订（Validate）**：校验可执行性 + 本地 Bloom 序列检查；不通过则自动修订重排。
5. **排期与落库**：全局接续排期（窗口式，间隙 > 7 天则从今天起）+ Bloom 渐进排序 + 每日槽位交错约束，写入 `tasks` / `subtasks`。

## 部署

推荐 Vercel：详见 [DEPLOY.md](./DEPLOY.md)（约 20 分钟，免费、不绑卡、不备案）。`vercel.json` 已声明每日 17:00 UTC 的 Cron 任务（每日学习提醒）。

## 文档导航

- [PRD.md](./PRD.md) — 产品需求文档（功能、交互、架构细节）
- [AGENTS.md](./AGENTS.md) — 开发者 / AI Agent 指南（目录结构、关键文件、编码规范）
- [DEPLOY.md](./DEPLOY.md) — 部署清单

## 许可证

本仓库当前未包含 LICENSE 文件。如需开源分发，请先补充许可证说明。
