"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getResolvedLocale } from "@/i18n";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEazo } from "@/lib/eazo-shim";
import {
  getSubtasksWithTask, getTasksWithSubtasks,
  toggleSubtask, updateTaskStatusApi, postponeSubtask, unpostponeSubtask,
} from "@/lib/api/tasks";
import type { SubtaskWithTask } from "@/lib/api/tasks";
import { AchievementPanel, LevelBadge } from "./achievement-panel";
import { RightPanel, useAnalysisPanel } from "./right-panel";
import { NewTaskInput } from "./new-task-input";
import { UserBadge } from "@/components/user-profile/user-badge";
import { getSubtaskActualDates } from "./subtask-row";
import { TimelineCard, TimelineSectionHeader } from "./timeline-card";
import { SubtaskDetailModal } from "./subtask-detail-modal";
import { CongratulationsModal, type CongratsData } from "./congrats-modal";
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

// 空状态入场动画：split & stagger（better-ui 原则5）
// 子项 opacity + y + blur，spring / bounce:0
const emptyItemVariants = {
  hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring" as const, duration: 0.3, bounce: 0 },
  },
};

// 列表加载骨架屏（M1）：灰色占位卡，保持布局稳定、减少感知延迟
function ListSkeleton() {
  return (
    <div aria-hidden style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="animate-pulse"
          style={{
            background: "#FFFFFF", border: "1px solid #E7E7E2", borderRadius: 12,
            padding: "12px 12px 13px", display: "flex", gap: 9, alignItems: "flex-start",
          }}
        >
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#EDEDEA", flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ width: `${70 - i * 8}%`, height: 11, borderRadius: 4, background: "#EDEDEA" }} />
            <div style={{ width: "42%", height: 9, borderRadius: 4, background: "#F1F2EE" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

type TimeFilter = "today" | "tomorrow" | "week" | "later" | "all";

// ─── 时间轴分组类型 ────────────────────────────────────────────────────
interface TimelineSection {
  key: TimeFilter;
  label: string;
  sublabel: string;
  accentColor: string;
  rows: SubtaskWithTask[];
}

// ─── Main Dashboard ───────────────────────────────────────────────────

export function HomePage() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const user = useEazo((s) => s.auth.user);
  const authLoading = useEazo((s) => s.auth.loading);

  const [subtaskRows, setSubtaskRows] = useState<SubtaskWithTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [detailSubtask, setDetailSubtask] = useState<SubtaskWithTask | null>(null);
  const [congrats, setCongrats] = useState<CongratsData | null>(null);
  const [highlightedSubtaskId, setHighlightedSubtaskId] = useState<string | null>(null);
  // 键盘导航当前选中的单个子任务（Space/↑↓ 的作用目标）
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(null);
  const [streakTick, setStreakTick] = useState(0);
  const prevUserIdRef = useRef<string | null>(user?.id ?? null);
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
    hydrateFromDB, focusTask, patchSubtaskCompleted,
  } = useAnalysisPanel();

  const loadSubtasks = useCallback(async () => {
    setFetching(true);
    setLoadError(false);
    try { setSubtaskRows(await getSubtasksWithTask()); }
    catch { setLoadError(true); }
    finally { setFetching(false); }
  }, []);

  useEffect(() => {
    const prevId = prevUserIdRef.current;
    const mode = !prevId && user ? "LOGIN"
      : prevId && !user ? "LOGOUT"
      : prevId && user ? "CHANGE"
      : "LOGOUT";

    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (mode === "LOGOUT") { setSubtaskRows([]); return; }
    loadSubtasks();
  }, [user, loadSubtasks]);

  useEffect(() => {
    prevUserIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // 仅在没有正在进行中的请求时，用后台静默刷新左侧列表，避免分析中整表闪烁。
  const refreshSubtasksIfIdle = useCallback(async () => {
    if (fetching) return;
    loadSubtasks();
  }, [fetching, loadSubtasks]);

  // Refresh left list when analysis completes
  useEffect(() => {
    const done = entries.some((e) => e.stream.phase === "done");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (done && user) refreshSubtasksIfIdle();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries.map((e) => e.stream.phase).join(","), user]);

  const prevHydratedUserRef = useRef<string | null>(null);

  // Hydrate right panel with historical tasks on login
  useEffect(() => {
    if (!user) return;
    if (prevHydratedUserRef.current === user.id) return;
    prevHydratedUserRef.current = user.id;
    getTasksWithSubtasks().then((tasks) => hydrateFromDB(tasks)).catch(() => {});
  }, [user?.id, hydrateFromDB]);

  const prevTaskIdRef = useRef<string | null>(null);

  // 分析完成且后台无正在进行的列表请求时，额外静默刷新一次，避免只靠局部乐观更新导致两侧数据不一致。
  useEffect(() => {
    const done = entries.some((e) => e.stream.phase === "done");
    const focused = entries.find((e) => e.taskId === focusedId);
    const doneId = done && focused ? focused.taskId : null;
    if (doneId && doneId !== prevTaskIdRef.current) {
      prevTaskIdRef.current = doneId;
      refreshSubtasksIfIdle();
    } else if (!doneId) {
      prevTaskIdRef.current = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
  }, [entries.map((e) => e.stream.phase).join(","), focusedId, user, entries, refreshSubtasksIfIdle]);

  const handleToggleSubtask = useCallback(async (taskId: string, subtaskId: string, current: boolean, silent = false) => {
    const next = !current;
    setSubtaskRows((prev) => prev.map((s) => s.id === subtaskId ? { ...s, completed: next } : s));
    setDetailSubtask((prev) => prev?.id === subtaskId ? { ...prev, completed: next } : prev);
    patchSubtaskCompleted(taskId, subtaskId, next);  // 同步右侧 AI 面板

    // 后端持久化：失败则回滚本地状态，避免“假完成”后刷新丢失
    try {
      await toggleSubtask(taskId, subtaskId, next);
    } catch {
      setSubtaskRows((prev) => prev.map((s) => s.id === subtaskId ? { ...s, completed: current } : s));
      setDetailSubtask((prev) => prev?.id === subtaskId ? { ...prev, completed: current } : prev);
      patchSubtaskCompleted(taskId, subtaskId, current);  // 回滚右侧 AI 面板
      showToast(next ? t("home.toast.markDoneFailed") : t("home.toast.markUndoneFailed"));
      return;
    }

    // 仅在成功持久化后才计入 streak 与触发完成庆祝
    if (next) setStreakTick(n => n + 1);

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

    // 方向D+B：即时微激励 & 里程碑解锁 —— 每完成一项就给反馈（整任务完成时交给庆祝弹窗，跳过操作不弹）
    if (next && !silent && !allDone) {
      try {
        const res = await request("/api/user/stats");
        if (res.ok) {
          const s = await res.json() as { todayCount: number; totalCompleted: number };
          const after = s.totalCompleted;
          const before = after - 1;  // 本次刚完成 1 个
          prevTotalRef.current = after;
          const crossed = crossedMilestone(before, after);
          if (crossed) {
            // 跨过里程碑：弹解锁弹窗（比普通 Toast 更隆重）
            setMilestone(crossed);
          } else {
            showToast(encourageMessage(s.todayCount, after));
          }
        }
      } catch { /* 静默失败，不打扰用户 */ }
    }
  }, [showToast, patchSubtaskCompleted, t]);

  // 确认延迟：startDay += 1，乐观更新本地 + 调后端重排；成功后给「已延迟 · 撤销」Toast
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
      showToast(t("home.toast.postponeFailed"));
      return;
    }
    // 成功：提示去向（避免任务“悄悄挪走”找不到）+ 撤销入口
    showToast(t("home.toast.postponed", { title: row.title }), t("home.toast.undo"), () => {
      setSubtaskRows((prev) => prev.map((s) =>
        s.id === row.id ? { ...s, startDay: Math.max(0, s.startDay - 1) } : s));
      unpostponeSubtask(row.taskId, row.id).catch(() => {
        // 撤销失败则回滚回延后态
        setSubtaskRows((prev) => prev.map((s) =>
          s.id === row.id ? { ...s, startDay: s.startDay + 1 } : s));
        showToast(t("home.toast.undoFailed"));
      });
    });
  }, [showToast, t]);

  // 跳过：标记完成，并给「已跳过 · 撤销」Toast
  const handleSkip = useCallback(async (row: SubtaskWithTask) => {
    if (row.completed) return;
    await handleToggleSubtask(row.taskId, row.id, false, true);  // silent：不弹微激励，改弹「已跳过」
    showToast(t("home.toast.skipped", { title: row.title }), t("home.toast.undo"), () => {
      handleToggleSubtask(row.taskId, row.id, true);
    });
  }, [handleToggleSubtask, showToast, t]);

  const handleJumpToSubtask = useCallback((
    subtaskId: string, _taskStartDate: string | null, _startDay: number, _durationDays: number,
  ) => {
    // 时间轴视图：只需高亮对应卡片，页面已经按日期分组展示
    setHighlightedSubtaskId(subtaskId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightedSubtaskId(null), 3000);
    // 尝试滚动到高亮卡片
    setTimeout(() => {
      const el = document.getElementById(`subtask-card-${subtaskId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, []);

  // 时间轴分组
  const sections = buildTimelineSections(subtaskRows, t, i18n.language);
  // 扁平化的可见顺序（供 ↑↓ 键盘导航）
  const flatRows = sections.flatMap(s => s.rows);
  const totalPending = subtaskRows.filter(r => !r.completed).length;
  // 日期在客户端 effect 里格式化，避免 SSR/CSR 时区不一致导致 hydration mismatch
  const [todayStr, setTodayStr] = useState("");
  useEffect(() => {
    // 客户端挂载后格式化日期，避免 hydration mismatch —— 官方推荐模式，仅执行一次
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTodayStr(new Date().toLocaleDateString(getResolvedLocale(), { year: "numeric", month: "long", day: "numeric" }));
  }, []);

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
        // ↑↓ → 在可见卡片间移动「当前选中」
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
  }, [showInput, detailSubtask, congrats, focusedId, activeSubtaskId, flatRows, subtaskRows, handleToggleSubtask, setFocusedId]);

  return (
    <div style={{ background: T.bg, height: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-geist), Geist, system-ui, sans-serif" }}>
      <header style={{ background: T.surface, borderBottom: `1px solid ${T.line}`, padding: "0 24px", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div>
            <div style={{ color: T.ink, fontWeight: 700, fontSize: 17, letterSpacing: "-0.04em" }}>{t("home.brand")}</div>
            <div style={{ color: T.muted, fontSize: 11, marginTop: 1 }}>{t("home.tagline")}</div>
          </div>
          {/* 等级徽章：紧跟副标题右侧、隔一段距离，靠左排布（登录且有任务时展示）*/}
          {user && subtaskRows.length > 0 && <LevelBadge refreshTick={streakTick} />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <UserBadge />
          <button onClick={() => setShowInput(true)}
            style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 10, padding: "8px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16, lineHeight: 1, fontWeight: 400 }}>+</span> {t("home.newTask")}
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* ── 左侧：时间轴视图 ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: `1px solid ${T.line}`, overflow: "hidden" }}>
          {/* 学习日历面板：标题 + 等级 + 数据全部收进同一个框（有任务时展示） */}
          {user && !fetching && subtaskRows.length > 0 && <AchievementPanel refreshTick={streakTick} pending={totalPending} title={t("home.calendar")} />}

          {/* 内容区 */}
          <div className="canvas-scroll" style={{ flex: 1, overflowY: "auto", padding: "16px 14px" }}>
            {authLoading || fetching ? (
              <ListSkeleton />
            ) : loadError ? (
              <div style={{ padding: "60px 16px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                <div style={{ fontSize: 40, lineHeight: 1 }}>⚠️</div>
                <div>
                  <div style={{ color: T.ink, fontWeight: 700, fontSize: 15, marginBottom: 4, letterSpacing: "-0.02em" }}>{t("home.loadError.title")}</div>
                  <div style={{ color: T.muted, fontSize: 13 }}>{t("home.loadError.desc")}</div>
                </div>
                <button
                  onClick={() => loadSubtasks()}
                  style={{ background: T.accent, color: "#fff", border: "none", borderRadius: 8, padding: "8px 22px", fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "background-color 0.15s ease-out, scale 0.12s ease-out" }}
                  onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.scale = "0.96"; }}
                  onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.scale = "1"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.scale = "1"; }}
                >
                  {t("home.loadError.retry")}
                </button>
              </div>
            ) : sections.every(s => s.rows.length === 0) ? (
              <motion.div
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
                style={{ padding: "48px 16px 40px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}
              >
                {/* 图示 */}
                <motion.div variants={emptyItemVariants} style={{ fontSize: 52, lineHeight: 1 }}>📚</motion.div>
                <motion.div variants={emptyItemVariants}>
                  <div style={{ color: T.ink, fontWeight: 700, fontSize: 16, marginBottom: 6, letterSpacing: "-0.03em" }}>{t("home.empty.title")}</div>
                  <div style={{ color: T.muted, fontSize: 13 }}>{t("home.empty.desc")}</div>
                </motion.div>
                {/* 示例按钮 */}
                <motion.div variants={emptyItemVariants} style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 260 }}>
                  {[
                    { icon: "🐍", label: t("home.samples.python.label"), value: t("home.samples.python.value") },
                    { icon: "⚛️", label: t("home.samples.react.label"),  value: t("home.samples.react.value") },
                    { icon: "📐", label: t("home.samples.math.label"),   value: t("home.samples.math.value") },
                  ].map((ex) => (
                    <button
                      key={ex.label}
                      onClick={() => startAnalysis(ex.value)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        background: T.surface, border: `1.5px solid ${T.line}`,
                        borderRadius: 10, padding: "10px 14px",
                        fontSize: 13, color: T.ink, fontWeight: 500,
                        cursor: "pointer", textAlign: "left",
                        transition: "border-color 0.15s ease-out, background-color 0.15s ease-out, scale 0.12s ease-out",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = T.accent;
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,122,255,0.04)";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = T.line;
                        (e.currentTarget as HTMLButtonElement).style.background = T.surface;
                        (e.currentTarget as HTMLButtonElement).style.scale = "1";
                      }}
                      onMouseDown={e => { (e.currentTarget as HTMLButtonElement).style.scale = "0.97"; }}
                      onMouseUp={e => { (e.currentTarget as HTMLButtonElement).style.scale = "1"; }}
                    >
                      <span style={{ fontSize: 18 }}>{ex.icon}</span>
                      <span style={{ flex: 1 }}>{ex.label}</span>
                      <span style={{ color: T.muted, fontSize: 12 }}>→</span>
                    </button>
                  ))}
                  <button
                    onClick={() => setShowInput(true)}
                    style={{ border: `1px dashed ${T.line}`, borderRadius: 10, padding: "9px 14px", fontSize: 13, color: T.muted, cursor: "pointer", background: "transparent" }}
                  >
                    {t("home.empty.custom")}
                  </button>
                </motion.div>
              </motion.div>
            ) : (
              sections.filter(s => s.rows.length > 0).map((section) => (
                <div key={section.key} style={{ marginBottom: 28 }}>
                  <TimelineSectionHeader
                    label={section.label}
                    sublabel={section.sublabel}
                    accentColor={section.accentColor}
                    pendingCount={section.rows.filter(r => !r.completed).length}
                  />
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
        <span style={{ color: T.muted, fontSize: 12 }}>{t("home.footer.today", { date: todayStr })}</span>
        <span style={{ color: T.muted, fontSize: 11, display: "flex", gap: 12 }}>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>N</kbd> {t("home.footer.kbdNew")}</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>↑↓</kbd> {t("home.footer.kbdSelect")}</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>Space</kbd> {t("home.footer.kbdComplete")}</span>
          <span><kbd style={{ background: T.soft, border: `1px solid ${T.line}`, borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 10 }}>Esc</kbd> {t("home.footer.kbdClose")}</span>
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
          <div aria-hidden onClick={() => setPostponeTarget(null)} style={{ position: "fixed", inset: 0, background: "rgba(17,17,17,0.25)", zIndex: 300, backdropFilter: "blur(2px)" }} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t("home.postpone.ariaLabel")}
            onKeyDown={(e) => { if (e.key === "Escape") setPostponeTarget(null); }}
            style={{
            position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
            background: T.surface, border: `1px solid ${T.line}`, borderRadius: 16,
            padding: "22px 22px 18px", width: "min(360px, 90vw)", zIndex: 301,
            boxShadow: "0 20px 60px rgba(17,17,17,0.12)", display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 26 }}>⏭</span>
              <div>
                <div style={{ color: T.ink, fontWeight: 700, fontSize: 15, letterSpacing: "-0.02em" }}>{t("home.postpone.title")}</div>
                <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>{t("home.postpone.desc")}</div>
              </div>
            </div>
            <div style={{ background: T.soft, borderRadius: 10, padding: "10px 12px", color: T.ink, fontSize: 13, lineHeight: 1.5 }}>
              {t("home.postpone.confirmText", { title: postponeTarget.title })}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => confirmPostpone(postponeTarget)}
                style={{ flex: 1, background: T.accent, color: "#fff", border: "none", borderRadius: 10, padding: "10px 0", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >{t("home.postpone.confirm")}</button>
              <button
                onClick={() => setPostponeTarget(null)}
                style={{ background: T.soft, color: T.muted, border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 16px", fontSize: 13, cursor: "pointer" }}
              >{t("home.postpone.cancel")}</button>
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
          animation: "logReveal 0.25s ease both",
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
/**
 * 将所有子任务按时间段分为 4 组：
 *   今天 / 明天 / 本周（后 7 天）/ 更早 or 更晚
 * 每组内：未完成在前（按 sortOrder），已完成在后
 */
function buildTimelineSections(
  rows: SubtaskWithTask[],
  t: (key: string, opts?: Record<string, unknown>) => string,
  locale: string,
): TimelineSection[] {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const weekEnd  = new Date(today.getTime() + 7 * 86400000);

  const fmtDate = (d: Date) => d.toLocaleDateString(locale, { month: "long", day: "numeric", weekday: "short" });
  const fmtRange = (s: Date, e: Date) =>
    `${s.toLocaleDateString(locale, { month: "numeric", day: "numeric" })} — ${e.toLocaleDateString(locale, { month: "numeric", day: "numeric" })}`;

  const buckets: Record<string, SubtaskWithTask[]> = {
    today: [], tomorrow: [], week: [], later: [],
  };

  for (const r of rows) {
    const dates = getSubtaskActualDates(r);
    if (!dates) {
      // 没有排期 → 放到今天
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
    {
      key: "today",
      label: t("home.timeline.today"),
      sublabel: fmtDate(today),
      accentColor: "#3B7AFF",
      rows: sort(buckets.today),
    },
    {
      key: "tomorrow",
      label: t("home.timeline.tomorrow"),
      sublabel: fmtDate(tomorrow),
      accentColor: "#E07B2A",
      rows: sort(buckets.tomorrow),
    },
    {
      key: "week",
      label: t("home.timeline.week"),
      sublabel: fmtRange(new Date(today.getTime() + 2 * 86400000), weekEnd),
      accentColor: "#2F5D50",
      rows: sort(buckets.week),
    },
    {
      key: "later",
      label: t("home.timeline.later"),
      sublabel: (() => {
        const laterRows = sort(buckets.later);
        if (laterRows.length === 0) return t("home.timeline.afterSevenDays");
        // 从所有 later 行里找最早和最晚的实际日期
        let minDate: Date | null = null;
        let maxDate: Date | null = null;
        for (const r of laterRows) {
          const d = getSubtaskActualDates(r);
          if (!d) continue;
          if (!minDate || d.start < minDate) minDate = d.start;
          if (!maxDate || d.end > maxDate) maxDate = d.end;
        }
        if (!minDate || !maxDate) return t("home.timeline.afterSevenDays");
        const diffDays = Math.round((minDate.getTime() - today.getTime()) / 86400000);
        const dayHint = diffDays > 0 ? t("home.timeline.startsInDays", { days: diffDays }) : "";
        return `${fmtRange(minDate, maxDate)}${dayHint}`;
      })(),
      accentColor: "#94a3b8",
      rows: sort(buckets.later),
    },
  ];
}


