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
  type: string;
  icon: string;
  label: string;
  tip: string;
  /** 是否可以完整抓取内容（false = 仅推断主题，建议补充描述）*/
  canFetch: boolean;
};

function detectUrlHint(url: string): UrlHint {
  const u = url.toLowerCase();

  // GitHub
  if (u.includes("github.com") || u.includes("raw.githubusercontent.com")) {
    if (u.includes("/blob/") || u.includes("/gist")) {
      return { type: "github_file", icon: "📄", label: "GitHub 文件", tip: "AI 将读取文件内容，基于代码/文档规划学习路径", canFetch: true };
    }
    return { type: "github_repo", icon: "📦", label: "GitHub 仓库", tip: "AI 将读取 README，了解项目后制定针对性学习计划", canFetch: true };
  }

  // arXiv 论文
  if (u.includes("arxiv.org") || u.includes("ar5iv.org")) {
    return { type: "arxiv", icon: "🎓", label: "arXiv 论文", tip: "AI 将抓取摘要与章节结构，规划论文精读学习路径", canFetch: true };
  }

  // PDF 直链
  if (u.endsWith(".pdf") || u.includes(".pdf?") || u.includes(".pdf#")) {
    return { type: "pdf", icon: "📑", label: "PDF 文档", tip: "AI 将提取元数据与正文文字，根据文档内容规划学习路径", canFetch: true };
  }

  // 视频平台
  if (u.includes("youtube.com") || u.includes("youtu.be")) {
    return { type: "youtube", icon: "🎬", label: "YouTube 视频", tip: "视频字幕无法抓取，建议补充一句学习目标描述", canFetch: false };
  }
  if (u.includes("bilibili.com") || u.includes("b23.tv")) {
    return { type: "bilibili", icon: "📺", label: "Bilibili 视频", tip: "AI 将读取视频标题、简介和 UP 主信息", canFetch: true };
  }

  // 课程平台
  if (u.includes("coursera.org")) {
    return { type: "coursera", icon: "🎓", label: "Coursera 课程", tip: "AI 将抓取课程大纲、评分与技能标签，规划学习顺序", canFetch: true };
  }
  if (u.includes("edx.org")) {
    return { type: "edx", icon: "📚", label: "edX 课程", tip: "AI 将抓取课程大纲与介绍，帮你高效规划学习路径", canFetch: true };
  }

  // 包管理
  if (u.includes("npmjs.com/package/")) {
    return { type: "npm", icon: "📦", label: "npm 包", tip: "AI 将读取包描述与依赖，规划该库的学习与使用路径", canFetch: true };
  }
  if (u.includes("pypi.org/project/")) {
    return { type: "pypi", icon: "🐍", label: "PyPI 包", tip: "AI 将读取包描述与依赖，规划该 Python 库的学习路径", canFetch: true };
  }

  // 中文技术社区
  if (u.includes("juejin.cn")) {
    return { type: "juejin", icon: "🔶", label: "掘金文章", tip: "AI 将提取文章正文，根据内容制定学习计划", canFetch: true };
  }
  if (u.includes("zhihu.com")) {
    return { type: "zhihu", icon: "🔵", label: "知乎文章", tip: "AI 将提取正文内容，基于文章主题规划学习路径", canFetch: true };
  }
  if (u.match(/\bmedium\.com\b/) || u.match(/\w+\.medium\.com/)) {
    return { type: "medium", icon: "🟢", label: "Medium 文章", tip: "AI 将提取文章正文，根据内容规划学习计划", canFetch: true };
  }

  // 文档协作平台
  if (u.includes("notion.so") || u.includes("notion.site")) {
    return { type: "notion", icon: "⬜", label: "Notion 页面", tip: "Notion 为 JS 渲染页面，将读取可见标题和描述；私有内容请补充说明", canFetch: false };
  }
  if (u.includes("yuque.com")) {
    return { type: "yuque", icon: "📝", label: "语雀文档", tip: "公开文档自动读取；私有文档可在设置中配置语雀 API Token", canFetch: true };
  }
  if (u.includes("feishu.cn") || u.includes("larkoffice.com")) {
    return { type: "feishu", icon: "📋", label: "飞书文档", tip: "公开文档自动读取；私有文档可在设置中配置飞书 User Token", canFetch: true };
  }

  // 技术文档
  if (u.includes("docs.") || u.includes("/docs/") || u.includes("developer.mozilla") || u.includes("readthedocs")) {
    return { type: "docs", icon: "📖", label: "技术文档", tip: "AI 将抓取文档内容，规划对应技术的学习路径", canFetch: true };
  }

  return { type: "article", icon: "🌐", label: "网页/文章", tip: "AI 将读取页面内容，根据文章主题规划学习计划", canFetch: true };
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

  // 一键填入示例
  const handleExample = (text: string) => {
    setGoal(text);
    setTimeout(() => ref.current?.focus(), 0);
  };

  const EXAMPLES = [
    { icon: "🐍", label: "Python 入门",  value: "从零开始掌握 Python 基础，能写简单脚本" },
    { icon: "📐", label: "高考数学",     value: "高考数学冲刺，重点突破导数与概率" },
    { icon: "🗣",  label: "英语口语",    value: "提升英语口语，能流利做5分钟自我介绍" },
    { icon: "⚛️", label: "React 实战",  value: "掌握 React Hooks，能独立开发 Todo 应用" },
  ];

  const placeholder = detectedUrl
    ? "可以在链接后补充说明，例如：侧重学习 Hooks 部分"
    : "你想学什么？直接描述目标，或粘贴一个链接 🔗";

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

        {/* 示例卡片（输入为空时展示） */}
        {!goal.trim() && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                onClick={() => handleExample(ex.value)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "6px 10px",
                  background: T.soft, border: `1px solid ${T.line}`,
                  borderRadius: 8, cursor: "pointer",
                  fontSize: 12, color: T.muted, fontWeight: 500,
                  transition: "background-color 0.15s ease-out, border-color 0.15s ease-out",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(59,122,255,0.07)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(59,122,255,0.3)";
                  (e.currentTarget as HTMLButtonElement).style.color = T.accent;
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = T.soft;
                  (e.currentTarget as HTMLButtonElement).style.borderColor = T.line;
                  (e.currentTarget as HTMLButtonElement).style.color = T.muted;
                }}
              >
                <span style={{ fontSize: 13 }}>{ex.icon}</span>
                {ex.label}
              </button>
            ))}
          </div>
        )}

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
                <span style={{ fontSize: 10, color: urlHint.canFetch ? T.green : T.orange, fontWeight: 600 }}>
                  {urlHint.canFetch ? "✓ 将自动读取内容" : "⚠ 建议补充描述"}
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
