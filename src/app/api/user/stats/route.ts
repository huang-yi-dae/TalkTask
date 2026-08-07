import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { subtasks, tasks } from "@/lib/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * GET /api/user/stats
 * 返回用户的学习统计数据：
 *   - streak：连续学习天数（连续有完成记录的日历天数）
 *   - weeklyCompleted：本周完成子任务数
 *   - weeklyTotal：本周计划子任务数
 *   - todayCompleted：今天完成数
 *   - totalCompleted：累计完成总数
 *   - activeTasks：进行中的大任务数
 */
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const userId = auth.user.id;

  try {
    // ── 计算时间边界 ──────────────────────────────────────────────────
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd   = new Date(todayStart.getTime() + 86400000);

    // 本周一 0:00
    const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 周一=0
    const weekStart = new Date(todayStart.getTime() - dayOfWeek * 86400000);

    // 90 天内（streak 最多追溯 90 天）
    const ninetyDaysAgo = new Date(todayStart.getTime() - 90 * 86400000);

    // ── 查询完成的子任务（含日期信息）────────────────────────────────
    const completedRows = await db
      .select({
        completedAt: subtasks.completedAt,
        taskUserId: tasks.userId,
      })
      .from(subtasks)
      .innerJoin(tasks, eq(subtasks.taskId, tasks.id))
      .where(
        and(
          eq(tasks.userId, userId),
          eq(subtasks.completed, true),
          gte(subtasks.completedAt, ninetyDaysAgo),
        )
      );

    // ── 今天完成数 ────────────────────────────────────────────────────
    const todayCompleted = completedRows.filter((r) => {
      if (!r.completedAt) return false;
      const d = new Date(r.completedAt);
      return d >= todayStart && d < todayEnd;
    }).length;

    // ── 本周完成数 ────────────────────────────────────────────────────
    const weeklyCompleted = completedRows.filter((r) => {
      if (!r.completedAt) return false;
      return new Date(r.completedAt) >= weekStart;
    }).length;

    // ── 本周计划数（本周 startDay 区间内的子任务）───────────────────
    // 简化：统计 status=active 任务下所有子任务数量作为分母
    const weeklyTotalRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(subtasks)
      .innerJoin(tasks, eq(subtasks.taskId, tasks.id))
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "active")));
    const weeklyTotal = weeklyTotalRows[0]?.count ?? 0;

    // ── 累计完成总数 ─────────────────────────────────────────────────
    const totalRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(subtasks)
      .innerJoin(tasks, eq(subtasks.taskId, tasks.id))
      .where(and(eq(tasks.userId, userId), eq(subtasks.completed, true)));
    const totalCompleted = totalRows[0]?.count ?? 0;

    // ── 进行中大任务数 ───────────────────────────────────────────────
    const activeRows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, "active")));
    const activeTasks = activeRows[0]?.count ?? 0;

    // ── 计算连续天数（streak）────────────────────────────────────────
    // 把 completedAt 按日期归组，得到 Set<dateStr>
    const activeDays = new Set<string>();
    for (const r of completedRows) {
      if (!r.completedAt) continue;
      const d = new Date(r.completedAt);
      activeDays.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    }

    // 从今天或昨天开始往回数连续天数
    let streak = 0;
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    // 如果今天有完成，从今天算；否则从昨天算（当天未完成不断streak）
    const startFromToday = activeDays.has(todayStr);
    let checkDate = new Date(todayStart);
    if (!startFromToday) {
      checkDate = new Date(todayStart.getTime() - 86400000); // 从昨天开始
    }

    for (let i = 0; i < 90; i++) {
      const dStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth()+1).padStart(2,"0")}-${String(checkDate.getDate()).padStart(2,"0")}`;
      if (!activeDays.has(dStr)) break;
      streak++;
      checkDate = new Date(checkDate.getTime() - 86400000);
    }

    return NextResponse.json({
      streak,
      todayCompleted,
      weeklyCompleted,
      weeklyTotal,
      totalCompleted,
      activeTasks,
    });
  } catch (err) {
    console.error("[stats] error:", err);
    return NextResponse.json({ streak: 0, todayCompleted: 0, weeklyCompleted: 0, weeklyTotal: 0, totalCompleted: 0, activeTasks: 0 });
  }
}
