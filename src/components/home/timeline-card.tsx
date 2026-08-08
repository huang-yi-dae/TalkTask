"use client";
/**
 * timeline-card.tsx
 * 方向 B：时间轴视图的卡片组件
 *
 * 视觉结构（每张卡片）：
 *   ┌─────────────────────────────────────┐
 *   │▓▓▓▓▓▓░░░░░░░░  ← 顶部时长色条       │
 *   │ ○  子任务标题                  2.5h │
 *   │    大任务名 · Bloom L3·应用   2天   │
 *   │    [主题] [⚡极紧急]               │
 *   └─────────────────────────────────────┘
 *
 * 顶部色条宽度 = deepWorkHours / 4.5（最大1 BRAC块组=4.5h）→ 百分比
 * 颜色来自大任务的 topicColor（按 topic 派发）
 */

import { useState, useEffect, useRef } from "react";
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
const BLOOM_LABELS: Record<number, string> = {
  1: "记忆", 2: "理解", 3: "应用", 4: "分析", 5: "评估", 6: "创造",
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
          {pendingCount} 项待完成
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
  /** 跳过：将单个子任务标记为已完成/略过（无需真正执行）。可选——home-page 传入后显示跳过按钮 */
  onSkip?: (e: React.MouseEvent) => void;
  /** @deprecated 删除大任务功能已移除，保留仅向后兼容；PR-E 后将彻底删除 */
  onDeleteTask?: (taskId: string, e: React.MouseEvent) => void;
  /** 延迟一天：弹窗确认后触发重排 */
  onPostpone?: (e: React.MouseEvent) => void;
}

export function TimelineCard({
  row, isSelected, isHighlighted, isActive = false,
  onOpen, onSelect, onToggle, onSkip, onPostpone,
}: CardProps) {
  const taskColor = getTaskColor(row.taskId, row.topic);
  const [hovered, setHovered] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const prevCompleted = useRef(row.completed);

  useEffect(() => {
    // 只在 false → true 时触发弹跳动画
    if (!prevCompleted.current && row.completed) {
      setAnimKey(k => k + 1);
    }
    prevCompleted.current = row.completed;
  }, [row.completed]);

  // 直接读 DB 字段；旧数据没有时用 urgency 反推降级
  const bloomRaw = row.bloomLevel
    ? Math.max(1, Math.min(6, row.bloomLevel))
    : (row.urgency ? Math.max(1, Math.min(5, 6 - row.urgency)) : 2);
  const bloomColor = BLOOM_COLORS[bloomRaw] ?? BLOOM_COLORS[2];
  const bloomLabel = BLOOM_LABELS[bloomRaw] ?? "理解";

  // 直接读 DB 字段；旧数据没有时按 durationDays 估算
  const deepHours = row.deepWorkHours
    ? Math.min(4.5, Math.max(1.5, row.deepWorkHours))
    : Math.min(4.5, Math.max(1.5, row.durationDays * 1.5));
  // 色条宽度：以 4.5h 为上限
  const barPct = Math.min(100, Math.round((deepHours / 4.5) * 100));

  // 日期文字
  const dateRange = getDateLabel(row);

  return (
    <div
      onClick={() => { onOpen(); onSelect(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: isHighlighted ? T.highlight : row.completed ? "#FAFAF9" : T.surface,
        border: `1px solid ${isHighlighted ? "#F59E0B" : isActive ? taskColor : isSelected ? taskColor : T.line}`,
        borderLeft: isActive ? `4px solid ${taskColor}` : undefined,
        borderRadius: 12,
        overflow: "hidden",
        opacity: row.completed ? 0.62 : 1,
        boxShadow: isActive
          ? `0 0 0 3px ${taskColor}33, 0 4px 14px ${taskColor}22`
          : isSelected ? `0 0 0 2px ${taskColor}30` : "0 1px 4px rgba(17,17,17,0.04)",
        cursor: "pointer",
        transition: "all 0.18s",
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
          <span>完成此项 · </span>
          <kbd style={{ background: "#fff", border: `1px solid ${taskColor}40`, borderRadius: 4, padding: "0 5px", fontFamily: "var(--font-geist-mono), monospace", fontSize: 9, color: taskColor }}>↑↓</kbd>
          <span>切换</span>
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

          {/* 完成圆圈 */}
          <button
            key={`circle-${animKey}`}
            onClick={(e) => { e.stopPropagation(); onToggle(e); }}
            title={row.completed ? "取消完成" : "标记已完成"}
            className={row.completed && animKey > 0 ? "check-bounce" : ""}
            style={{
              width: 19, height: 19, borderRadius: "50%", flexShrink: 0, marginTop: 2,
              border: `2px solid ${row.completed ? taskColor : T.line}`,
              background: row.completed ? taskColor : "transparent",
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.18s",
            }}
          >
            {row.completed && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
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

            {/* 元信息行：大任务名 · Bloom */}
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
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: taskColor, letterSpacing: "-0.02em", lineHeight: 1 }}>
                {deepHours}h
              </div>
              <div style={{ fontSize: 9, color: T.muted, marginTop: 1 }}>{row.durationDays}天</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
              {/* 完成对号：明显的主操作按钮，点击标记完成/取消完成 */}
              <button
                onClick={(e) => { e.stopPropagation(); onToggle(e); }}
                title={row.completed ? "取消完成" : "标记为已完成"}
                style={{
                  width: 26, height: 26, borderRadius: "50%",
                  border: `1.5px solid ${row.completed ? T.green : taskColor}`,
                  background: row.completed ? T.green : `${taskColor}12`,
                  color: row.completed ? "#fff" : taskColor,
                  cursor: "pointer", fontSize: 14, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s",
                }}
              >✓</button>
              {/* 延迟一天：仅未完成时显示 */}
              {!row.completed && onPostpone && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPostpone(e); }}
                  title="延迟一天（顺延排期）"
                  style={{
                    width: 26, height: 26, borderRadius: "50%",
                    border: `1.5px solid ${T.line}`,
                    background: "transparent", color: T.muted, fontSize: 13,
                    cursor: "pointer", opacity: hovered ? 1 : 0.55,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = T.orange; (e.currentTarget as HTMLButtonElement).style.color = T.orange; (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = T.line; (e.currentTarget as HTMLButtonElement).style.color = T.muted; (e.currentTarget as HTMLButtonElement).style.opacity = hovered ? "1" : "0.55"; }}
                >⏭</button>
              )}
              {/* 跳过：仅未完成时显示，标记单个子任务为已完成/略过 */}
              {!row.completed && onSkip && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSkip!(e); }}
                  title="跳过此任务（标记为已完成，无需执行）"
                  style={{
                    width: 22, height: 22, borderRadius: 5, border: "none",
                    background: "transparent", color: T.muted, fontSize: 14,
                    cursor: "pointer", opacity: hovered ? 0.75 : 0.35,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = taskColor; (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = T.muted; (e.currentTarget as HTMLButtonElement).style.opacity = hovered ? "0.75" : "0.35"; }}
                >⤼</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 日期标签辅助 ────────────────────────────────────────────────────────────
function getDateLabel(row: SubtaskWithTask): string | null {
  if (!row.taskStartDate) return `${row.durationDays}天`;
  const base = new Date(row.taskStartDate);
  if (isNaN(base.getTime())) return null;
  const s = new Date(base); s.setDate(base.getDate() + row.startDay);
  const e = new Date(base); e.setDate(base.getDate() + row.startDay + row.durationDays - 1);
  const fmt = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
  return s.getTime() === e.getTime() ? fmt(s) : `${fmt(s)}–${fmt(e)}`;
}
