"use client";
/**
 * timeline-card.tsx
 * 方向 B：时间轴视图的卡片组件
 *
 * 视觉结构（每张卡片）：
 *   ┌─────────────────────────────────────┐
 *   │▓▓▓▓▓▓░░░░░░░░  ← 顶部时长色条       │
 *   │ ○  子任务标题                  2.5h │
 *   │    大任务名 · [hover才展开徽章]      │
 *   └─────────────────────────────────────┘
 *
 * 徽章行（Bloom、日期）默认收起，hover 才渐显
 */

import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { SubtaskWithTask } from "@/lib/api/tasks";
export { getSubtaskDateRange, getSubtaskActualDates } from "./subtask-row";

// ─── 设计 token ──────────────────────────────────────────────────────────────
export const T = {
  bg: "#F9F9F8", surface: "#FFFFFF", soft: "#F1F2EE", line: "#E7E7E2",
  ink: "#111111", muted: "#777B75", accent: "#3B7AFF",
  green: "#2F5D50", orange: "#E07B2A", purple: "#7C4DFF",
  yellow: "#F59E0B", highlight: "#FFF9E6",
} as const;

// ─── Bloom 配置 ──────────────────────────────────────────────────────────────
export const BLOOM_COLORS: Record<number, string> = {
  1: "#94a3b8", 2: "#60a5fa", 3: "#34d399",
  4: "#f97316", 5: "#a78bfa", 6: "#f43f5e",
};

// ─── 大任务主题色（按 topic 字段分配，保持跨卡片一致）──────────────────────
const TOPIC_COLORS: Record<string, string> = {
  "编程":  "#3B7AFF", "数学":  "#7C4DFF", "语言":  "#E07B2A",
  "科学":  "#10b981", "艺术":  "#f43f5e", "商业":  "#f59e0b",
  "历史":  "#8b5cf6", "健身":  "#22c55e", "其他":  "#64748b",
};
// 给同一个 taskId 固定分配一个颜色（基于 taskId hash）
const PALETTE = ["#3B7AFF","#7C4DFF","#E07B2A","#10b981","#f43f5e","#f59e0b","#8b5cf6","#0ea5e9"];
export function getTaskColor(taskId: string, topic?: string | null): string {
  if (topic && TOPIC_COLORS[topic]) return TOPIC_COLORS[topic];
  let h = 0;
  for (let i = 0; i < taskId.length; i++) h = (h * 31 + taskId.charCodeAt(i)) & 0xffffffff;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

// ─── 时间段标题组件 ──────────────────────────────────────────────────────────
interface SectionHeaderProps {
  label: string;
  sublabel: string;
  accentColor: string;
  pendingCount: number;
}
export function TimelineSectionHeader({ label, sublabel, accentColor, pendingCount }: SectionHeaderProps) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      {/* 左侧彩色竖条 */}
      <div style={{ width: 3, height: 30, borderRadius: 2, background: accentColor, flexShrink: 0 }} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 15, color: T.ink, letterSpacing: "-0.03em", lineHeight: 1.2 }}>{label}</div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 1 }}>{sublabel}</div>
      </div>
      <div style={{ flex: 1 }} />
      {pendingCount > 0 && (
        <div style={{ fontSize: 11, color: T.muted }}>
          {t("timelineCard.pendingCount", { count: pendingCount })}
        </div>
      )}
    </div>
  );
}

// ─── 单张任务卡片 ────────────────────────────────────────────────────────────
interface CardProps {
  row: SubtaskWithTask;
  isSelected: boolean;
  isHighlighted: boolean;
  /** 键盘导航当前选中的单个子任务：Space 将作用于它 */
  isActive?: boolean;
  onOpen: () => void;
  onSelect: () => void;
  onToggle: (e: React.MouseEvent) => void;
  /** 跳过：将单个子任务标记为已完成/略过（无需真正执行） */
  onSkip: (e: React.MouseEvent) => void;
  /** 延迟一天：弹窗确认后触发重排 */
  onPostpone: (e: React.MouseEvent) => void;
}

