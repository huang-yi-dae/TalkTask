"use client";
/**
 * streak-bar.tsx — 学习连续性统计条
 * 展示：🔥连续天数 | 今日进度 | 本周完成率 | 累计完成数
 */

import { useState, useEffect } from "react";
import { request } from "@/lib/api/request";

const T = {
  surface: "#FFFFFF", soft: "#F1F2EE", line: "#E7E7E2",
  ink: "#111111", muted: "#777B75", accent: "#3B7AFF",
  green: "#2F5D50", orange: "#E07B2A",
} as const;

interface Stats {
  streak: number;
  todayCompleted: number;
  weeklyCompleted: number;
  weeklyTotal: number;
  totalCompleted: number;
  activeTasks: number;
}

interface Props {
  /** 外部触发刷新（子任务完成后） */
  refreshTrigger?: number;
}

export function StreakBar({ refreshTrigger = 0 }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    request("/api/user/stats")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setStats(d as Stats))
      .catch(() => {});
  }, [refreshTrigger]);

  if (!stats) return null;

  const weekPct = stats.weeklyTotal > 0
    ? Math.round((stats.weeklyCompleted / stats.weeklyTotal) * 100)
    : 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      background: T.surface, borderBottom: `1px solid ${T.line}`,
      padding: "0 16px", height: 40, flexShrink: 0, overflowX: "auto",
    }}>
      {/* 🔥 连续天数 */}
      <StatCell
        icon={stats.streak >= 3 ? "🔥" : "📅"}
        value={String(stats.streak)}
        label={`天连续`}
        color={stats.streak >= 7 ? "#f97316" : stats.streak >= 3 ? "#E07B2A" : T.muted}
        highlight={stats.streak >= 3}
      />

      <Divider />

      {/* ✅ 今日完成 */}
      <StatCell
        icon="✓"
        value={String(stats.todayCompleted)}
        label="今天"
        color={stats.todayCompleted > 0 ? T.green : T.muted}
      />

      <Divider />

      {/* 📊 本周进度 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 12px", flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: T.muted }}>本周</span>
        <div style={{ width: 48, height: 4, background: T.soft, borderRadius: 2, overflow: "hidden" }}>
          <div style={{
            height: 4, width: `${weekPct}%`,
            background: weekPct >= 80 ? T.green : weekPct >= 40 ? T.accent : T.orange,
            borderRadius: 2, transition: "width 0.4s",
          }} />
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, color: T.ink, fontFamily: "var(--font-geist-mono), monospace" }}>
          {weekPct}%
        </span>
      </div>

      <Divider />

      {/* 🏅 累计完成 */}
      <StatCell
        icon="🏅"
        value={String(stats.totalCompleted)}
        label="累计"
        color={T.muted}
      />

      {/* 活跃任务数（只在有多个时显示）*/}
      {stats.activeTasks > 1 && (
        <>
          <Divider />
          <StatCell
            icon="📋"
            value={String(stats.activeTasks)}
            label="进行中"
            color={T.accent}
          />
        </>
      )}
    </div>
  );
}

function StatCell({ icon, value, label, color, highlight }: {
  icon: string; value: string; label: string; color: string; highlight?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      padding: "0 12px", flexShrink: 0,
      background: highlight ? `${color}10` : "transparent",
      borderRadius: 6,
    }}>
      <span style={{ fontSize: 12 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color, letterSpacing: "-0.03em" }}>{value}</span>
      <span style={{ fontSize: 10, color: T.muted }}>{label}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 16, background: T.line, flexShrink: 0 }} />;
}
