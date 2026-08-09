"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useEazo } from "@/lib/eazo-shim";
import { auth } from "@/lib/eazo-shim";
import {
  deleteTask, getSubtasksWithTask, getTasksWithSubtasks,
  toggleSubtask, updateTaskStatusApi,
} from "@/lib/api/tasks";
import type { SubtaskWithTask } from "@/lib/api/tasks";
import { RightPanel, useAnalysisPanel } from "./right-panel";
import { NewTaskInput } from "./new-task-input";
import { getSubtaskActualDates } from "./subtask-row";
import { TimelineCard, TimelineSectionHeader } from "./timeline-card";
import { SubtaskDetailModal } from "./subtask-detail-modal";
import { CongratulationsModal, type CongratsData } from "./congrats-modal";
import { AchievementPanel, LevelBadge } from "./achievement-panel";
import { MilestoneUnlockModal } from "./milestone-unlock-modal";
import { crossedMilestone, type Level } from "@/lib/growth";

// ─── Design Tokens ────────────────────────────────────────────────────
const T = {
  bg:      "#F9F9F8",
  surface: "#FFFFFF",
  soft:    "#F1F2EE",
  line:    "#E7E7E2",
  ink:     "#111111",
  muted:   "#777B75",
  accent:  "#3B7AFF",
  green:   "#2F5D50",
  sage:    "#A8B5A2",
  paper:   "#F4F1EA",
  error:   "#C0392B",
} as const;

type TimeFilter = "today" | "tomorrow" | "week" | "all";

// ─── Main Dashboard ───────────────────────────────────────────────────

