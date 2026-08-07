"use client";

import { useState, useRef, useEffect } from "react";

const T = {
  surface: "#FFFFFF",
  soft:    "#F1F2EE",
  line:    "#E7E7E2",
  ink:     "#111111",
  muted:   "#777B75",
  accent:  "#3B7AFF",
  green:   "#2F5D50",
  orange:  "#E07B2A",
} as const;

// 客户端轻量 URL 检测（不引入 url-fetcher，避免服务端依赖）
function extractUrlClient(input: string): string | null {
  const match = input.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+/);
  return match ? match[0].replace(/[.,;!?)]+$/, "") : null;
}

type UrlHint = {
  type: "github_repo" | "github_file" | "youtube" | "bilibili" | "docs" | "article";
  icon: string;
  label: string;
  tip: string;
};

function detectUrlHint(url: string): UrlHint {
  const u = url.toLowerCase();
  if (u.includes("github.com")) {
    if (u.includes("/blob/") || u.includes("/gist")) {
      return { type: "github_file", icon: "📄", label: "GitHub 文件", tip: "AI 将读取文件内容，基于代码/文档规划学习路径" };
    }
    return { type: "github_repo", icon: "📦", label: "GitHub 仓库", tip: "AI 将读取 README，了解项目内容后为你制定学习计划" };
  }
  if (u.includes("youtube.com") || u.includes("youtu.be")) {
    return { type: "youtube", icon: "🎬", label: "YouTube 视频", tip: "AI 将基于视频平台和链接推断主题，建议补充描述" };
  }
  if (u.includes("bilibili.com") || u.includes("b23.tv")) {
    return { type: "bilibili", icon: "📺", label: "Bilibili 视频", tip: "AI 将基于视频平台和链接推断主题，建议补充描述" };
  }
  if (u.includes("docs.") || u.includes("/docs/") || u.includes("developer.mozilla") || u.includes("readthedocs")) {
    return { type: "docs", icon: "📖", label: "技术文档", tip: "AI 将抓取文档内容，规划对应技术的学习路径" };
  }
  return { type: "article", icon: "🌐", label: "网页/文章", tip: "AI 将读取页面内容，根据文章主题规划学习计划" };
}

interface Props {
  onClose: () => void;
  onSubmit: (goal: string) => void;
}

export function NewTaskInput({ onClose, onSubmit }: Props) {
  const [goal, setGoal] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const detectedUrl = extractUrlClient(goal);
  const urlHint = detectedUrl ? detectUrlHint(detectedUrl) : null;

  const handleSubmit = () => {
    if (!goal.trim()) return;
    onSubmit(goal.trim());
    onClose();
  };

  const placeholder = detectedUrl
    ? "可以在链接后补充说明，例如：侧重学习 Hooks 部分"
    : "你想学什么？\n例如：掌握 Python 基础 / 高考数学冲刺\n或者直接粘贴一个链接 🔗";

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(17,17,17,0.25)", zIndex: 100, backdropFilter: "blur(2px)" }}
      />
      {/* Dialog */}
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: T.surface, border: `1px solid ${T.line}`, borderRadius: 18,
        padding: "22px 22px 18px", width: "min(500px, 93vw)",
        zIndex: 101, boxShadow: "0 20px 60px rgba(17,17,17,0.1)",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        {/* 标题栏 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ color: T.ink, fontWeight: 700, fontSize: 15, letterSpacing: "-0.03em" }}>新建学习任务</div>
          <button onClick={onClose} style={{ color: T.muted, background: "none", border: "none", cursor: "pointer", fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* 输入框 */}
        <textarea
          ref={ref}
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          placeholder={placeholder}
          rows={4}
          style={{
            width: "100%", background: T.soft,
            border: `1.5px solid ${detectedUrl ? T.accent : T.line}`,
            borderRadius: 10, padding: "11px 13px",
            color: T.ink, fontSize: 14, fontWeight: 500,
            outline: "none", resize: "vertical", fontFamily: "inherit",
            boxSizing: "border-box", letterSpacing: "-0.02em",
            lineHeight: 1.6,
            transition: "border-color 0.2s",
          }}
        />

        {/* URL 检测提示卡 */}
        {urlHint && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "10px 12px",
            background: "rgba(59,122,255,0.05)",
            border: "1px solid rgba(59,122,255,0.2)",
            borderRadius: 10,
          }}>
            <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.2 }}>{urlHint.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: T.accent,
                  background: "rgba(59,122,255,0.12)", border: "1px solid rgba(59,122,255,0.25)",
                  borderRadius: 4, padding: "1px 7px",
                }}>
                  {urlHint.label}
                </span>
                <span style={{ fontSize: 10, color: T.green, fontWeight: 600 }}>
                  ✓ 将自动读取内容
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.45 }}>
                {urlHint.tip}
              </div>
              <div style={{
                fontSize: 10, color: T.muted, marginTop: 4,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                fontFamily: "var(--font-geist-mono), monospace",
                opacity: 0.7,
              }}>
                {detectedUrl}
              </div>
            </div>
          </div>
        )}

        {/* 提示文字 */}
        {!urlHint && (
          <p style={{ color: T.muted, fontSize: 11, margin: 0, lineHeight: 1.5 }}>
            按 Enter 开始分析 · AI 将在右侧实时展示分析过程 · 支持直接粘贴链接
          </p>
        )}

        {/* 操作按钮 */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={handleSubmit}
            disabled={!goal.trim()}
            style={{
              flex: 1, background: T.accent, color: "#fff", border: "none", borderRadius: 10,
              padding: "11px 0", fontSize: 13, fontWeight: 600, letterSpacing: "-0.02em",
              cursor: goal.trim() ? "pointer" : "not-allowed",
              opacity: goal.trim() ? 1 : 0.45,
              transition: "opacity 0.15s",
            }}
          >
            {urlHint ? `读取 ${urlHint.label} 并分析 →` : "开始分析 →"}
          </button>
          <button
            onClick={onClose}
            style={{ background: T.soft, color: T.muted, border: `1px solid ${T.line}`, borderRadius: 10, padding: "11px 16px", fontSize: 13, cursor: "pointer" }}
          >
            取消
          </button>
        </div>
      </div>
    </>
  );
}