export function TimelineCard({
  row, isSelected, isHighlighted, isActive = false,
  onOpen, onSelect, onToggle, onSkip, onPostpone,
}: CardProps) {
  const { t } = useTranslation();
  const BLOOM_LABELS = t("timelineCard.bloom", { returnObjects: true }) as Record<number, string>;
  const taskColor = getTaskColor(row.taskId, row.topic);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const prevCompleted = useRef(row.completed);

  useEffect(() => {
    // 只在 false → true 时触发弹跳动画
    if (!prevCompleted.current && row.completed) {
      setAnimKey(k => k + 1);
    }
    prevCompleted.current = row.completed;
  }, [row.completed]);

  // bloom_level 和 deepWorkHours 不在 DB schema 里，用可用字段估算
  // urgency 1=极紧急(高bloom)→5=不紧急(低bloom)，倒转映射 bloom 1-5
  const bloomRaw = row.urgency ? Math.max(1, Math.min(5, 6 - row.urgency)) : 2;
  const bloomColor = BLOOM_COLORS[bloomRaw] ?? BLOOM_COLORS[2];
  const bloomLabel = BLOOM_LABELS[bloomRaw] ?? BLOOM_LABELS[2];

  // 预估深度学习时长：durationDays * 1.5h/天，上限 4.5h
  const deepHours = Math.min(4.5, Math.max(1.5, row.durationDays * 1.5));
  // 色条宽度：以 4.5h 为上限
  const barPct = Math.min(100, Math.round((deepHours / 4.5) * 100));

  // 日期文字
  const dateRange = getDateLabel(row) ?? (row.taskStartDate ? null : t("timelineCard.days", { count: row.durationDays }));

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t("timelineCard.viewDetail", { title: row.title, done: row.completed ? t("timelineCard.completedMark") : "" })}
      onClick={() => { onOpen(); onSelect(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); onSelect(); }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        background: isHighlighted ? T.highlight : row.completed ? "#FAFAF9" : T.surface,
        // 用非简写的分边属性，避免与 borderLeft 混用（React 会警告简写/非简写冲突）
        borderStyle: "solid",
        borderColor: isHighlighted ? "#F59E0B" : isActive ? taskColor : isSelected ? taskColor : T.line,
        borderTopWidth: 1,
        borderRightWidth: 1,
        borderBottomWidth: 1,
        borderLeftWidth: isActive ? 4 : 1,
        borderRadius: 12,
        overflow: "hidden",
        opacity: row.completed ? 0.62 : 1,
        boxShadow: isActive
          ? `0 0 0 3px ${taskColor}33, 0 4px 14px ${taskColor}22`
          : isSelected ? `0 0 0 2px ${taskColor}30` : "0 1px 4px rgba(17,17,17,0.04)",
        cursor: "pointer",
        scale: pressed ? "0.99" : "1",
        transition:
          "background-color 0.18s ease-out, border-color 0.18s ease-out, box-shadow 0.18s ease-out, opacity 0.18s ease-out, scale 0.12s ease-out",
      }}
    >
      {/* ── 键盘选中提示条 ── */}
      {isActive && !row.completed && (
        <div style={{
          display: "flex", alignItems: "center", gap: 5,
          background: `${taskColor}10`,
          borderBottom: `1px solid ${taskColor}20`,
          padding: "3px 12px", fontSize: 10, color: taskColor, fontWeight: 600,
        }}>
          <kbd style={{ background: "#fff", border: `1px solid ${taskColor}40`, borderRadius: 4, padding: "0 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 9, color: taskColor }}>Space</kbd>
          <span>{t("timelineCard.completeThis")}</span>
          <kbd style={{ background: "#fff", border: `1px solid ${taskColor}40`, borderRadius: 4, padding: "0 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 9, color: taskColor }}>↑↓</kbd>
          <span>{t("timelineCard.toggle")}</span>
        </div>
      )}
      {/* ── 顶部时长色条 ── */}
      <div style={{ height: 3, background: T.soft }}>
        <div style={{
          height: 3, width: `${barPct}%`,
          background: taskColor,
          borderRadius: "0 2px 0 0",
          transition: "width 0.3s",
        }} />
      </div>

      {/* ── 卡片主体 ── */}
      <div style={{ padding: "10px 12px 11px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>

          {/* 完成圆圈：卡片唯一的完成控件（点击标记完成/取消） */}
          <button
            key={`circle-${animKey}`}
            onClick={(e) => { e.stopPropagation(); onToggle(e); }}
            aria-label={row.completed ? t("timelineCard.markUndone") : t("timelineCard.markDone")}
            aria-pressed={row.completed}
            title={row.completed ? t("timelineCard.markUndone") : t("timelineCard.markDone")}
            className={row.completed && animKey > 0 ? "check-bounce" : ""}
            style={{
              width: 22, height: 22, borderRadius: "50%", flexShrink: 0, marginTop: 1,
              // 透明 padding 扩大触控热区到 ~40px，负 margin 抵消布局位移（M2）
              padding: 9, margin: "-8px 0 -9px -9px", boxSizing: "content-box" as const,
              backgroundClip: "content-box",
              border: `2px solid ${row.completed ? taskColor : hovered ? taskColor : T.line}`,
              background: row.completed ? taskColor : hovered ? `${taskColor}12` : "transparent",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition:
                "background-color 0.18s ease-out, border-color 0.18s ease-out, scale 0.12s ease-out",
            }}
          >
            {row.completed
              ? <span style={{ color: "#fff", fontSize: 11, lineHeight: 1, fontWeight: 700 }}>✓</span>
              : hovered ? <span style={{ color: taskColor, fontSize: 11, lineHeight: 1, fontWeight: 700 }}>✓</span> : null}
          </button>

          {/* 内容区 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 标题 */}
            <div style={{
              fontSize: 13, fontWeight: 500, color: row.completed ? T.muted : T.ink,
              textDecoration: row.completed ? "line-through" : "none",
              letterSpacing: "-0.02em", marginBottom: 4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {row.title}
            </div>

            {/* 元信息行：大任务名 · Bloom（hover 展开） */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: taskColor,
                background: `${taskColor}12`,
                border: `1px solid ${taskColor}25`,
                borderRadius: 5, padding: "1px 7px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 120,
              }}>
                {row.taskTitle}
              </span>
              {/* 徽章行：默认隐藏，hover 渐显 */}
              <span style={{
                fontSize: 10, fontWeight: 600,
                color: bloomColor,
                background: `${bloomColor}15`,
                border: `1px solid ${bloomColor}30`,
                borderRadius: 5, padding: "1px 7px",
                opacity: hovered ? 1 : 0,
                maxWidth: hovered ? 120 : 0,
                overflow: "hidden",
                transition: "opacity 0.2s, max-width 0.2s",
                whiteSpace: "nowrap",
              }}>
                L{bloomRaw} · {bloomLabel}
              </span>
              {dateRange && (
                <span style={{
                  fontSize: 10, color: T.muted, fontFamily: "var(--font-geist-mono), monospace",
                  opacity: hovered ? 1 : 0,
                  maxWidth: hovered ? 80 : 0,
                  overflow: "hidden",
                  transition: "opacity 0.2s, max-width 0.2s",
                  whiteSpace: "nowrap",
                }}>
                  {dateRange}
                </span>
              )}
            </div>
          </div>

          {/* 右侧：时长 + 操作 */}
          {/* 右侧：时长 + 次要操作（延迟/跳过）。完成统一交给左上角圆圈，避免重复控件把卡片撑高 */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: taskColor, letterSpacing: "-0.02em", lineHeight: 1 }}>
                {deepHours}h
              </div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{t("timelineCard.days", { count: row.durationDays })}</div>
            </div>
            {/* 延迟 / 跳过：默认收起，hover 卡片时才横向浮现，保持卡片清爽 */}
            {!row.completed && (
              <div style={{
                display: "flex", alignItems: "center", gap: 2,
                opacity: hovered ? 1 : 0,
                maxWidth: hovered ? 64 : 0,
                overflow: "hidden",
                transition: "opacity 0.18s, max-width 0.18s",
              }}>
                <button
                  onClick={(e) => { e.stopPropagation(); onPostpone(e); }}
                  aria-label={t("timelineCard.postponeAria")}
                  title={t("timelineCard.postponeTitle")}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: "none",
                    background: "transparent", color: T.muted, fontSize: 13,
                    cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background-color 0.15s ease-out, color 0.15s ease-out",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${T.orange}14`; (e.currentTarget as HTMLButtonElement).style.color = T.orange; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = T.muted; }}
                ><span aria-hidden>⏭</span></button>
                <button
                  onClick={(e) => { e.stopPropagation(); onSkip(e); }}
                  aria-label={t("timelineCard.skipAria")}
                  title={t("timelineCard.skipTitle")}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: "none",
                    background: "transparent", color: T.muted, fontSize: 14,
                    cursor: "pointer", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background-color 0.15s ease-out, color 0.15s ease-out",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = `${taskColor}12`; (e.currentTarget as HTMLButtonElement).style.color = taskColor; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = T.muted; }}
                ><span aria-hidden>⤼</span></button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 日期标签辅助 ────────────────────────────────────────────────────────────
function getDateLabel(row: SubtaskWithTask): string | null {
  if (!row.taskStartDate) return null;
  const base = new Date(row.taskStartDate);
  if (isNaN(base.getTime())) return null;
  const s = new Date(base); s.setDate(base.getDate() + row.startDay);
  const e = new Date(base); e.setDate(base.getDate() + row.startDay + row.durationDays - 1);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return s.getTime() === e.getTime() ? fmt(s) : `${fmt(s)}–${fmt(e)}`;
}
