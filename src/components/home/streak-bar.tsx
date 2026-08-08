"use client";

import { useState, useEffect, useCallback } from "react";
import { request } from "@/lib/api/request";

const T = {
  surface: "#FFFFFF", soft: "#F1F2EE", line: "#E7E7E2",
  ink: "#111111", muted: "#777B75", accent: "#3B7AFF",
  green: "#2F5D50", orange: "#E07B2A",
} as const;

interface Stats {
  streak: number;
  todayCount: number;
  weekCount: number;
  totalCompleted: number;
  activeTaskCount: number;
}

interface Props {
  /** 外部触发刷新用的计数器（每次完成子任务 +1）*/
  refreshTick?: number;
}

export function StreakBar({ refreshTick = 0 }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await request("/api/user/stats");
      if (res.ok) setStats(await res.json() as Stats);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats, refreshTick]);

  if (!stats) return null;

  const { streak, todayCount, weekCount, totalCompleted, activeTaskCount } = stats;

  // 本周目标：活跃任务 × 1.5（约每天完成 1.5 个子任务）
  const weekGoal = Math.max(activeTaskCount * 3, 5);
  const weekPct = Math.min(1, weekCount / weekGoal);
  const weekBarW = Math.round(weekPct * 60); // 最大 60px

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "7px 18px",
      borderBottom: `1px solid ${T.line}`,
      background: T.soft,
      flexShrink: 0,
      flexWrap: "wrap",
      rowGap: 4,
    }}>

      {/* 连续天数 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 13 }}>{streak >= 3 ? "🔥" : "📅"}</span>
        <span style={{
          fontSize: 11, fontWeight: 700,
          color: streak >= 3 ? "#E07B2A" : T.ink,
          letterSpacing: "-0.01em",
        }}>
          {streak > 0 ? `${streak} 天连续` : "今日开始"}
        </span>
      </div>

      <span style={{ color: T.line, fontSize: 10 }}>|</span>

      {/* 今日完成 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10, color: T.muted }}>今日</span>
        <span style={{
          fontSize: 11, fontWeight: 600,
          color: todayCount > 0 ? T.green : T.muted,
        }}>
          ✓ {todayCount}
        </span>
      </div>

      <span style={{ color: T.line, fontSize: 10 }}>|</span>

      {/* 本周进度条 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: T.muted }}>本周</span>
        <div style={{
          width: 64, height: 5, background: T.line,
          borderRadius: 3, overflow: "hidden",
        }}>
          <div style={{
            width: weekBarW, height: "100%",
            background: weekPct >= 1 ? T.green : T.accent,
            borderRadius: 3,
            transition: "width 0.4s ease",
          }} />
        </div>
        <span style={{ fontSize: 10, color: T.muted, minWidth: 24 }}>
          {weekCount}/{weekGoal}
        </span>
      </div>

      <span style={{ color: T.line, fontSize: 10 }}>|</span>

      {/* 历史累计 */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 10 }}>{totalCompleted >= 50 ? "🏅" : totalCompleted >= 20 ? "⭐" : "✨"}</span>
        <span style={{ fontSize: 10, color: T.muted }}>{totalCompleted} 累计</span>
      </div>
    </div>
  );
}
