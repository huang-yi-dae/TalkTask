import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { appAi } from "@/lib/eazo-ai-billing";
import { resolveResources, type SearchIntent, type TrustableResource } from "@/lib/tavily";
import { validateResources } from "@/lib/resource-validator";
import { extractUrl, fetchUrlContent, formatContentForPrompt } from "@/lib/url-fetcher";
import {
  getTaskById,
  createSubtasks,
  updateTaskTotalDays,
  updateTaskStatus,
  updateTaskTitleAndRawInput,
  updateTaskStartDate,
  getScheduledTasksByUser,
} from "@/lib/db/queries";
import {
  computeNewTaskStartDate,
  todayMidnight,
  registerDailySlot,
  findNextAvailableDay,
  validateBloomSequence,
  suggestReviewNodes,
  type ScheduledTask,
  type BloomLevel,
  type DailySlot,
} from "@/lib/scheduler";
import { INTENT_PROMPT, RESOURCE_INTENT_PROMPT, PLAN_PROMPT, VALIDATE_PROMPT } from "@/lib/ai/prompts";

// This pipeline makes 4+ sequential LLM calls (intent → resource intent →
// plan → validate), which can easily run 60–120s on a slower model. Vercel's
// Fluid compute allows up to 300s even on Hobby, so we claim the full ceiling
// — a timeout here would lose all prior stages' work.
export const maxDuration = 300;


// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Runs a single LLM stage and returns the full text completion.
 * Buffered (non-streaming) so the route completes within serverless limits and
 * returns one JSON payload instead of an SSE stream. The AI call goes through
 * the BYOK provider (EAZO_AI_PROVIDER_MODE=byok) configured via .env.
 *
 * 容错策略（双模式）：
 * 1. 首选 json_object 模式 + 最多 2 次重试（DeepSeek v4-flash 在该模式下偶发
 *    返回空 content，官方已知 bug，需重试缓解）。
 * 2. 若 json_object 模式连续失败，fallback 到普通 text 模式再试一次（同样可能
 *    命中空 content bug，但不同请求路径成功率更高）。
 * 两层都失败时返回空字符串，由调用方输出精确错误提示。
 */
async function callAI(systemPrompt: string, userMessage: string, retries = 2): Promise<string> {
  let lastError: Error | undefined;

  // 第一轮：json_object 模式 + 重试
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const completion = await appAi.chat({
        model: process.env.AI_PROVIDER_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        stream: false,
        // 调大上限，避免复杂任务的 Plan JSON 被截断（截断会导致 JSON 不完整、解析失败）
        max_tokens: 4000,
        // 强制模型只输出纯 JSON，消除 markdown 代码块包裹 / 额外说明文字导致的解析失败
        response_format: { type: "json_object" },
      });
      const content = completion.choices?.[0]?.message?.content ?? "";
      if (content.trim()) {
        return content;
      }
      // 空 content：DeepSeek json_object 模式偶发 bug，记录并进入重试
      lastError = new Error("AI returned empty content (json_object)");
      console.warn(
        `[AutoTask] AI returned empty content (json_object attempt ${attempt + 1}/${retries + 1}), retrying...`
      );
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        `[AutoTask] AI call failed (json_object attempt ${attempt + 1}/${retries + 1}):`,
        lastError.message
      );
    }
    // 最后一次失败后不再等待
    if (attempt < retries) {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }

  // 第二轮：json_object 模式连续失败 → fallback 到普通 text 模式
  // DeepSeek 官方对该 bug 的唯一建议是「改 prompt / 换请求路径」，text 模式是
  // 不同请求路径，命中空 content 的概率通常低于 json_object 模式。
  try {
    console.warn("[AutoTask] falling back to plain text mode (no response_format)");
    const completion = await appAi.chat({
      model: process.env.AI_PROVIDER_MODEL || "deepseek-chat",
      messages: [
        {
          role: "system",
          content:
            systemPrompt +
            "\n请只输出一个 JSON 对象，不要包含任何 markdown 代码块或额外说明文字。",
        },
        { role: "user", content: userMessage },
      ],
      stream: false,
      max_tokens: 4000,
    });
    const content = completion.choices?.[0]?.message?.content ?? "";
    if (content.trim()) {
      return content;
    }
    lastError = new Error("AI returned empty content (text fallback)");
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err));
    console.warn("[AutoTask] AI call failed (text fallback):", lastError.message);
  }

  // 两层都失败，返回空字符串让外层输出精确错误提示
  return "";
}

