/**
 * rate-limit.ts
 *
 * 轻量进程内速率限制（滑动窗口，按 key 隔离）。
 *
 * 用途：给昂贵端点（如 AI 分析：单次触发多轮 LLM + 外部抓取）加基础限流，
 * 防止单用户高频刷量放大成本 / 造成 DoS。
 *
 * 约束与取舍：
 *   - serverless 多实例下各实例独立计数，不是全局精确限流；
 *     但对「单用户短时间狂刷」这一主要滥用场景已足够有效，且零依赖。
 *   - 需要跨实例精确限流时应改用 Redis / Upstash，成本更高，此处不引入。
 */

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Hit>();

// 惰性清理：偶发清掉过期桶，避免 Map 无界增长
function sweep(now: number) {
  if (buckets.size < 500) return;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * @param key      隔离键（通常是 userId 或 userId:endpoint）
 * @param limit    窗口内允许的最大次数
 * @param windowMs 窗口时长（毫秒）
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const hit = buckets.get(key);
  if (!hit || hit.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }

  if (hit.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((hit.resetAt - now) / 1000) };
  }

  hit.count += 1;
  return { ok: true, remaining: limit - hit.count, retryAfterSec: 0 };
}
