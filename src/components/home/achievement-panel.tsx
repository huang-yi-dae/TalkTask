"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { request } from "@/lib/api/request";
import { getLevel, getNextLevel, getLevelProgress } from "@/lib/growth";

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
  learnDays: number;
  totalGoals: number;
}

interface Props {
  /** 外部触发刷新（每次完成子任务 +1）*/
  refreshTick?: number;
  /** 当前待完成项数（来自本地时间轴，避免额外请求）*/
  pending?: number;
  /** 面板标题（并入同一个框的头部）*/
  title?: string;
}

/**
 * 学习日历面板（单框版）—— 标题 + 等级 + 数据全部收进同一个圆角框。
 * 上方区域：标题「学习日历」+ 等级徽章/Lv/升级进度 + 连续天数 + 待完成；
 * 下方区域：今日 / 本周 / 累计完成 / 学习天数 / 剩余目标 内联指标条。
 */
export function AchievementPanel({ refreshTick = 0, pending = 0, title }: Props) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("achievement.defaultTitle");
  const [stats, setStats] = useState<Stats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await request("/api/user/stats");
      if (res.ok) setStats(await res.json() as Stats);
    } catch { /* ignore */ }
  }, []);

  // fetchStats 内部在 await 之后才 setState，非同步级联
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchStats(); }, [fetchStats, refreshTick]);

  if (!stats) return null;

  const { streak, todayCount, weekCount, totalCompleted, activeTaskCount, learnDays } = stats;
  const level = getLevel(totalCompleted);

  // 本周目标：活跃任务 × 3，最少 5（沿用原口径）
  const weekGoal = Math.max(activeTaskCount * 3, 5);
  const weekPct = Math.min(1, weekGoal > 0 ? weekCount / weekGoal : 0);

  // 底部内联指标条（今日 / 本周 / 累计完成 / 学习天数 / 剩余目标）
  const stripStats: { label: string; value: string; unit: string; color: string }[] = [
    { label: t("achievement.todayDone"), value: String(todayCount), unit: t("achievement.unitItem"), color: todayCount > 0 ? T.green : T.ink },
    { label: t("achievement.weekDone"), value: `${weekCount}/${weekGoal}`, unit: "", color: weekPct >= 1 ? T.green : T.accent },
    { label: t("achievement.totalDone"), value: String(totalCompleted), unit: t("achievement.unitStep"), color: T.ink },
    { label: t("achievement.learnDays"), value: String(learnDays), unit: t("achievement.unitDay"), color: T.ink },
    { label: t("achievement.remainingGoal"), value: String(activeTaskCount), unit: t("achievement.unitCount"), color: T.ink },
  ];

  return (
    <div style={{
      margin: "10px 14px 0",
      background: `linear-gradient(135deg, ${level.color}12, ${T.surface})`,
      border: `1px solid ${level.color}33`, borderRadius: 12,
      overflow: "hidden",
    }}>
      {/* 上方区域 · 头部：标题「学习日历」+ 连续天数 + 待完成 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 13px 10px" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.ink, letterSpacing: "-0.01em" }}>{resolvedTitle}</span>
        <div style={{ flex: 1 }} />
        {/* 连续天数 */}
        <div style={{
          display: "flex", alignItems: "center", gap: 3, flexShrink: 0,
          background: streak >= 3 ? `${T.orange}14` : T.soft,
          border: `1px solid ${streak >= 3 ? `${T.orange}33` : T.line}`,
          borderRadius: 8, padding: "3px 8px",
        }}>
          <span style={{ fontSize: 12 }}>{streak >= 3 ? "🔥" : "📅"}</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: streak >= 3 ? T.orange : T.ink }}>
            {streak > 0 ? t("achievement.streakDays", { count: streak }) : t("achievement.today")}
          </span>
        </div>
        {/* 待完成 */}
        <div style={{
          display: "flex", alignItems: "center", flexShrink: 0,
          background: pending > 0 ? `${T.orange}14` : T.soft,
          border: `1px solid ${pending > 0 ? `${T.orange}33` : T.line}`,
          borderRadius: 8, padding: "3px 8px",
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: pending > 0 ? T.orange : T.muted }}>{t("achievement.pending", { count: pending })}</span>
        </div>
      </div>

      {/* 下方区域 · 5 个指标压成一条带竖分隔线的内联条 */}
      <div style={{ display: "flex", alignItems: "stretch", borderTop: `1px solid ${T.line}`, background: "rgba(255,255,255,0.5)" }}>
        {stripStats.map((m, i) => (
          <div key={m.label} style={{
            flex: 1, textAlign: "center", padding: "7px 4px",
            borderLeft: i === 0 ? "none" : `1px solid ${T.line}`,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: m.color, letterSpacing: "-0.02em", lineHeight: 1.1 }}>
              {m.value}<span style={{ fontSize: 9, fontWeight: 500, color: T.muted, marginLeft: 1 }}>{m.unit}</span>
            </div>
            <div style={{ fontSize: 9.5, color: T.muted, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 等级徽章（独立自取数据）—— 放在顶部 header「拾级」那一行。
 * 显示：等级图标 + Lv·名称 + 升级进度条 + 升级文案。
 */
export function LevelBadge({ refreshTick = 0 }: { refreshTick?: number }) {
  const { t } = useTranslation();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await request("/api/user/stats");
        if (alive && res.ok) setStats(await res.json() as Stats);
      } catch { /* ignore */ }
    })();
    return () => { alive = false; };
  }, [refreshTick]);

  if (!stats) return null;

  const total = stats.totalCompleted;
  const level = getLevel(total);
  const next = getNextLevel(total);
  const prog = getLevelProgress(total);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: T.soft, border: `1px solid ${T.line}`,
      borderRadius: 10, padding: "5px 10px 5px 6px", minWidth: 210, maxWidth: 300,
    }}>
      <div style={{
        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
        background: `${level.color}14`, border: `1px solid ${level.color}2E`,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
      }}>{level.icon}</div>
      <span style={{ fontSize: 12, fontWeight: 700, color: T.ink, letterSpacing: "-0.02em", whiteSpace: "nowrap", flexShrink: 0 }}>
        Lv · {level.name}
      </span>
      <div style={{ flex: 1, minWidth: 60 }}>
        {/* 进度条：浅色低调，避免抢焦点（浅灰轨道 + 淡一档的等级色填充）*/}
        <div style={{ height: 5, background: "#ECECE8", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ width: `${Math.round(prog.pct * 100)}%`, height: "100%", background: `${level.color}59`, borderRadius: 3, transition: "width 0.5s ease" }} />
        </div>
        <div style={{ fontSize: 9.5, color: T.muted, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {next ? t("achievement.toNextLevel", { count: prog.need - prog.done, name: next.name }) : t("achievement.maxLevel")}
        </div>
      </div>
    </div>
  );
}
