"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useEazo, auth, memory } from "@/lib/eazo-shim";
import { getTask, toggleSubtask, updateTaskStatusApi } from "@/lib/api/tasks";
import type { TaskWithSubtasks } from "@/lib/api/tasks";
import { GanttChart } from "@/components/task/gantt-chart";

interface TaskDetailPageProps { taskId: string; }

export function TaskDetailPage({ taskId }: TaskDetailPageProps) {
  const user = useEazo((s) => s.auth.user);
  const loading = useEazo((s) => s.auth.loading);
  const [task, setTask] = useState<TaskWithSubtasks | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const completedCount = task?.subtasks.filter((s) => s.completed).length ?? 0;
  const totalCount = task?.subtasks.length ?? 0;
  const progressPct = totalCount > 0 ? completedCount / totalCount : 0;

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getTask(taskId)
      .then((data) => { if (!cancelled) { setFetching(false); setTask(data); } })
      .catch((e) => { if (!cancelled) { setFetching(false); setError(e.message); } });
    return () => { cancelled = true; };
  }, [taskId, user]);

  const handleToggle = useCallback(
    async (subtaskId: string, current: boolean) => {
      if (!task) return;
      const next = !current;

      // 乐观更新本地状态
      const updatedSubtasks = task.subtasks.map((s) =>
        s.id === subtaskId ? { ...s, completed: next } : s
      );
      setTask((prev) =>
        prev ? { ...prev, subtasks: updatedSubtasks } : prev
      );

      await toggleSubtask(taskId, subtaskId, next).catch(() => {});

      // 全部完成后，将任务状态标记为 done
      const allDone =
        next &&
        updatedSubtasks.length > 0 &&
        updatedSubtasks.every((s) => s.completed);
      if (allDone) {
        await updateTaskStatusApi(taskId, "done").catch(() => {});
        setTask((prev) => prev ? { ...prev, status: "done" } : prev);
      } else if (!next && task.status === "done") {
        // 取消勾选后回退状态
        await updateTaskStatusApi(taskId, "active").catch(() => {});
        setTask((prev) => prev ? { ...prev, status: "active" } : prev);
      }

      memory.reportAction({
        content: `User ${next ? "completed" : "uncompleted"} subtask in task "${task.title}"`,
        event_type: next ? "complete" : "update",
      }).catch(() => {});
    },
    [task, taskId]
  );

  if (loading || fetching) {
    return <PageShell><LoadingState /></PageShell>;
  }

  if (!user) {
    return (
      <PageShell>
        <div className="flex flex-col items-center gap-4 py-20">
          <p className="text-[14px]" style={{ color: "#777B75" }}>需要登录</p>
          <button
            onClick={() => auth.login().catch(() => {})}
            className="px-6 py-[10px] rounded-full text-[14px] font-medium text-white hover:opacity-90 transition-opacity"
            style={{ background: "#111111" }}
          >
            登录
          </button>
        </div>
      </PageShell>
    );
  }

  if (error || !task) {
    return (
      <PageShell>
        <p className="text-[14px]" style={{ color: "#777B75" }}>任务未找到</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <div>
          <div className="flex items-start gap-3 flex-wrap">
            <h1
              className="text-[clamp(28px,8vw,52px)] font-semibold leading-none tracking-[-0.05em]"
              style={{ color: "#111111" }}
            >
              {task.title}
            </h1>
            {task.status === "done" && (
              <span
                className="mt-1 px-2.5 py-1 rounded-full text-[12px] font-medium flex-shrink-0"
                style={{
                  background: "rgba(47,93,80,0.12)",
                  color: "#2F5D50",
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              >
                ✓ 已完成
              </span>
            )}
          </div>
          <p
            className="mt-2 text-[13px]"
            style={{ color: "#777B75", fontFamily: "var(--font-geist-mono), monospace" }}
          >
            {task.totalDays}天计划 ·{" "}
            {new Date(task.createdAt).toLocaleDateString("zh-CN")} ·{" "}
            {completedCount}/{totalCount} 完成
          </p>
        </div>

        <div className="h-[3px] rounded-full" style={{ background: "#E7E7E2" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progressPct * 100}%`, background: "#3B7AFF" }}
          />
        </div>

        <div
          className="rounded-[20px] overflow-hidden"
          style={{
            border: "1px solid #E7E7E2",
            background: "rgba(255,255,255,0.56)",
            boxShadow: "0 12px 40px rgba(20,20,20,0.035)",
          }}
        >
          {task.subtasks.map((s, i) => (
            <label
              key={s.id}
              className="grid items-center px-[18px] py-4 cursor-pointer transition-colors hover:bg-white active:scale-[0.99]"
              style={{
                gridTemplateColumns: "auto 1fr auto",
                gap: 12,
                borderTop: i === 0 ? "none" : "1px solid #E7E7E2",
              }}
            >
              <input
                type="checkbox"
                checked={s.completed}
                onChange={() => handleToggle(s.id, s.completed)}
                style={{ accentColor: "#3B7AFF", width: 20, height: 20 }}
              />
              <span>
                <b
                  className="text-[15px] font-semibold block"
                  style={{
                    color: s.completed ? "#777B75" : "#111111",
                    textDecoration: s.completed ? "line-through" : "none",
                  }}
                >
                  {s.title}
                </b>
                {s.description && (
                  <small className="block mt-1 text-[13px]" style={{ color: "#777B75" }}>
                    {s.description}
                  </small>
                )}
              </span>
              <span
                className="text-[12px] font-medium"
                style={{ color: "#2F5D50", fontFamily: "var(--font-geist-mono), monospace" }}
              >
                {s.durationDays}天
              </span>
            </label>
          ))}

          <GanttChart
            subtasks={task.subtasks}
            totalDays={task.totalDays}
            animated={false}
            collapsible={true}
            defaultOpen={true}
          />
        </div>

        <div className="flex gap-8 pt-2">
          <Stat label="已完成" value={String(completedCount)} />
          <Stat label="总计" value={String(totalCount)} />
          <Stat label="计划天数" value={`${task.totalDays}天`} />
        </div>
      </div>
    </PageShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="text-[clamp(22px,5vw,32px)] font-semibold"
        style={{ letterSpacing: "-0.05em", color: "#111111" }}
      >
        {value}
      </div>
      <div
        className="text-[11px] uppercase tracking-[0.06em] mt-0.5"
        style={{ color: "#777B75", fontFamily: "var(--font-geist-mono), monospace" }}
      >
        {label}
      </div>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative z-10"
      style={{
        paddingTop: "var(--safe-top)",
        paddingBottom: "var(--safe-bottom)",
        minHeight: "100vh",
      }}
    >
      <div className="mx-auto px-4" style={{ width: "min(100% - 32px, 760px)" }}>
        <nav
          className="flex items-center justify-between"
          style={{ height: 64, fontSize: 14, color: "#777B75" }}
        >
          <Link
            href="/history"
            className="font-[650] tracking-[-0.03em] hover:opacity-70 transition-opacity"
            style={{ color: "#111111" }}
          >
            ← 历史任务
          </Link>
          <span
            className="text-[12px] uppercase tracking-[0.06em]"
            style={{ color: "#777B75", fontFamily: "var(--font-geist-mono), monospace" }}
          >
            Task Detail
          </span>
        </nav>
        <div className="pt-4 pb-14">{children}</div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <p className="text-[14px] py-10" style={{ color: "#777B75" }}>
      加载中…
    </p>
  );
}