export function HomePage() {
  const router = useRouter();
  const user = useEazo((s) => s.auth.user);
  const authLoading = useEazo((s) => s.auth.loading);

  const [subtaskRows, setSubtaskRows] = useState<SubtaskWithTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [showInput, setShowInput] = useState(false);
  const [streakTick, setStreakTick] = useState(0);
  const [detailSubtask, setDetailSubtask] = useState<SubtaskWithTask | null>(null);
  const [congrats, setCongrats] = useState<CongratsData | null>(null);
  const [highlightedSubtaskId, setHighlightedSubtaskId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [milestone, setMilestone] = useState<Level | null>(null);
  const totalCompletedRef = useRef<number>(0);

  const {
    entries, focusedId, setFocusedId,
    startAnalysis, regenAnalysis, removeEntry,
    hydrateFromDB, focusTask,
  } = useAnalysisPanel();

  const loadSubtasks = useCallback(async () => {
    setFetching(true);
    try { setSubtaskRows(await getSubtasksWithTask()); }
    finally { setFetching(false); }
  }, []);

  useEffect(() => {
    if (!user) { setSubtaskRows([]); return; }
    loadSubtasks();
  }, [user, loadSubtasks]);

  // Hydrate right panel with historical tasks on login
  useEffect(() => {
    if (!user) return;
    getTasksWithSubtasks().then((tasks) => hydrateFromDB(tasks)).catch(() => {});
  }, [user, hydrateFromDB]);

  // 成长体系：登录后拉一次统计，建立累计完成数基线（用于里程碑跨越检测）
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const res = await fetch("/api/user/stats");
        if (res.ok) {
          const s = await res.json();
          totalCompletedRef.current = s.totalCompleted ?? 0;
        }
      } catch { /* ignore */ }
    })();
  }, [user]);

  // Refresh left list when analysis completes
  useEffect(() => {
    const done = entries.some((e) => e.stream.phase === "done");
    if (done && user) loadSubtasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.map((e) => e.stream.phase).join(",")]);

  const handleDeleteTask = async (taskId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteTask(taskId).catch(() => {});
    setSubtaskRows((prev) => prev.filter((s) => s.taskId !== taskId));
    removeEntry(taskId);
  };

  const handleToggleSubtask = useCallback(async (taskId: string, subtaskId: string, current: boolean) => {
    const next = !current;
    setSubtaskRows((prev) => prev.map((s) => s.id === subtaskId ? { ...s, completed: next } : s));
    setDetailSubtask((prev) => prev?.id === subtaskId ? { ...prev, completed: next } : prev);
    await toggleSubtask(taskId, subtaskId, next).catch(() => {});
    // 完成时刷新 streak 统计 + 检测里程碑跨越
    if (next) {
      setStreakTick(t => t + 1);
      const before = totalCompletedRef.current;
      fetch("/api/user/stats").then((r) => (r.ok ? r.json() : null)).then((s) => {
        if (!s) return;
        const after = s.totalCompleted ?? 0;
        totalCompletedRef.current = after;
        const crossed = crossedMilestone(before, after);
        if (crossed) setMilestone(crossed);
      }).catch(() => {});
    }
    setSubtaskRows((prev) => {
      const rows = prev.filter((s) => s.taskId === taskId);
      const allDone = next && rows.length > 0 && rows.every((s) => (s.id === subtaskId ? next : s.completed));
      if (allDone) {
        updateTaskStatusApi(taskId, "done").catch(() => {});
        const taskTitle = rows[0]?.taskTitle ?? "";
        setCongrats({ taskId, taskTitle, subtasks: rows.map((s) => (s.id === subtaskId ? { ...s, completed: true } : s)) });
        return prev.map((s) => s.taskId === taskId ? { ...s, taskStatus: "done" } : s);
      }
      return prev;
    });
  }, []);

  const handleJumpToSubtask = useCallback((
    subtaskId: string, taskStartDate: string | null, startDay: number, durationDays: number,
  ) => {
    if (!taskStartDate) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today.getTime() + 86400000);
    const base = new Date(taskStartDate);
    if (isNaN(base.getTime())) return;
    const baseDay = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    const s = new Date(baseDay); s.setDate(baseDay.getDate() + startDay);
    const e = new Date(baseDay); e.setDate(baseDay.getDate() + startDay + durationDays - 1);
    let target: TimeFilter = "all";
    if (s <= today && today <= e) target = "today";
    else if (s <= tomorrow && tomorrow <= e) target = "tomorrow";
    else { const we = new Date(today.getTime() + 7 * 86400000); if (s <= we && e >= today) target = "week"; }
    setTimeFilter(target);
    setHighlightedSubtaskId(subtaskId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedSubtaskId(null), 3000);
  }, []);

  const filteredRows = sortSubtasks(filterSubtasksByTime(subtaskRows, timeFilter));
  const pendingCount = subtaskRows.filter((s) => !s.completed).length;
  const todayStr = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });

  // ── 全局键盘快捷键 ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 如果焦点在输入框/文本区/可编辑区，不触发
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;

      if (e.key === "n" || e.key === "N") {
        // N → 打开新建弹窗
        if (!showInput && !detailSubtask && !congrats) {
          e.preventDefault();
          setShowInput(true);
        }
      } else if (e.key === "Escape") {
        // Esc → 按层级关闭
        if (detailSubtask) {
          setDetailSubtask(null);
        } else if (showInput) {
          setShowInput(false);
        } else if (focusedId) {
          setFocusedId(null);
        }
      } else if (e.key === " ") {
        // Space → toggle 当前聚焦子任务中第一个未完成的
        if (!focusedId) return;
        const first = subtaskRows.find(s => s.taskId === focusedId && !s.completed);
        if (first) {
          e.preventDefault();
          handleToggleSubtask(first.taskId, first.id, first.completed);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInput, detailSubtask, congrats, focusedId, subtaskRows, handleToggleSubtask, setFocusedId]);

  return (
    <div style={{ background: T.bg, height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-geist), Geist, system-ui, sans-serif" }}>
      <header style={{ background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ color: T.ink, fontWeight: 700, fontSize: 17, letterSpacing: "-0.04em" }}>AutoTask</div>
          <div style={{ color: T.muted, fontSize: 11, marginTop: 1 }}>订单式任务系统原型</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {user && <LevelBadge refreshTick={streakTick} />}
          {!authLoading && !user && <button onClick={() => auth.login().catch(() => {})} style={{ color: T.muted, fontSize: 13, background: "none", border: `1px solid ${T.line}`, borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>登录</button>}
          {user && <button onClick={() => auth.logout().catch(() => {})} style={{ color: T.muted, fontSize: 13, background: "none", border: "none", cursor: "pointer" }}>退出</button>}
          <button onClick={() => { if (!user) { auth.login().catch(() => {}); return; } setShowInput(true); }}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 400 }}>+</span> 新建任务
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: `1px solid ${T.line}`, overflow: "hidden" }}>
          <div style={{ padding: "10px 20px", borderBottom: `1px solid ${T.line}`, display: "flex", alignItems: "center", gap: 8, background: T.surface, flexShrink: 0 }}>
            <TimeFilterTabs value={timeFilter} onChange={setTimeFilter} />
            <div style={{ flex: 1 }} />
            <span style={{ color: T.muted, fontSize: 12, fontFamily: "var(--font-geist-mono), monospace" }}>共 {filteredRows.length} 项</span>
          </div>

          {/* 成长体系 · 学习日历面板（已合并原「连续性统计条」）*/}
          {user && !fetching && subtaskRows.length > 0 && (
            <AchievementPanel refreshTick={streakTick} pending={pendingCount} title="学习日历" />
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {authLoading || fetching ? (
              <div style={{ color: T.muted, fontSize: 13, padding: "40px 24px", textAlign: "center" }}>加载中…</div>
            ) : !user ? (
              <div style={{ color: T.muted, fontSize: 13, padding: "60px 24px", textAlign: "center" }}>
                <div style={{ marginBottom: 12 }}>登录后可查看和管理任务</div>
                <button onClick={() => auth.login().catch(() => {})} style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, cursor: "pointer" }}>登录</button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div style={{ padding: "48px 16px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                {/* 图示 */}
                <div style={{ fontSize: 52, lineHeight: 1 }}>📚</div>
                <div>
                  <div style={{ color: T.ink, fontWeight: 700, fontSize: 16, marginBottom: 6, letterSpacing: "-0.03em" }}>还没有学习任务</div>
                  <div style={{ color: T.muted, fontSize: 13 }}>选一个方向，AI 帮你拆解成可执行的子任务</div>
                </div>
                {/* 示例按钮 */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 260 }}>
                  {[
                    { icon: "🐍", label: "从零掌握 Python 基础", value: "从零开始掌握 Python 基础，能写简单脚本" },
                    { icon: "⚛️", label: "React Hooks 实战",    value: "掌握 React Hooks，能独立开发 Todo 应用" },
                    { icon: "📐", label: "高考数学冲刺",          value: "高考数学冲刺，重点突破导数与概率" },
                  ].map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => { if (!user) { auth.login().catch(() => {}); return; } startAnalysis(ex.value); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: T.surface, border: `1.5px solid ${T.line}`,
                        borderRadius: 10, padding: "10px 14px",
                        fontSize: 13, color: T.ink, fontWeight: 500,
                        cursor: "pointer", textAlign: "left",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = T.accent;
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,122,255,0.04)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = T.line;
                        (e.currentTarget as HTMLButtonElement).style.background = T.surface;
                      }}
                    >
                      <span style={{ fontSize: 18 }}>{ex.icon}</span>
                      <span style={{ flex: 1 }}>{ex.label}</span>
                      <span style={{ color: T.muted, fontSize: 12 }}>→</span>
                    </button>
                  ))}
                  <button
                    onClick={() => { if (!user) { auth.login().catch(() => {}); return; } setShowInput(true); }}
                    style={{ border: `1px dashed ${T.line}`, borderRadius: 10, padding: "9px 14px", fontSize: 13, color: T.muted, cursor: "pointer", background: "transparent" }}
                  >
                    + 自定义目标…
                  </button>
                </div>
              </div>
            ) : (
              buildTimelineSections(filteredRows).filter((s) => s.rows.length > 0).map((section) => (
                <div key={section.key} style={{ marginBottom: 28 }}>
                  <TimelineSectionHeader
                    label={section.label}
                    sublabel={section.sublabel}
                    accentColor={section.accentColor}
                    pendingCount={section.rows.filter((r) => !r.completed).length}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {section.rows.map((row) => (
                      <div key={row.id} id={`subtask-card-${row.id}`}>
                        <TimelineCard
                          row={row}
                          isSelected={focusedId === row.taskId}
                          isHighlighted={highlightedSubtaskId === row.id}
                          onOpen={() => setDetailSubtask(row)}
                          onSelect={() => { setFocusedId(row.taskId); focusTask(row.taskId); }}
                          onDeleteTask={handleDeleteTask}
                          onToggle={(e) => { e.stopPropagation(); handleToggleSubtask(row.taskId, row.id, row.completed); }}
                          onSkip={(e) => { e.stopPropagation(); if (!row.completed) handleToggleSubtask(row.taskId, row.id, row.completed); }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <RightPanel entries={entries} focusedId={focusedId} setFocusedId={setFocusedId}
          regenAnalysis={regenAnalysis} removeEntry={removeEntry}
          onToggleSubtask={handleToggleSubtask} onJumpToSubtask={handleJumpToSubtask} />
      </div>

      <footer style={{ background: T.surface, borderTop: `1px solid ${T.line}`, padding: "7px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ color: T.muted, fontSize: 12 }}>今天：{todayStr}</span>
        <span style={{ color: T.muted, fontSize: 11, display: "flex", gap: 12 }}>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>N</kbd> 新建</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>Space</kbd> 完成</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>Esc</kbd> 关闭</span>
        </span>
      </footer>

      {showInput && <NewTaskInput onClose={() => setShowInput(false)} onSubmit={(goal) => startAnalysis(goal)} />}
      {detailSubtask && <SubtaskDetailModal row={detailSubtask} onClose={() => setDetailSubtask(null)} onToggle={() => handleToggleSubtask(detailSubtask.taskId, detailSubtask.id, detailSubtask.completed)} onOpenTask={() => { router.push(`/task/${detailSubtask.taskId}`); setDetailSubtask(null); }} />}
      {congrats && <CongratulationsModal data={congrats} onClose={() => setCongrats(null)} onLearnMore={(taskId) => { setFocusedId(taskId); focusTask(taskId); setCongrats(null); }} />}
      {milestone && <MilestoneUnlockModal level={milestone} onClose={() => setMilestone(null)} />}
    </div>
  );
}

// ─── 时间轴分段构建 ───────────────────────────────────────────────────
interface TimelineSection {
  key: string;
  label: string;
  sublabel: string;
  accentColor: string;
  rows: SubtaskWithTask[];
}

/**
 * 将所有子任务按时间段分为 4 组：
 *   今天 / 明天 / 本周（后 7 天）/ 更晚
 * 每组内：未完成在前（按 sortOrder），已完成在后
 * 移植自 mytask（huang-yi-dae/MyTask）fresh-start 分支，适配 talkTask 的 eazo-shim。
 */
function buildTimelineSections(rows: SubtaskWithTask[]): TimelineSection[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekEnd = new Date(today.getTime() + 7 * 86400000);

  const fmtDate = (d: Date) => d.toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
  const fmtRange = (s: Date, e: Date) =>
    `${s.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} — ${e.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}`;

  const buckets: Record<string, SubtaskWithTask[]> = {
    today: [], tomorrow: [], week: [], later: [],
  };

  for (const r of rows) {
    const dates = getSubtaskActualDates(r);
    if (!dates) {
      buckets.today.push(r);
      continue;
    }
    const { start, end } = dates;
    if (start <= today && today <= end) {
      buckets.today.push(r);
    } else if (start <= tomorrow && tomorrow <= end) {
      buckets.tomorrow.push(r);
    } else if (start <= weekEnd && end >= today) {
      buckets.week.push(r);
    } else {
      buckets.later.push(r);
    }
  }

  // 始终按 sortOrder 保持原始排列位置：
  // 完成子任务后不再把它挪到组末尾，避免用户误点相邻项
  const sort = (arr: SubtaskWithTask[]) =>
    [...arr].sort((a, b) => a.sortOrder - b.sortOrder);

  return [
    { key: "today", label: "今天", sublabel: fmtDate(today), accentColor: "#3B7AFF", rows: sort(buckets.today) },
    { key: "tomorrow", label: "明天", sublabel: fmtDate(tomorrow), accentColor: "#E07B2A", rows: sort(buckets.tomorrow) },
    { key: "week", label: "本周", sublabel: fmtRange(new Date(today.getTime() + 2 * 86400000), weekEnd), accentColor: "#2F5D50", rows: sort(buckets.week) },
    { key: "later", label: "更晚", sublabel: (() => {
        const laterRows = sort(buckets.later);
        if (laterRows.length === 0) return "7 天之后";
        // 从所有 later 行里找最早和最晚的实际日期
        let minDate: Date | null = null;
        let maxDate: Date | null = null;
        for (const r of laterRows) {
          const d = getSubtaskActualDates(r);
          if (!d) continue;
          if (!minDate || d.start < minDate) minDate = d.start;
          if (!maxDate || d.end > maxDate) maxDate = d.end;
        }
        if (!minDate || !maxDate) return "7 天之后";
        const diffDays = Math.round((minDate.getTime() - today.getTime()) / 86400000);
        const dayHint = diffDays > 0 ? `（${diffDays} 天后开始）` : "";
        return `${fmtRange(minDate, maxDate)}${dayHint}`;
      })(), accentColor: "#94a3b8", rows: sort(buckets.later) },
  ];
}

// ─── Time Filter Tabs ─────────────────────────────────────────────────

function TimeFilterTabs({ value, onChange }: { value: TimeFilter; onChange: (v: TimeFilter) => void }) {
  const tabs: { key: TimeFilter; label: string }[] = [
    { key: "today", label: "今天" },
    { key: "tomorrow", label: "明天" },
    { key: "week", label: "未来 7 天" },
    { key: "all", label: "全部" },
  ];
  return (
    <div style={{ display: "flex", gap: 2, background: T.soft, borderRadius: 8, padding: 3 }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: "5px 12px", borderRadius: 6, border: "none", fontSize: 13, cursor: "pointer",
            background: value === t.key ? T.surface : "transparent",
            color: value === t.key ? T.ink : T.muted,
            fontWeight: value === t.key ? 600 : 400,
            boxShadow: value === t.key ? "0 1px 4px rgba(17,17,17,0.07)" : "none",
            transition: "all 0.15s", letterSpacing: "-0.01em",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────

function sortSubtasks(rows: SubtaskWithTask[]): SubtaskWithTask[] {
  return [...rows].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return a.sortOrder - b.sortOrder;
  });
}

function filterSubtasksByTime(rows: SubtaskWithTask[], filter: TimeFilter): SubtaskWithTask[] {
  if (filter === "all") return rows;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekEnd = new Date(today.getTime() + 7 * 86400000);
  return rows.filter((r) => {
    const dates = getSubtaskActualDates(r);
    if (!dates) {
      const d = new Date(r.taskCreatedAt);
      const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (filter === "today")    return day.getTime() === today.getTime();
      if (filter === "tomorrow") return day.getTime() === tomorrow.getTime();
      if (filter === "week")     return day >= today && day <= weekEnd;
      return true;
    }
    const { start, end } = dates;
    if (filter === "today")    return start <= today    && today    <= end;
    if (filter === "tomorrow") return start <= tomorrow && tomorrow <= end;
    if (filter === "week")     return start <= weekEnd  && end      >= today;
    return true;
  });
}



