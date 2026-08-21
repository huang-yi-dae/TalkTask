import { eq, sql } from "drizzle-orm";
import { db } from "../client";
import { users, type User } from "../schema/users";

/** 仅按主键查；用于 cookie / JWT 解析后的"当前用户"加载。 */
export async function getUserById(id: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

/** 按 email 查（精确匹配）。注册时主查使用 emailLower。 */
export async function getUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

/** 按小写邮箱查。登录/注册唯一性检查统一走这里。 */
export async function getUserByEmailLower(emailLower: string): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.emailLower, emailLower))
    .limit(1);
  return rows[0];
}

export async function upsertUser(data: {
  id: string;
  email?: string | null;
  emailLower?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  passwordHash?: string | null;
}): Promise<User> {
  // 同时维护 `email` 与 `emailLower` —— 两个字段语义不同：
  //   email       —— 用户原始邮箱（可保留大小写，仅展示用）
  //   emailLower  —— 小写归一版，注册/登录唯一性依据
  // 当 emailLower 提供时，email 若未提供则用同一个值兜底。
  const normalizedEmailLower = data.emailLower ?? (data.email ? data.email.toLowerCase() : null);
  const normalizedEmail = data.email ?? normalizedEmailLower;
  const values = {
    id: data.id,
    email: normalizedEmail,
    emailLower: normalizedEmailLower,
    name: data.name ?? null,
    avatarUrl: data.avatarUrl ?? null,
    passwordHash: data.passwordHash ?? "",
  };
  const rows = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: values.email,
        emailLower: values.emailLower,
        // 不允许 upsert 路径意外覆盖 passwordHash
        name: values.name,
        avatarUrl: values.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

export async function updateUser(
  id: string,
  data: { name?: string | null; avatarUrl?: string | null }
): Promise<User | undefined> {
  if (Object.keys(data).length === 0) return getUserById(id);

  const rows = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return rows[0];
}

export async function deleteUser(id: string): Promise<boolean> {
  const rows = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
}

/**
 * 把 users 行上所有 `email` 值同步写入 `emailLower`（小写）。
 * 仅在 Ticket 01 迁移后的"一次性回填"用；之后 register/login 都自行写入 emailLower。
 * 已存在的 email_lower 不被覆盖（保留后续手动修过的归一值）。
 */
export async function backfillEmailLower(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE users
       SET email_lower = LOWER(email)
     WHERE email IS NOT NULL
       AND (email_lower IS NULL OR email_lower <> LOWER(email))
  `);
  // postgres.js 返回 [result]；可能没有 rowCount 字段，保守取 0
  const count = (result as unknown as { count?: number }).count;
  return typeof count === "number" ? count : 0;
}
