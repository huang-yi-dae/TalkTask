import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { authAttempts } from "@/lib/db/schema/auth-attempts";

/**
 * 一次性记录一条尝试。
 * 调用方负责生成 id（`crypto.randomUUID()`）。
 */
export async function recordAuthAttempt(input: {
  id: string;
  ip: string;
  kind: "register" | "login";
}): Promise<void> {
  await db.insert(authAttempts).values({
    id: input.id,
    ip: input.ip,
    kind: input.kind,
  });
}

/** 60 秒内同 ip+kind 的尝试次数（含本次）。 */
export async function countRecentAttempts(
  ip: string,
  kind: "register" | "login",
  windowSeconds = 60,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(authAttempts)
    .where(
      and(
        eq(authAttempts.ip, ip),
        eq(authAttempts.kind, kind),
        gt(authAttempts.attemptedAt, sql`NOW() - (${String(windowSeconds)} || ' seconds')::interval`),
      ),
    );
  return rows[0]?.count ?? 0;
}

/** 清掉所有早于给定秒数之前的尝试（窗口前置清理）。 */
export async function pruneOldAttempts(windowSeconds = 60): Promise<void> {
  await db.execute(sql`
    DELETE FROM auth_attempts
     WHERE attempted_at < NOW() - (${String(windowSeconds)} || ' seconds')::interval
  `);
}
