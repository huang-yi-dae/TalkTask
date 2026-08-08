import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, subtasks } from "@/lib/db/schema";
import type { Task, Subtask } from "@/lib/db/schema";

// ── Task with progress counts ─────────────────────────────────────────
export type TaskWithProgress = Task & {
  subtaskCount: number;
  completedCount: number;
};

// ── Subtask row enriched with parent task info ────────────────────────
export type SubtaskWithTask = Subtask & {
  taskTitle: string;
  taskRawInput: string | null;
  taskStartDate: Date | null;  // 大任务开始日期
  taskStatus: string;
  taskCreatedAt: Date;
};

// ── Tasks ────────────────────────────────────────────────────────────

export async function getTasksByUser(userId: string): Promise<TaskWithProgress[]> {
  const rows = await db
    .select({
      id: tasks.id,
      userId: tasks.userId,
      title: tasks.title,
      rawInput: tasks.rawInput,
      startDate: tasks.startDate,
      status: tasks.status,
      totalDays: tasks.totalDays,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      subtaskCount: sql<number>`COUNT(${subtasks.id})::int`,
      completedCount: sql<number>`COUNT(${subtasks.id}) FILTER (WHERE ${subtasks.completed} = true)::int`,
    })
    .from(tasks)
    .leftJoin(subtasks, eq(subtasks.taskId, tasks.id))
    .where(eq(tasks.userId, userId))
    .groupBy(tasks.id)
    .orderBy(desc(tasks.createdAt));

  return rows as TaskWithProgress[];
}

/** 返回该用户所有子任务，附带所属大任务 title / rawInput / startDate / status */
export async function getSubtasksWithTaskByUser(userId: string): Promise<SubtaskWithTask[]> {
  const rows = await db
    .select({
      // subtask fields
      id: subtasks.id,
      taskId: subtasks.taskId,
      title: subtasks.title,
      description: subtasks.description,
      durationDays: subtasks.durationDays,
      startDay: subtasks.startDay,
      completed: subtasks.completed,
      sortOrder: subtasks.sortOrder,
      resources: subtasks.resources,
      topic: subtasks.topic,
      urgency: subtasks.urgency,
      importance: subtasks.importance,
      keywords: subtasks.keywords,
      createdAt: subtasks.createdAt,
      // parent task fields
      taskTitle: tasks.title,
      taskRawInput: tasks.rawInput,
      taskStartDate: tasks.startDate,
      taskStatus: tasks.status,
      taskCreatedAt: tasks.createdAt,
    })
    .from(subtasks)
    .innerJoin(tasks, eq(subtasks.taskId, tasks.id))
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.createdAt), subtasks.sortOrder);

  return rows as SubtaskWithTask[];
}

export async function getTaskById(id: string): Promise<Task | null> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id));
  return rows[0] ?? null;
}

export async function createTask(
  userId: string,
  title: string
): Promise<Task> {
  const rows = await db
    .insert(tasks)
    .values({ userId, title, status: "active", totalDays: 0 })
    .returning();
  return rows[0];
}

export async function updateTaskTitleAndRawInput(
  id: string,
  title: string,
  rawInput: string,
): Promise<void> {
  await db
    .update(tasks)
    .set({ title, rawInput, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function updateTaskStartDate(
  id: string,
  startDate: Date,
): Promise<void> {
  await db
    .update(tasks)
    .set({ startDate, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function updateTaskTotalDays(
  id: string,
  totalDays: number
): Promise<void> {
  await db
    .update(tasks)
    .set({ totalDays, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function updateTaskStatus(
  id: string,
  status: string
): Promise<void> {
  await db
    .update(tasks)
    .set({ status, updatedAt: new Date() })
    .where(eq(tasks.id, id));
}

export async function deleteTask(id: string): Promise<void> {
  await db.delete(tasks).where(eq(tasks.id, id));
}

// ── Subtasks ─────────────────────────────────────────────────────────

export async function getSubtasksByTask(taskId: string): Promise<Subtask[]> {
  return db
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, taskId))
    .orderBy(subtasks.sortOrder);
}

export type SubtaskInsert = {
  title: string;
  description?: string;
  durationDays: number;
  startDay: number;
  sortOrder: number;
  resources?: string | null;
  topic?: string | null;
  urgency?: number | null;
  importance?: number | null;
  keywords?: string | null;  // JSON string[]
  bloomLevel?: number | null;     // 1-6 Bloom 认知层级
  deepWorkHours?: number | null;  // 预计深度学习时长（小时）
};

export async function createSubtasks(
  taskId: string,
  items: SubtaskInsert[]
): Promise<Subtask[]> {
  if (items.length === 0) return [];
  const rows = await db
    .insert(subtasks)
    .values(items.map((s) => ({ ...s, taskId })))
    .returning();
  return rows;
}

export async function toggleSubtask(
  id: string,
  completed: boolean
): Promise<void> {
  await db.update(subtasks)
    .set({
      completed,
      // 完成时记录时间戳（用于连续性追踪 / streak）；取消完成时清空
      completedAt: completed ? new Date() : null,
    })
    .where(eq(subtasks.id, id));
}

/**
 * 将单个子任务往后延迟一天：startDay += 1。
 * 用于用户觉得当天排不下、想顺延的场景。返回更新后的 startDay。
 */
export async function postponeSubtask(id: string, delta = 1): Promise<number> {
  const rows = await db
    .select({ startDay: subtasks.startDay })
    .from(subtasks)
    .where(eq(subtasks.id, id))
    .limit(1);
  const current = rows[0]?.startDay ?? 0;
  const next = Math.max(0, current + delta);
  await db.update(subtasks)
    .set({ startDay: next })
    .where(eq(subtasks.id, id));
  return next;
}

/** 返回该用户所有任务的排期摘要（用于全局接续计算） */
export async function getScheduledTasksByUser(userId: string): Promise<Array<{
  taskId: string;
  startDate: Date | null;
  totalDays: number;
  createdAt: Date;
  status: string;
}>> {
  const rows = await db
    .select({
      taskId: tasks.id,
      startDate: tasks.startDate,
      totalDays: tasks.totalDays,
      createdAt: tasks.createdAt,
      status: tasks.status,
    })
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(tasks.createdAt);
  return rows;
}

/** 返回该用户所有完成分析的任务（含子任务），用于右侧面板持久化加载 */
export type TaskWithSubtasksFull = Task & { subtasks: Subtask[] };

export async function getTasksWithSubtasksByUser(userId: string): Promise<TaskWithSubtasksFull[]> {
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.createdAt));

  if (taskRows.length === 0) return [];

  // fetch subtasks for all tasks in one query
  const { inArray } = await import("drizzle-orm");
  const taskIds = taskRows.map((t) => t.id);
  const subtaskRows = await db
    .select()
    .from(subtasks)
    .where(inArray(subtasks.taskId, taskIds))
    .orderBy(subtasks.sortOrder);

  // group subtasks by taskId
  const byTask = new Map<string, Subtask[]>();
  for (const s of subtaskRows) {
    if (!byTask.has(s.taskId)) byTask.set(s.taskId, []);
    byTask.get(s.taskId)!.push(s);
  }

  return taskRows.map((t) => ({ ...t, subtasks: byTask.get(t.id) ?? [] }));
}
