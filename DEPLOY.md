# AutoTask → Vercel 部署清单

从零到拿到公网链接，约 20 分钟。全程免费、不绑卡、不备案。

---

## 0. 先确认改造已生效

本仓库已从 Eazo 平台解耦，可独立部署。改动摘要见文末「改造说明」。

本地自检（应全部通过）：

```bash
bun install
bunx tsc --noEmit     # 无输出 = 通过
bun run build         # ✓ Compiled successfully
```

> Windows 本机注意：若 build 报 Turbopack worker 崩溃，是全局 `NODE_OPTIONS=--use-system-ca` 导致，
> 改用 `env -u NODE_OPTIONS bun run build`。

---

## 1. 开数据库（Neon 免费档）

1. 打开 https://neon.tech → GitHub 账号登录（免费档不需要信用卡）
2. Create Project，Region 选 **Singapore (ap-southeast-1)** 或 **US East**
3. 建完后在 Dashboard 复制 **Connection string**

**关键**：一定要选带 `-pooler` 的那条，形如

```
postgresql://user:pass@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

不带 `-pooler` 的直连串在 Serverless 下会把连接数打满。

---

## 2. 建表（在本地做，Vercel 上跑不了迁移）

把上一步的连接串填进本地 `.env`：

```bash
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require
```

然后执行：

```bash
bun run db:migrate
```

成功后表结构（users / tasks / subtasks）就建在 Neon 上了。这一步只需做一次。

---

## 3. 准备模型 API

任意 OpenAI 兼容端点都行。三条环境变量：

| 变量 | 说明 | 示例 |
|---|---|---|
| `AI_PROVIDER_BASE_URL` | **必须写到 `/v1` 这一层**，代码会自动拼 `/chat/completions` | `https://api.deepseek.com/v1` |
| `AI_PROVIDER_API_KEY` | 你的 key | `sk-xxxx` |
| `AI_PROVIDER_MODEL` | 模型名 | `deepseek-chat` |

常见端点：

- DeepSeek `https://api.deepseek.com/v1` → `deepseek-chat`
- OpenAI `https://api.openai.com/v1` → `gpt-4o-mini`
- Moonshot `https://api.moonshot.cn/v1` → `moonshot-v1-8k`
- 硅基流动 `https://api.siliconflow.cn/v1` → `Qwen/Qwen2.5-72B-Instruct`

**选型建议**：分析流程要连打 4 次 LLM，选快的模型体验差别很大。
`deepseek-chat` 全程约 40-70 秒，推理型模型（如 o1 / r1）可能超过 200 秒。

先在本地验一次：`bun run dev` → 打开 localhost:3000 → 建个任务跑完整流程。

---

## 4. 推到 GitHub

```bash
git add -A
git commit -m "chore: 适配 Vercel 独立部署"
git remote add origin git@github.com:<你的账号>/autotask.git
git push -u origin main
```

`.env` 已在 `.gitignore` 中，不会泄露 key。

---

## 5. Vercel 部署

1. https://vercel.com → Continue with GitHub（**不需要绑卡**）
2. Add New → Project → 选中刚推的仓库 → Import
3. Framework 会自动识别为 Next.js，**Build 设置全部保持默认**
4. 展开 **Environment Variables**，逐条粘贴：

```
DATABASE_URL              postgresql://...-pooler.../neondb?sslmode=require
EAZO_AI_PROVIDER_MODE     byok
AI_PROVIDER_BASE_URL      https://api.deepseek.com/v1
AI_PROVIDER_API_KEY       sk-xxxx
AI_PROVIDER_MODEL         deepseek-chat
CRON_SECRET               <openssl rand -hex 32 生成的随机串>
NEXT_PUBLIC_APP_TITLE     AutoTask · 学习规划智能体
```

> `EAZO_AI_PROVIDER_MODE=byok` 这条**必填**，漏了会走已废弃的平台代理并报
> "BYOK AI provider is not configured"。

5. Deploy → 等 2-3 分钟

拿到的 `https://<项目名>.vercel.app` 就是可提交的公网体验链接。

---

## 6. 上线后自检

| 检查项 | 怎么看 |
|---|---|
| 首页能打开、右上角显示演示用户 | 直接访问 |
| 建任务能跑完 4 阶段并出甘特图 | 输入「两周内学会 React 基础」 |
| 数据真的落库 | Neon Dashboard → Tables → tasks 有行 |
| 函数没超时 | Vercel → Deployments → Functions 日志无 `FUNCTION_INVOCATION_TIMEOUT` |

出问题优先看 **Vercel → 项目 → Logs**，运行时报错都在那。

---

## 常见坑

**部署成功但一分析就报错**
→ 99% 是环境变量。检查 `EAZO_AI_PROVIDER_MODE=byok` 是否填了，
`AI_PROVIDER_BASE_URL` 是否**漏了 `/v1`** 或**多写了 `/chat/completions`**。

**报数据库连接失败 / too many connections**
→ 用了不带 `-pooler` 的直连串，换成 pooler 那条并 Redeploy。

**改了环境变量没生效**
→ Vercel 的环境变量不会热更新，必须 Deployments → 右上角 ⋯ → Redeploy。

**分析卡在「写入数据库并排期」很久**
→ 正常。界面右侧有秒数在跳就说明还活着，模型慢而已。
上限 300 秒，超了才会失败。

---

## 改造说明（相对原平台版的差异）

| 项 | 原来 | 现在 |
|---|---|---|
| 登录 | Eazo 平台 OAuth | 固定演示用户，无需登录（`src/lib/eazo-shim.ts`） |
| 服务端鉴权 | `requireAuth` 验平台 token | 本地 demo 用户 + DB upsert（`src/lib/auth/index.ts`） |
| AI 分析 | SSE 逐字流式 | 缓冲式 JSON + 客户端阶段动画（规避代理层缓冲问题） |
| AI 计费 | 走平台代理扣创作者额度 | BYOK 直连你自己的 OpenAI 兼容端点 |
| 推送通知 | 平台 push 服务 | 端点保留但为空操作（平台能力不可用） |
| 数据库 | 平台托管 PG | 外接 Neon，连接池按 Serverless 调优 |
| 定时任务 | 平台调度 | `vercel.json#crons`，每天 17:00 UTC |

演示用户的名字/邮箱可通过 `NEXT_PUBLIC_DEMO_USER_NAME` / `NEXT_PUBLIC_DEMO_USER_EMAIL` 改。

**注意**：所有访客共用同一个演示用户，看到的是同一份任务列表。
黑客松演示够用，但别当多租户产品用。