function parseJson<T>(text: string): T | null {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

// ─── Main Route ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  // 限流：昂贵 AI 端点，每用户每分钟最多 10 次，防刷量放大成本
  const rl = rateLimit(`analyze:${auth.user.id}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  const { id } = await params;
  const task = await getTaskById(id);
  if (!task || task.userId !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let adjustment = "";
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.adjustment === "string") adjustment = body.adjustment.trim();
  } catch { /* ignore */ }

  const rawGoal = task.rawInput || task.title;

  // ── Stage 0: URL 内容抓取（如果输入包含 URL）───────────────
  // 在 AI 分析之前，先抓取真实页面内容并注入 Prompt，让 AI 基于实际
  // 资料而非猜测来规划。任何抓取失败都降级为 urlContext=""（不阻断分析）。
  let urlContext = "";
  const detectedUrl = extractUrl(rawGoal);
  if (detectedUrl) {
    const fetched = await fetchUrlContent(detectedUrl);
    if (fetched) {
      urlContext = formatContentForPrompt(fetched);
    }
  }
  const enrichedGoal = urlContext ? `${rawGoal}\n\n${urlContext}` : rawGoal;

  try {
    // ── Stage 1: Intent ───────────────────────────────────────────
    const intentRaw = await callAI(
      INTENT_PROMPT,
      enrichedGoal + (adjustment ? `\n调整要求：${adjustment}` : "")
    );

    interface IntentResult {
      task_name?: string;
      topic_category?: string;
      urgency?: number;
      importance?: number;
      prior_knowledge_level?: string;
      learning_goal_type?: string;
      bloom_target_level?: number;
      estimated_total_hours?: number;
      search_keywords?: string[];
      subject_domain?: string;
    }
    const intent = parseJson<IntentResult>(intentRaw);
    const taskName = intent?.task_name?.trim() || task.title;
    const domain = intent?.subject_domain || rawGoal;
    const keywords = intent?.search_keywords?.join("、") || rawGoal;
    const topicCategory = intent?.topic_category || "其他";
    const urgencyScore = intent?.urgency ?? 3;
    const importanceScore = intent?.importance ?? 3;
    const keywordsArr = intent?.search_keywords ?? [];
    const priorLevel = intent?.prior_knowledge_level || "beginner";
    const bloomTarget = intent?.bloom_target_level ?? 3;
    const estimatedHours = intent?.estimated_total_hours ?? 20;

    // ── Stage 2: Resources（两阶段分离）──────────────────────────
    // Step A：AI 只生成搜索意图，不生成 URL
    const intentRawStr = await callAI(
      "你是资深学习资源顾问，请以 JSON 格式精确回复，不要加 markdown 代码块。严禁生成任何 URL。",
      RESOURCE_INTENT_PROMPT
        .replace("{GOAL}", enrichedGoal.slice(0, 800))
        .replace("{DOMAIN}", domain)
        .replace(/{PRIOR_LEVEL}/g, priorLevel)
        .replace("{KEYWORDS}", keywords)
    );

    interface IntentListResult { search_intents?: SearchIntent[] }
    const intentList = parseJson<IntentListResult>(intentRawStr)?.search_intents ?? [];

    // Step B：代码调用 Tavily，从白名单域名检索真实 URL
    // 有 TAVILY_API_KEY → verified；无 → search_only（用户点击时跳转搜索）
    const resources: TrustableResource[] = await resolveResources(intentList, topicCategory);
    const verifiedCount = resources.filter((r) => r.trust_level === "verified").length;

    // 三维可信度验证（URL 存活 + 域名权威分 + 新鲜度），并行 ≤3s，不阻断主流程
    await validateResources(resources);
    const reachableCount = resources.filter((r) => r.url_status === "ok" || r.url_status === "redirect").length;

    // ── Stage 3: Plan ─────────────────────────────────────────────
    const planRaw = await callAI(
      "你是学习计划设计专家，精通Bloom认知分类法和认知负荷理论，请以 JSON 格式精确回复，不要加 markdown 代码块。",
      PLAN_PROMPT
        .replace("{GOAL}", enrichedGoal)
        .replace("{TASK_NAME}", taskName)
        .replace("{DOMAIN}", domain)
        .replace(/{PRIOR_LEVEL}/g, priorLevel)
        .replace("{BLOOM_TARGET}", String(bloomTarget))
        .replace("{TOTAL_HOURS}", String(estimatedHours))
        .replace("{RESOURCES}", JSON.stringify(resources.map((r, i) => ({ index: i, ...r }))))
        .replace("{ADJUSTMENT}", adjustment || "无")
    );

    interface PlanSubtask {
      title: string;
      description: string;
      duration_days: number;
      start_day: number;
      priority?: number;
      bloom_level?: number;
      deep_work_hours?: number;
      learning_method?: string;
      resource_indices?: number[];
    }
    interface PlanResult { subtasks?: PlanSubtask[] }
    const plan = parseJson<PlanResult>(planRaw);
    if (!plan || !Array.isArray(plan.subtasks) || plan.subtasks.length === 0) {
      if (!planRaw || !planRaw.trim()) {
        throw new Error("AI 返回内容为空，可能模型未响应或连接异常");
      }
      // 记录原始返回前缀，便于线上 Vercel 日志排查（截断避免刷屏）
      console.error("[AutoTask] plan stage raw (truncated):", planRaw.slice(0, 500));
      throw new Error("AI 返回了内容但解析不出子任务列表，可能是返回格式异常或被截断");
    }

    // ── Stage 4: Validate ─────────────────────────────────────────
    const validateRaw = await callAI(
      "你是教育心理学专家，请以 JSON 格式精确回复，不要加 markdown 代码块。",
      VALIDATE_PROMPT
        .replace("{GOAL}", enrichedGoal)
        .replace(/{PRIOR_LEVEL}/g, priorLevel)
        .replace("{PLAN}", JSON.stringify(plan.subtasks))
    );

    interface ValidateResult { pass?: boolean; score?: number; suggestions?: string }
    const validation = parseJson<ValidateResult>(validateRaw);

    // 本地 Bloom 序列验证（双重保障）
    const bloomLevels = plan.subtasks
      .map((s) => (s.bloom_level ?? 2) as BloomLevel)
      .filter((l) => l >= 1 && l <= 6);
    const bloomOk = validateBloomSequence(bloomLevels);

    let finalPlan = plan;
    const needsRevision =
      (validation?.pass === false && !!validation?.suggestions) || !bloomOk;

    if (needsRevision) {
      const revisionNote = !bloomOk
        ? "Bloom层级跳跃：请确保层级从1-2渐进到3-4，相邻差不超过2级。"
        : (validation?.suggestions ?? "");

      const revisedRaw = await callAI(
        "你是学习计划设计专家，精通Bloom认知分类法，请以 JSON 格式精确回复，不要加 markdown 代码块。",
        PLAN_PROMPT
          .replace("{GOAL}", enrichedGoal)
          .replace("{TASK_NAME}", taskName)
          .replace("{DOMAIN}", domain)
          .replace(/{PRIOR_LEVEL}/g, priorLevel)
          .replace("{BLOOM_TARGET}", String(bloomTarget))
          .replace("{TOTAL_HOURS}", String(estimatedHours))
          .replace("{RESOURCES}", JSON.stringify(resources.map((r, i) => ({ index: i, ...r }))))
          .replace("{ADJUSTMENT}", adjustment || "无")
        + `\n\n审核意见（请按此修正）：${revisionNote}`
      );
      const revised = parseJson<PlanResult>(revisedRaw);
      if (revised?.subtasks?.length) finalPlan = revised;
    }

    // ── DB Write + 交错排期 ───────────────────────────────────────
    const rawInput = task.rawInput || task.title;
    await updateTaskTitleAndRawInput(id, taskName, rawInput);

    // 全局接续排期（窗口式：超过7天间隙则从今天开始）
    const existingSchedule = await getScheduledTasksByUser(auth.user.id);
    const today = todayMidnight();
    const otherTasks: ScheduledTask[] = existingSchedule
      .filter((t) => t.taskId !== id && t.status !== "done" && t.startDate != null)
      .map((t) => ({
        taskId: t.taskId,
        startDate: t.startDate!,
        totalDays: Math.max(t.totalDays, 1),
        priorityScore: 3,
        topicCategory,
        createdAt: t.createdAt,
      }));

    const newStartDate = computeNewTaskStartDate(otherTasks, today);
    await updateTaskStartDate(id, newStartDate);

    // 按 Bloom 层级渐进排序（同层级按 priority 排）
    const sorted = [...finalPlan.subtasks!].sort((a, b) => {
      const bloomA = a.bloom_level ?? 2;
      const bloomB = b.bloom_level ?? 2;
      if (bloomA !== bloomB) return bloomA - bloomB;
      return (a.priority ?? 3) - (b.priority ?? 3);
    });

    // 建立每日槽位（交错学习约束 + v3 难度波浪/领域亲和度）
    const dailySlots = new Map<string, DailySlot>();
    let cumulativeDay = 0;

    const subtaskItems = sorted.map((s, i) => {
      // 找满足每日容量 + 主题 + Bloom + 领域亲和度约束的最早可用日期
      const earliestDate = new Date(newStartDate);
      earliestDate.setDate(newStartDate.getDate() + cumulativeDay);

      const bloomLevel = s.bloom_level ?? 2;
      const actualDate = findNextAvailableDay(earliestDate, topicCategory, dailySlots, bloomLevel);
      const actualStartDay = Math.round(
        (actualDate.getTime() - newStartDate.getTime()) / 86400000
      );

      registerDailySlot(actualDate.toISOString().slice(0, 10), topicCategory, dailySlots, bloomLevel);
      cumulativeDay = actualStartDay + s.duration_days;

      const subtaskResources: TrustableResource[] = (s.resource_indices ?? [])
        .map((idx: number) => resources[idx])
        .filter(Boolean);

      return {
        title: s.title,
        description: s.description,
        durationDays: Math.min(Math.max(s.duration_days, 1), 7),
        startDay: actualStartDay,
        sortOrder: i,
        resources: subtaskResources.length > 0 ? JSON.stringify(subtaskResources) : null,
        topic: topicCategory,
        urgency: urgencyScore,
        importance: importanceScore,
        keywords: keywordsArr.length > 0 ? JSON.stringify(keywordsArr) : null,
        bloomLevel: s.bloom_level != null ? Math.round(s.bloom_level) : null,         // ← AI 返回浮点，列是 integer，必须取整
        deepWorkHours: s.deep_work_hours ?? null,  // ← 真实写入 DB
      };
    });

    // 建议复习节点（Spaced Repetition 思路）
    const reviewNodes = suggestReviewNodes(
      subtaskItems.map((s) => ({ startDay: s.startDay, durationDays: s.durationDays }))
    );

    const saved = await createSubtasks(id, subtaskItems);
    const totalDays = saved.reduce(
      (max, s) => Math.max(max, s.startDay + s.durationDays), 0
    );
    await updateTaskTotalDays(id, totalDays);
    await updateTaskStatus(id, "done");

    const result = {
      subtasks: saved,
      totalDays,
      taskName,
      rawInput,
      startDate: newStartDate.toISOString(),
      topicCategory,
      priorLevel,
      bloomTarget,
      reviewNodes,
      verifiedCount,
      reachableCount,
    };

    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const errAny = err as Record<string, unknown>;
    const detail = {
      message: err instanceof Error ? err.message : String(err),
      code: errAny.code,
      detail: errAny.detail,
      hint: errAny.hint,
      severity: errAny.severity,
      routine: errAny.routine,
      position: errAny.position,
      schema: errAny.schema,
      table: errAny.table,
      column: errAny.column,
    };
    console.error("[AutoTask] analyze pipeline error:", JSON.stringify(detail));
    return NextResponse.json({ ok: false, error: detail.message, pgCode: detail.code as string }, { status: 500 });
  }
}
