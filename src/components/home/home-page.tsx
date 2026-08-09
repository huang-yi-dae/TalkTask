"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useEazo } from "@/lib/eazo-shim";
import { auth } from "@/lib/eazo-shim";
import {
  getSubtasksWithTask, getTasksWithSubtasks,
  toggleSubtask, updateTaskStatusApi, postponeSubtask, unpostponeSubtask,
} from "@/lib/api/tasks";
import type { SubtaskWithTask } from "@/lib/api/tasks";
import { RightPanel, useAnalysisPanel } from "./right-panel";
import { NewTaskInput } from "./new-task-input";
import { getSubtaskActualDates } from "./subtask-row";
import { TimelineCard, TimelineSectionHeader } from "./timeline-card";
import { SubtaskDetailModal } from "./subtask-detail-modal";
import { CongratulationsModal, type CongratsData } from "./congrats-modal";
import { AchievementPanel } from "./achievement-panel";
import { request } from "@/lib/api/request";
import { encourageMessage, crossedMilestone, type Level } from "@/lib/growth";
import { MilestoneUnlockModal } from "./milestone-unlock-modal";

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
  // 键盘导航当前选中的单个子任务（Space/↑↓ 的作用目标）
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  // 待确认延迟的子任务（打开确认弹窗）
  const [postponeTarget, setPostponeTarget] = useState<SubtaskWithTask | null>(null);
  // 轻量 Toast 提示（失败提示 / 撤销等）
  const [toast, setToast] = useState<{ msg: string; actionLabel?: string; onAction?: () => void } | null>(null);
  // 方向B：里程碑解锁弹窗
  const [milestone, setMilestone] = useState<Level | null>(null);
  const prevTotalRef = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, actionLabel?: string, onAction?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, actionLabel, onAction });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

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

  // Refresh left list when analysis completes
  useEffect(() => {
    const done = entries.some((e) => e.stream.phase === "done");
    if (done && user) loadSubtasks();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.map((e) => e.stream.phase).join(",")]);

  const handleToggleSubtask = useCallback(async (taskId: string, subtaskId: string, current: boolean, silent = false) => {
    const next = !current;
    setSubtaskRows((prev) => prev.map((s) => s.id === subtaskId ? { ...s, completed: next } : s));
    setDetailSubtask((prev) => prev?.id === subtaskId ? { ...prev, completed: next } : prev);

    // 后端持久化：失败则回滚本地状态，避免"假完成"后刷新丢失
    try {
      await toggleSubtask(taskId, subtaskId, next);
    } catch {
      setSubtaskRows((prev) => prev.map((s) => s.id === subtaskId ? { ...s, completed: current } : s));
      setDetailSubtask((prev) => prev?.id === subtaskId ? { ...prev, completed: current } : prev);
      showToast(next ? "标记完成失败，已撤回，请重试" : "取消完成失败，已撤回，请重试");
      return;
    }

    // 仅在成功持久化后才计入 streak 与触发完成庆祝
    if (next) setStreakTick(t => t + 1);

    // 是否整个大任务已完成（决定走庆祝弹窗还是即时微激励）
    let allDone = false;
    setSubtaskRows((prev) => {
      const rows = prev.filter((s) => s.taskId === taskId);
      allDone = next && rows.length > 0 && rows.every((s) => (s.id === subtaskId ? next : s.completed));
      if (allDone) {
        updateTaskStatusApi(taskId, "done").catch(() => {});
        const taskTitle = rows[0]?.taskTitle ?? "";
        setCongrats({ taskId, taskTitle, subtasks: rows.map((s) => (s.id === subtaskId ? { ...s, completed: true } : s)) });
        return prev.map((s) => s.taskId === taskId ? { ...s, taskStatus: "done" } : s);
      }
      return prev;
    });

    // 方向D+B：即时微激励 & 里程碑解锁 —— 每完成一项就给反馈
    if (next && !silent && !allDone) {
      try {
        const res = await request("/api/user/stats");
        if (res.ok) {
          const s = await res.json() as { todayCount: number; totalCompleted: number };
          const after = s.totalCompleted;
          const before = after - 1;
          prevTotalRef.current = after;
          const crossed = crossedMilestone(before, after);
          if (crossed) {
            setMilestone(crossed);
          } else {
            showToast(encourageMessage(s.todayCount, after));
          }
        }
      } catch { /* 静默失败 */ }
    }
  }, [showToast]);

  // 确认延迟：startDay += 1，乐观更新本地 + 调后端重排；成功后给"已延迟 · 撤销"Toast
  const confirmPostpone = useCallback(async (row: SubtaskWithTask) => {
    setPostponeTarget(null);
    // 乐观更新：本地 startDay+1，卡片会随之重新分组到次日
    setSubtaskRows((prev) => prev.map((s) =>
      s.id === row.id ? { ...s, startDay: s.startDay + 1 } : s));
    const newStartDay = await postponeSubtask(row.taskId, row.id).catch(() => null);
    if (newStartDay === null) {
      // 失败回滚
      setSubtaskRows((prev) => prev.map((s) =>
        s.id === row.id ? { ...s, startDay: s.startDay - 1 } : s));
      showToast("延迟失败，请重试");
      return;
    }
    // 成功：提示去向（避免任务"悄悄挪走"找不到）+ 撤销入口
    showToast(`已延迟到明天，"${row.title}"移到次日`, "撤销", () => {
      setSubtaskRows((prev) => prev.map((s) =>
        s.id === row.id ? { ...s, startDay: Math.max(0, s.startDay - 1) } : s));
      unpostponeSubtask(row.taskId, row.id).catch(() => {
        setSubtaskRows((prev) => prev.map((s) =>
          s.id === row.id ? { ...s, startDay: s.startDay + 1 } : s));
        showToast("撤销失败，请重试");
      });
    });
  }, [showToast]);

  // 跳过：标记完成，并给"已跳过 · 撤销"Toast
  const handleSkip = useCallback(async (row: SubtaskWithTask) => {
    if (row.completed) return;
    await handleToggleSubtask(row.taskId, row.id, false, true);  // silent：不弹微激励，改弹"已跳过"
    showToast(`已跳过"${row.title}"`, "撤销", () => {
      handleToggleSubtask(row.taskId, row.id, true);
    });
  }, [handleToggleSubtask, showToast]);

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
  // 扁平化的可见顺序（供 ↑↓ 键盘导航）
  const flatRows = buildTimelineSections(filteredRows).flatMap(s => s.rows);
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
        } else if (activeSubtaskId) {
          setActiveSubtaskId(null);
        } else if (focusedId) {
          setFocusedId(null);
        }
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !showInput && !detailSubtask && !congrats) {
        // ↑↓ → 在可见卡片间移动"当前选中"
        if (flatRows.length === 0) return;
        e.preventDefault();
        const idx = flatRows.findIndex(r => r.id === activeSubtaskId);
        let next: number;
        if (idx === -1) {
          next = e.key === "ArrowDown" ? 0 : flatRows.length - 1;
        } else {
          next = e.key === "ArrowDown"
            ? Math.min(flatRows.length - 1, idx + 1)
            : Math.max(0, idx - 1);
        }
        const target = flatRows[next];
        if (target) {
          setActiveSubtaskId(target.id);
          setFocusedId(target.taskId);
          setTimeout(() => {
            document.getElementById(`subtask-card-${target.id}`)
              ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 0);
        }
      } else if (e.key === " ") {
        // Space → toggle 当前选中的子任务（无选中则退回到聚焦大任务的第一个未完成项）
        let target = activeSubtaskId ? subtaskRows.find(s => s.id === activeSubtaskId) : undefined;
        if (!target && focusedId) {
          target = subtaskRows.find(s => s.taskId === focusedId && !s.completed);
        }
        if (target) {
          e.preventDefault();
          handleToggleSubtask(target.taskId, target.id, target.completed);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showInput, detailSubtask, congrats, focusedId, activeSubtaskId, subtaskRows, handleToggleSubtask, setFocusedId]);

  return (
    <div style={{ background: T.bg, height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-geist), Geist, system-ui, sans-serif" }}>
      <header style={{ background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <div style={{ color: T.ink, fontWeight: 700, fontSize: 17, letterSpacing: "-0.04em" }}>拾级</div>
          <div style={{ color: T.muted, fontSize: 11, marginTop: 1 }}>把目标拆成每天能完成的小步骤</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

          {/* 方向A：累计成就面板（有任务时展示） */}
          {user && !fetching && subtaskRows.length > 0 && <AchievementPanel refreshTick={streakTick} />}

          <div className="canvas-scroll" style={{ flex: 1, overflowY: "auto" }}>
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
                          isActive={activeSubtaskId === row.id}
                          isHighlighted={highlightedSubtaskId === row.id}
                          onOpen={() => setDetailSubtask(row)}
                          onSelect={() => { setActiveSubtaskId(row.id); setFocusedId(row.taskId); focusTask(row.taskId); }}
                          onToggle={(e) => { e.stopPropagation(); handleToggleSubtask(row.taskId, row.id, row.completed); }}
                          onSkip={(e) => { e.stopPropagation(); handleSkip(row); }}
                          onPostpone={(e) => { e.stopPropagation(); setPostponeTarget(row); }}
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

      <footer className="kbd-footer" style={{ background: T.surface, borderTop: `1px solid ${T.line}`, padding: "7px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ color: T.muted, fontSize: 12 }}>今天：{todayStr}</span>
        <span style={{ color: T.muted, fontSize: 11, display: "flex", gap: 12 }}>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>N</kbd> 新建</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>↑↓</kbd> 选择</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>Space</kbd> 完成选中</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>Esc</kbd> 关闭</span>
        </span>
      </footer>

      {showInput && <NewTaskInput onClose={() => setShowInput(false)} onSubmit={(goal) => startAnalysis(goal)} />}
      {detailSubtask && <SubtaskDetailModal row={detailSubtask} onClose={() => setDetailSubtask(null)} onToggle={() => handleToggleSubtask(detailSubtask.taskId, detailSubtask.id, detailSubtask.completed)} onOpenTask={() => { router.push(`/task/${detailSubtask.taskId}`); setDetailSubtask(null); }} />}
      {congrats && <CongratulationsModal data={congrats} onClose={() => setCongrats(null)} onLearnMore={(taskId) => { setFocusedId(taskId); focusTask(taskId); setCongrats(null); }} />}

      {/* 方向B：里程碑等级解锁弹窗 */}
      {milestone && <MilestoneUnlockModal level={milestone} onClose={() => setMilestone(null)} />}

      {/* 延迟确认弹窗 */}
      {postponeTarget && (
        <>
          <div onClick={() => setPostponeTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(17,17,17,0.25)", zIndex: 300, backdropFilter: "blur(2px)" }} />
          <div style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: T.surface, border: `1px solid ${T.line}`, borderRadius: 16,
            padding: "22px 22px 18px", width: "min(360px, 90vw)", zIndex: 301,
            boxShadow: "0 20px 60px rgba(17,17,17,0.12)", display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 26 }}>⏭</span>
              <div>
                <div style={{ color: T.ink, fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>延迟一天</div>
                <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>排期将顺延，其它任务不受影响</div>
              </div>
            </div>
            <div style={{ background: T.soft, borderRadius: 10, padding: "10px 12px", color: T.ink, fontSize: 13, lineHeight: 1.5 }}>
              确定把"<span style={{ fontWeight: 600 }}>{postponeTarget.title}</span>"往后延迟一天吗？
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => confirmPostpone(postponeTarget)}
                style={{ flex: 1, background: T.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >确定延迟</button>
              <button
                onClick={() => setPostponeTarget(null)}
                style={{ background: T.soft, color: T.muted, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}
              >取消</button>
            </div>
          </div>
        </>
      )}

      {/* 轻量 Toast：失败提示 / 撤销 */}
      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 84, transform: "translateX(-50%)",
          zIndex: 400, background: "rgba(17,17,17,0.92)", color: "#fff",
          borderRadius: 12, padding: "11px 16px", fontSize: 13,
          display: "flex", alignItems: "center", gap: 14,
          boxShadow: "0 8px 30px rgba(17,17,17,0.25)", maxWidth: "min(440px, 92vw)",
        }}>
          <span style={{ lineHeight: 1.4 }}>{toast.msg}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              onClick={() => { toast.onAction?.(); setToast(null); }}
              style={{ background: "transparent", color: "#7FB0FF", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, flexShrink: 0, padding: 0 }}
            >{toast.actionLabel}</button>
          )}
        </div>
      )}
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



